import type { ModelInfo } from './types.ts'

export interface ProbeResult {
  modelId: string
  providerId?: string
  success: boolean
  latencyMs: number
  message?: string
}

export interface ProbeOptions {
  llm?: any
  providerId?: string
  timeoutMs?: number
}

/**
 * 动态根据供应商组 Key 解析对应的 DSH LLM Provider ID
 */
export function resolveProviderId(groupKey: string, availableProviders: string[] = []): string {
  const normalizedKey = (groupKey || '').replace(/\.models$/i, '')
  const cleanKey = normalizedKey.toLowerCase()

  // 1. 如果运行时已注册的列表中有完全一致的，直接采用
  const exact = availableProviders.find(p => p.toLowerCase() === cleanKey)
  if (exact) return exact

  // 2. Trae 国际版 (trae-global / trae-ai) vs 国内版 (trae)
  if (cleanKey.includes('trae')) {
    if (cleanKey.includes('ai') || cleanKey.includes('global') || cleanKey.includes('sg')) {
      return availableProviders.find(p => p === 'trae-global' || p === 'trae-ai') || 'trae-global'
    }
    return availableProviders.find(p => p === 'trae') || 'trae'
  }

  // 3. WorkBuddy 国际版 (workbuddy-ai) vs 国内版 (workbuddy)
  if (cleanKey.includes('workbuddy')) {
    if (cleanKey.includes('ai') || cleanKey.includes('global')) {
      return availableProviders.find(p => p === 'workbuddy-ai') || 'workbuddy-ai'
    }
    return availableProviders.find(p => p === 'workbuddy') || 'workbuddy'
  }

  // 4. Qoder 国际版 (qoder-global) vs 国内版 (qoder)
  if (cleanKey.includes('qoder')) {
    if (cleanKey.includes('ai') || cleanKey.includes('global')) {
      return availableProviders.find(p => p === 'qoder-global' || p === 'qoder-ai') || 'qoder-global'
    }
    return availableProviders.find(p => p === 'qoder') || 'qoder'
  }

  // 5. 自定义聚合插件 llm-pi-ai: llm-pi-ai.providers.<pKey>
  if (cleanKey.startsWith('llm-pi-ai.providers.')) {
    const pKey = groupKey.replace(/^llm-pi-ai\.providers\./i, '')
    const match = availableProviders.find(p => p.toLowerCase() === pKey.toLowerCase())
    if (match) return match
    return pKey
  }

  // 6. DeepSeek 官方插件
  if (cleanKey.startsWith('llm-deepseek') || cleanKey.includes('deepseek')) {
    const match = availableProviders.find(p => p.toLowerCase() === 'deepseek')
    if (match) return match
    return 'deepseek'
  }

  // 7. 动态前缀/包含匹配
  for (const p of availableProviders) {
    const pLower = p.toLowerCase()
    if (cleanKey.includes(pLower) || pLower.includes(cleanKey)) {
      return p
    }
  }

  // 8. 默认兜底：提取首段
  const parts = groupKey.split('.')
  return parts[0] || groupKey
}

/**
 * 从返回的文本内容中检测是否包含上游伪装成正文的错误信息
 * （如 Trae solo-bridge 发生 4008 额度耗尽时会将错误直接包装进 content 文本）
 */
export function extractContentError(text: string): string | undefined {
  if (!text) return undefined
  const trimmed = text.trim()
  if (!trimmed) return undefined

  // 1. 特征匹配 Trae 错误封装（如 \n\n⚠️ **[Trae 错误]**: ...）
  if (trimmed.includes('[Trae 错误]') || trimmed.includes('**[Trae 错误]**')) {
    const clean = trimmed.replace(/^[\s\n]*⚠️\s*\*\*\[Trae 错误\]\*\*[：:]\s*/i, '[Trae 错误]: ').trim()
    return clean
  }

  // 2. 匹配具体错误码与中文关键词
  if (
    /4008|当前\s*Trae\s*账号可用额度已耗尽|账号可用额度已耗尽|可用额度已耗尽|额度已耗尽|额度超限|账户额度不足|可用额度不足|积分不足|余额已耗尽/i.test(trimmed) ||
    /4120|权限不足.*Trae\s*Pro|需订阅\s*Pro|需升级套餐/i.test(trimmed) ||
    /4003|凭据已失效.*重新登录|登录凭据已失效/i.test(trimmed) ||
    /4029|请求过于频繁.*限流|触发\s*Trae\s*限流/i.test(trimmed)
  ) {
    const clean = trimmed.replace(/^[\s\n⚠️*#]+/, '').trim()
    return clean.startsWith('[Trae 错误]') ? clean : `[Trae 错误]: ${clean}`
  }

  // 3. 匹配常见英文额度耗尽 / 鉴权失败 / 限流提示（包括 Trae 官方英文原生返回）
  if (
    /exceeded\s+the\s+quota|quota\s+exceeded|requests\s+have\s+exceeded|insufficient\s+(quota|balance|funds|credit)|rate\s+limit\s+exceeded|credit\s+exhausted|token\s+expired|unauthorized\b|invalid\s+api\s*key|quota\s+reached|billing\s+limit/i.test(trimmed)
  ) {
    return `[Trae 错误]: 当前 Trae 账号可用额度已耗尽 (错误码 4008)`
  }

  // 4. 通用上游错误包裹匹配（如 "[Error]: ...", "[错误]: ...", "[Failure]: ..." 等）
  const genericMatch = trimmed.match(/^\[(Error|错误|Failure)\][：:]\s*(.+)/i)
  if (genericMatch) {
    return trimmed
  }

  // 5. 常见的 API 报错或 JSON 错误正文
  if (/^({\s*"error"|"error"\s*:|{"code"\s*:)/i.test(trimmed)) {
    try {
      const obj = JSON.parse(trimmed)
      const msg = obj?.error?.message || obj?.error || obj?.message
      const code = obj?.code || obj?.error?.code
      if (code === 4008 || /quota/i.test(msg || '')) {
        return `[Trae 错误]: 当前 Trae 账号可用额度已耗尽 (错误码 4008)`
      }
      if (msg) return `[API 错误]: ${msg}`
    } catch {
      return trimmed
    }
  }

  return undefined
}

/**
 * 提炼并格式化错误信息，去除杂乱的原始嵌套 JSON 与内部堆栈，转换为人类可读的友好提示
 */
export function simplifyErrorMessage(raw: string): string {
  if (!raw) return '调用失败'
  const trimmed = raw.trim()

  // 1. Qoder 10605 排队或不可用
  if (/10605|serviceAvailable.*false|isQueued/i.test(trimmed)) {
    return 'Qoder 上游服务当前排队或暂不可用 (错误码 10605)，请稍后重试'
  }
  // 2. Qoder 105 登录失效
  if (/105|Login expired/i.test(trimmed)) {
    return 'Qoder 登录已失效或 PAT 不可用 (错误码 105)，请前往 Qoder 设置重新配置'
  }
  // 3. Trae 4008 额度耗尽
  if (/4008|可用额度已耗尽|额度已耗尽/i.test(trimmed)) {
    return '[Trae 错误]: 当前 Trae 账号可用额度已耗尽，请前往 Trae 充值或升级套餐 (错误码 4008)'
  }
  // 4. WorkBuddy 11133 处理
  if (/integer_below_min_value.*max.*token|max.*token.*integer_below_min_value/i.test(trimmed)) {
    return '上游参数下限校验限制 (11133: integer_below_min_value)'
  }
  if (/11133/i.test(trimmed)) {
    return '上游模型参数被拒绝 (错误码 11133: model_param_invalid)'
  }
  // 5. 超时
  if (/aborted|timeout|timed out/i.test(trimmed)) {
    return '请求超时未响应，请检查上游网络连接'
  }

  // 6. 如果是嵌套 JSON 字符串，尝试递归解开提取 message
  try {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      let parsed = JSON.parse(jsonMatch[0])
      while (typeof parsed?.message === 'string' && parsed.message.startsWith('{')) {
        try { parsed = JSON.parse(parsed.message) } catch { break }
      }
      const code = parsed?.code || parsed?.error?.code
      const msg = parsed?.message || parsed?.error?.message || parsed?.error
      if (code && msg && !/\{/.test(String(msg))) return `异常 (${code}): ${msg}`
      if (msg && !/\{/.test(String(msg))) return String(msg)
    }
  } catch {}

  // 7. 去除常见无用错误前缀
  const cleaned = trimmed
    .replace(/^Error:\s*/i, '')
    .replace(/^QoderLlmError:\s*/i, '')
    .replace(/^LlmError:\s*/i, '')

  return cleaned.length > 120 ? `${cleaned.slice(0, 120)}...` : cleaned
}

/**
 * 判断是否属于 GPT 系列模型（支持大小写与命名空间前缀）
 */
export function isGptFamilyModel(modelId: string, modelName?: string): boolean {
  const id = (modelId || '').toLowerCase()
  const name = (modelName || '').toLowerCase()
  const gptPattern = /(^|[\/\-_])(gpt|chatgpt)([\/\-_]|\d|$)/i
  return gptPattern.test(id) || gptPattern.test(name)
}

/**
 * 通过 DSH LLM 运行时真实发送探测请求
 */
export async function probeSingleModelWithLlm(
  llm: any,
  providerId: string,
  model: ModelInfo,
  timeoutMs = 12000
): Promise<ProbeResult> {
  const startTime = Date.now()

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    // 规则：只有 GPT 系列模型增加 maxTokens（设为 32 充裕跨过 16 的下限校验阈值，输入为 'hi' 实际遇到标点即停止，实际消耗仅 2~3 个 token）；
    // 其他非 GPT 模型严格使用 5，保证极低开销
    const isGpt = isGptFamilyModel(model.id, model.name)
    const targetMaxTokens = isGpt ? 32 : 5

    // 发起极简真实请求进行测活（双保险传入 maxTokens 与 max_tokens 字段兼容不同适配器层）
    const stream = llm.stream({
      provider: providerId,
      model: model.id,
      messages: [
        {
          id: `probe-${Date.now()}`,
          role: 'user',
          content: [{ type: 'text', text: 'hi' }],
        },
      ],
      maxTokens: targetMaxTokens,
      max_tokens: targetMaxTokens,
      signal: controller.signal,
    })

    let accumulatedText = ''
    let finishError: string | undefined

    for await (const chunk of stream) {
      // 1. 检查直接的 error chunk 事件
      if (chunk?.type === 'error' || chunk?.error) {
        finishError = chunk.error?.message || chunk.message || '模型调用发生异常'
        break
      }

      // 2. 检查 finish 事件中的官方错误信号
      if (chunk?.type === 'finish') {
        if (chunk.reason?.kind === 'error' || chunk.reason?.failure) {
          const failure = chunk.reason.failure
          finishError = failure?.message || '模型调用失败'
          break
        }
      }

      // 3. 提取累积文本（涵盖 text, delta, content, reasoning 等所有流式字段）
      let deltaText = ''
      if (typeof chunk?.text === 'string') deltaText = chunk.text
      else if (typeof chunk?.delta === 'string') deltaText = chunk.delta
      else if (chunk?.type === 'delta' && typeof chunk?.content === 'string') deltaText = chunk.content
      else if (typeof chunk?.reasoning === 'string') deltaText = chunk.reasoning

      if (deltaText) {
        accumulatedText += deltaText
      }

      // 4. 实时检测累积正文中是否伪装包含额度耗尽等上游错误信息
      const contentError = extractContentError(accumulatedText)
      if (contentError) {
        finishError = contentError
        clearTimeout(timer)
        try { controller.abort() } catch {}
        break
      }
    }

    clearTimeout(timer)

    // 5. 流结束后做最后的终检验查
    if (!finishError && accumulatedText) {
      const lateError = extractContentError(accumulatedText)
      if (lateError) finishError = lateError
    }

    // 若捕获到任何错误，立即明确判定为异常
    if (finishError) {
      return {
        modelId: model.id,
        providerId,
        success: false,
        latencyMs: Date.now() - startTime,
        message: simplifyErrorMessage(finishError),
      }
    }

    // 只有当真正接收到非空实质回复文本时，才进入成功判定
    const trimmed = accumulatedText.trim()
    if (trimmed.length > 0) {
      const latencyMs = Date.now() - startTime
      return {
        modelId: model.id,
        providerId,
        success: true,
        latencyMs,
        message: `${latencyMs}ms`,
      }
    }

    return {
      modelId: model.id,
      providerId,
      success: false,
      latencyMs: Date.now() - startTime,
      message: '未收到模型响应数据',
    }
  } catch (error: any) {
    const msg = error?.message || String(error)
    // 检查异常消息本身是否包含 4008 额度耗尽信息
    const errContentError = extractContentError(msg)
    if (errContentError) {
      return {
        modelId: model.id,
        providerId,
        success: false,
        latencyMs: Date.now() - startTime,
        message: simplifyErrorMessage(errContentError),
      }
    }
    return {
      modelId: model.id,
      providerId,
      success: false,
      latencyMs: Date.now() - startTime,
      message: simplifyErrorMessage(msg.includes('aborted') ? '请求超时未响应' : msg),
    }
  }
}

/**
 * 测活单个模型
 */
export async function probeSingleModel(
  model: ModelInfo,
  options?: ProbeOptions | number
): Promise<ProbeResult> {
  const opts: ProbeOptions = typeof options === 'number' ? { timeoutMs: options } : (options || {})
  const { llm, providerId, timeoutMs = 12000 } = opts

  // 1. 若提供了 LLM 运行时，优先执行真实 LLM 请求测活
  if (llm && typeof llm.stream === 'function' && providerId) {
    return probeSingleModelWithLlm(llm, providerId, model, timeoutMs)
  }

  // 2. 若当前环境无 LLM 运行时，明确报告未连接原因，严禁使用假数据伪造成功
  return {
    modelId: model.id,
    providerId,
    success: false,
    latencyMs: 0,
    message: '未检测到可用的 LLM 运行时服务（无法发起真实请求）',
  }
}

/**
 * 批量测活一组模型（并发控制与真实状态反馈）
 */
export async function probeModels(
  items: Array<{ model: ModelInfo; providerId?: string } | ModelInfo>,
  llm?: any,
  onProgress?: (result: ProbeResult) => void
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = []
  // 并发控制：每次 3 个，避免瞬间冲击上游服务产生限流
  const concurrency = 3

  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency)
    const chunkPromises = chunk.map(async item => {
      const model = 'model' in item ? item.model : item
      const providerId = 'providerId' in item ? item.providerId : undefined
      const res = await probeSingleModel(model, {
        llm,
        providerId,
      })
      if (onProgress) onProgress(res)
      return res
    })
    const chunkResults = await Promise.all(chunkPromises)
    results.push(...chunkResults)
  }

  return results
}
