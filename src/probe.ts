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
  const cleanKey = (groupKey || '').toLowerCase()

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
 * 通过 DSH LLM 运行时真实发送探测请求
 */
export async function probeSingleModelWithLlm(
  llm: any,
  providerId: string,
  model: ModelInfo,
  timeoutMs = 12000
): Promise<ProbeResult> {
  const startTime = Date.now()
  let firstTokenReceived = false
  let latencyMs = 0

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    // 发起最小真实请求进行测活
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
      maxTokens: 5,
      signal: controller.signal,
    })

    let finishError: string | undefined

    for await (const chunk of stream) {
      // 检查失败信号（如额度耗尽、权限不足、认证失败）
      if (chunk?.type === 'finish') {
        if (chunk.reason?.kind === 'error') {
          const failure = chunk.reason.failure
          finishError = failure?.message || '模型调用失败'
          break
        }
      }

      // 只要收到任何有效文本内容或 delta
      const hasContent =
        (typeof chunk?.delta === 'string' && chunk.delta.length > 0) ||
        (typeof chunk?.text === 'string' && chunk.text.length > 0) ||
        chunk?.type === 'delta' ||
        chunk?.type === 'content-start'

      if (hasContent && !firstTokenReceived) {
        firstTokenReceived = true
        latencyMs = Date.now() - startTime
        clearTimeout(timer)
        try {
          // 收到首个 Token 即代表连通且正常，立即中断流以避免继续计费和消耗额度
          controller.abort()
        } catch {}
        break
      }
    }

    clearTimeout(timer)

    if (finishError) {
      return {
        modelId: model.id,
        providerId,
        success: false,
        latencyMs: Date.now() - startTime,
        message: finishError,
      }
    }

    if (firstTokenReceived) {
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
    if (firstTokenReceived) {
      return {
        modelId: model.id,
        providerId,
        success: true,
        latencyMs: latencyMs || (Date.now() - startTime),
        message: `${latencyMs || (Date.now() - startTime)}ms`,
      }
    }
    const msg = error?.message || String(error)
    return {
      modelId: model.id,
      providerId,
      success: false,
      latencyMs: Date.now() - startTime,
      message: msg.includes('aborted') ? '请求超时未响应' : msg,
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
