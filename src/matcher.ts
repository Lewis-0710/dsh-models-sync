import type { ModelsDevEntry, ModelInfo } from './types.ts'

/**
 * 去除模型 ID 或别名中的 free 标识
 * 例如：
 * - muse-spark-1.2-contributor-free -> muse-spark-1.2-contributor
 * - mimo-v2.6-flash-free -> mimo-v2.6-flash
 * - ling-3.0-flash-fin-free -> ling-3.0-flash-fin
 * - mimo-v2.6-flash (Free) -> mimo-v2.6-flash
 * - free-mimo-v2.6-flash -> mimo-v2.6-flash
 */
export function stripFree(str: string): string {
  if (!str) return ''
  if (!/\bfree\b|[-_.]free|free[-_.]/i.test(str)) {
    return str
  }

  let cleaned = str
    // 去除括号修饰：(free), [free], 【free】
    .replace(/[\(\[\{【（]\s*free\s*[\)\]\}】）]/gi, '')
    // 去除前后带分隔符或位于边界的 free：例如 -free, _free, free-, free_, 以及独立单词 free
    .replace(/(^|[-_.\s])free(?=[-_.\s]|$)/gi, '')
    // 压缩重复的破折号/下划线/空格，如 -- 变成 -
    .replace(/[-]{2,}/g, '-')
    .replace(/[_]{2,}/g, '_')
    .replace(/\s{2,}/g, ' ')
    // 去除首尾留下的分隔符或空格
    .replace(/^[-_.\s]+|[-_.\s]+$/g, '')

  return cleaned || str
}

/**
 * 提取去前缀去噪音的纯模型标识
 */
export function cleanId(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim().toLowerCase()
  // 去除命名空间，如 'openai/gpt-4o' -> 'gpt-4o'
  const bare = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed
  // 去除常见包装后缀并去除 free 标识
  const stripped = stripFree(bare)
  return stripped.replace(/-openai-compact$/, '').replace(/:\w+$/, '')
}

/**
 * 解析版本号，用于版本对比排序。如 'glm-5.3' -> [5, 3]
 */
function extractVersion(str: string): number[] {
  const match = str.match(/(\d+(?:\.\d+)*)/)
  if (!match || !match[1]) return [0]
  return match[1].split('.').map(n => parseInt(n, 10) || 0)
}

/**
 * 比较两个版本号：v1 > v2 返回正数，v1 < v2 返回负数
 */
function compareVersions(v1Str: string, v2Str: string): number {
  const v1 = extractVersion(v1Str)
  const v2 = extractVersion(v2Str)
  const len = Math.max(v1.length, v2.length)
  for (let i = 0; i < len; i++) {
    const num1 = v1[i] ?? 0
    const num2 = v2[i] ?? 0
    if (num1 !== num2) return num1 - num2
  }
  return 0
}

/**
 * 提取主干前缀和变体修饰
 * 如 'glm-latest-flash' -> prefix: 'glm', variant: 'flash'
 * 如 'glm-latest' -> prefix: 'glm', variant: ''
 */
function parseLatestQuery(id: string): { prefix: string; variant: string } {
  const c = cleanId(id)
  const parts = c.split('-')
  const latestIdx = parts.indexOf('latest')
  if (latestIdx === -1) {
    return { prefix: parts[0] || '', variant: '' }
  }
  const prefix = parts.slice(0, latestIdx).join('-')
  const variant = parts.slice(latestIdx + 1).join('-')
  return { prefix, variant }
}

/**
 * 获取同族词干（去掉常见的变体修饰后缀）
 * 如 'mimo-2.7-flash' -> 'mimo-2.7'
 * 如 'mimo-v2.5-luna' -> 'mimo-v2.5'
 * 如 'mimo-v2.5-ds' -> 'mimo-v2.5'
 * 如 'mimo-v2.5-pro-ultraspeed' -> 'mimo-v2.5'
 * 如 'qwen3.8-max' -> 'qwen3.8'
 */
export function getFamilyStem(id: string): string {
  let c = cleanId(id)
  const pattern = /-(flash|turbo|pro|plus|max|lite|mini|chat|thinking|preview|code|sg|volc|next|prime|luna|ds|vl|vision|omni|base|instruct|online|search|reasoner|speed|ultraspeed|audio|voice|moe|exp|free)$/i
  
  // 连续剥离变体后缀（最多连续剥离 4 次）
  for (let i = 0; i < 4; i++) {
    const next = c.replace(pattern, '')
    if (next === c) break
    c = next
  }
  return c
}

/**
 * 动态判断模型是否原生具备图片/视觉等多模态输入能力
 * 基于架构族特征与命名规范通用推导，零硬编码单个孤立模型
 */
export function isNativeVisionModel(modelId: string, modelName = ''): boolean {
  const text = `${modelId} ${modelName}`.toLowerCase()

  // 1. 显式带有多模态视觉特征标记：vl, vision, omni, multimodal, 4v, 4o, visual
  if (/(^|[-_.\s])(vl|vision|omni|multimodal|visual|4v|4o)([-_.\s]|$)/i.test(text)) {
    return true
  }

  // 2. 原生全系视觉的模型家族：
  // - 小米 MiMo-2.5 / MiMo-2.6 及以上全系列架构均为原生多模态视觉基座
  if (/mimo[-_.](v?2\.[5-9]|v?[3-9])/i.test(text)) {
    return true
  }

  // - Google Gemini 1.5 / 2.0 / 2.5 全系多模态视觉
  if (/gemini[-_.](1\.5|2\.[0-9]|2\.5|[3-9])/i.test(text)) {
    return true
  }

  // - Anthropic Claude 3 / 3.5 / 3.7 全系多模态视觉
  if (/claude[-_.](3|3\.5|3\.7|[4-9])/i.test(text)) {
    return true
  }

  // - OpenAI GPT-4o / GPT-4.5 / GPT-5 全系多模态视觉
  if (/gpt[-_.]?(4o|4\.5|5)/i.test(text)) {
    return true
  }

  return false
}

/**
 * 从多个候选 models.dev 条目中优选最完整、质量最高的条目（避免被残缺的纯文本脏数据覆盖多模态能力）
 */
export function pickBestEntry(entries: ModelsDevEntry[]): ModelsDevEntry | undefined {
  if (entries.length === 0) return undefined
  if (entries.length === 1) return entries[0]

  return [...entries].sort((a, b) => {
    let scoreA = 0
    let scoreB = 0

    // 1. 多模态视觉支持最为核心：支持 image 的赋予高权重
    if (a.input && a.input.includes('image')) scoreA += 25
    if (b.input && b.input.includes('image')) scoreB += 25

    // 2. 原厂/官方 Provider 优先（如 xiaomi, openai, anthropic, google, zhipu 等）
    const isOfficialA = a.provider && ['xiaomi', 'openai', 'anthropic', 'google', 'zhipu', 'meta', 'deepseek', 'mistral', 'qwen', 'aliyun'].includes(a.provider.toLowerCase())
    const isOfficialB = b.provider && ['xiaomi', 'openai', 'anthropic', 'google', 'zhipu', 'meta', 'deepseek', 'mistral', 'qwen', 'aliyun'].includes(b.provider.toLowerCase())
    if (isOfficialA) scoreA += 15
    if (isOfficialB) scoreB += 15

    // 3. 具备有效 contextWindow
    if (a.contextWindow && a.contextWindow > 0) scoreA += 10
    if (b.contextWindow && b.contextWindow > 0) scoreB += 10

    // 4. 具备思考等级信息
    if (Array.isArray(a.thinkingLevels) && a.thinkingLevels.length > 0) scoreA += 5
    if (Array.isArray(b.thinkingLevels) && b.thinkingLevels.length > 0) scoreB += 5

    // 5. 具备 maxOutput
    if (a.maxOutput && a.maxOutput > 0) scoreA += 3
    if (b.maxOutput && b.maxOutput > 0) scoreB += 3

    return scoreB - scoreA
  })[0]
}

export interface MatchResult {
  entry?: ModelsDevEntry
  matchedVia: 'id' | 'alias' | 'latest' | 'family' | 'none'
  matchedId?: string
  fallbackNote?: string
}

/**
 * 严格按照用户指定的 4 级优先级匹配逻辑进行匹配：
 * 优先级 1：先使用模型 ID 和 models.dev 匹配
 * 优先级 2：如果匹配不到就使用模型别名去和 models.dev 匹配
 * 优先级 3：如果模型是 latest 这种逻辑路由 id（比如 glm-latest 和 glm-latest-flash），
 *           就在 models.dev 中匹配该模型最新版本
 * 优先级 4：如果依然匹配不到就匹配同族的数据（比如 mimo-2.7-flash 如果匹配不到就匹配 mimo-2.7，需要显示说明文字）
 */
export function matchModel(
  modelId: string,
  modelName: string,
  catalog: ModelsDevEntry[]
): MatchResult {
  // 规则：如果模型ID或别名中包含 free，先去掉 free 后再使用 models.dev 匹配元数据
  const strippedId = stripFree(modelId)
  const strippedName = stripFree(modelName)
  const hadFree = (strippedId && strippedId !== modelId) || (strippedName && strippedName !== modelName)

  const effectiveId = strippedId || modelId
  const effectiveName = strippedName || modelName

  const rawIdClean = cleanId(effectiveId)
  const rawNameClean = cleanId(effectiveName)

  // ==========================================
  // 优先级 1：先使用模型 ID（已去除 free）和 models.dev 匹配
  // ==========================================
  // 1.1 精确匹配 id
  const exactCandidates = catalog.filter(m => m.id.toLowerCase() === effectiveId.toLowerCase() || m.id.toLowerCase() === modelId.toLowerCase())
  let hit = pickBestEntry(exactCandidates)

  if (!hit) {
    // 1.2 去命名空间前缀匹配
    const noNsCandidates = catalog.filter(m => cleanId(m.id) === rawIdClean)
    hit = pickBestEntry(noNsCandidates)
  }

  if (hit) {
    return {
      entry: hit,
      matchedVia: 'id',
      matchedId: hit.id,
      fallbackNote: hadFree ? '已自动去除 free 标识成功匹配元数据' : undefined,
    }
  }

  // ==========================================
  // 优先级 2：如果匹配不到就使用模型别名（已去除 free）去匹配
  // ==========================================
  if (effectiveName && effectiveName.trim() && effectiveName !== effectiveId) {
    const aliasExactCandidates = catalog.filter(m => m.name.toLowerCase() === effectiveName.toLowerCase() || (modelName && m.name.toLowerCase() === modelName.toLowerCase()))
    hit = pickBestEntry(aliasExactCandidates)

    if (!hit) {
      const aliasCleanCandidates = catalog.filter(m => cleanId(m.name) === rawNameClean || cleanId(m.id) === rawNameClean)
      hit = pickBestEntry(aliasCleanCandidates)
    }

    if (hit) {
      return {
        entry: hit,
        matchedVia: 'alias',
        matchedId: hit.id,
        fallbackNote: hadFree ? '已自动去除 free 标识成功匹配元数据' : undefined,
      }
    }
  }

  // ==========================================
  // 优先级 3：如果是 latest 逻辑路由 id 匹配最新版本
  // ==========================================
  const isLatest = rawIdClean.includes('latest') || rawNameClean.includes('latest')
  if (isLatest) {
    const query = parseLatestQuery(rawIdClean.includes('latest') ? rawIdClean : rawNameClean)
    if (query.prefix) {
      // 筛选所有同前缀的候选模型
      const candidates = catalog.filter(m => {
        const mClean = cleanId(m.id)
        if (!mClean.startsWith(query.prefix)) return false
        if (query.variant) {
          // 如果要求了变体，如 flash，则候选模型也必须带有该变体
          return mClean.includes(query.variant)
        }
        // 如果没有指定变体，优先排除含有 -flash, -lite, -mini 等降级后缀的候选
        return !mClean.includes('flash') && !mClean.includes('lite') && !mClean.includes('mini')
      })

      if (candidates.length > 0) {
        // 按版本号降序排序，取最高版本
        candidates.sort((a, b) => compareVersions(cleanId(b.id), cleanId(a.id)))
        const best = candidates[0]
        if (best) {
          return {
            entry: best,
            matchedVia: 'latest',
            matchedId: best.id,
          }
        }
      }
    }
  }

  // ==========================================
  // 优先级 4：同族数据匹配
  // ==========================================
  const familyStem = getFamilyStem(rawIdClean)
  if (familyStem && familyStem !== rawIdClean) {
    // 寻找同族模型（如 mimo-v2.5-luna / mimo-2.7-flash 寻找同族模型）
    const familyCandidates = catalog.filter(m => {
      const mClean = cleanId(m.id)
      return mClean === familyStem || getFamilyStem(mClean) === familyStem
    })
    hit = pickBestEntry(familyCandidates)

    if (hit) {
      return {
        entry: hit,
        matchedVia: 'family',
        matchedId: hit.id,
        fallbackNote: `根据同族模型 ${familyStem} 估算匹配`,
      }
    }
  }

  // 尝试别名的同族匹配
  if (modelName && modelName.trim()) {
    const nameStem = getFamilyStem(rawNameClean)
    if (nameStem && nameStem !== rawNameClean) {
      const nameFamilyCandidates = catalog.filter(m => {
        const mClean = cleanId(m.id)
        const mNameClean = cleanId(m.name)
        return mClean === nameStem || mNameClean === nameStem || getFamilyStem(mClean) === nameStem
      })
      hit = pickBestEntry(nameFamilyCandidates)

      if (hit) {
        return {
          entry: hit,
          matchedVia: 'family',
          matchedId: hit.id,
          fallbackNote: `根据同族模型 ${nameStem} 估算匹配`,
        }
      }
    }
  }

  return {
    matchedVia: 'none',
  }
}

/**
 * 将匹配结果的数据合并进 ModelInfo 中
 */
export function applyMatchToModel(model: ModelInfo, match: MatchResult): boolean {
  if (!match.entry) {
    model.matchedVia = 'none'
    // 即使未匹配到 models.dev，根据原生模型家族通用特征自适应推导多模态能力
    if (isNativeVisionModel(model.id, model.name)) {
      model.supportsImages = true
      const curInputs = Array.isArray(model.input) ? [...model.input] : ['text']
      if (!curInputs.includes('image')) curInputs.push('image')
      model.input = curInputs
    }
    return false
  }

  const { entry, matchedVia, matchedId, fallbackNote } = match
  model.matchedVia = matchedVia
  model.matchedId = matchedId
  model.fallbackNote = fallbackNote

  if (entry.contextWindow !== undefined && entry.contextWindow > 0) {
    model.contextWindow = entry.contextWindow
  }
  if (entry.maxOutput !== undefined && entry.maxOutput > 0) {
    model.maxOutput = entry.maxOutput
  }

  // 多模态图片支持判断：优先采纳 entry 声明，结合原生多模态视觉家族自适应兜底
  let supportsImages = entry.input.includes('image')
  if (!supportsImages && isNativeVisionModel(model.id, model.name || entry.name)) {
    supportsImages = true
  }

  model.supportsImages = supportsImages
  model.supportsText = entry.input.includes('text') || true

  // 维护完整的 input 模态列表
  const mergedInputs = ['text']
  if (supportsImages) {
    mergedInputs.push('image')
  }
  if (Array.isArray(entry.input)) {
    for (const item of entry.input) {
      if (item !== 'text' && item !== 'image' && !mergedInputs.includes(item)) {
        mergedInputs.push(item)
      }
    }
  }
  model.input = mergedInputs

  // 根据 models.dev 与现有支持动态计算实际支持的思考等级
  const devLevels = Array.isArray(entry.thinkingLevels) ? entry.thinkingLevels : []
  const localLevels = Array.isArray(model.availableReasoningLevels) ? model.availableReasoningLevels : []
  const mergedLevels = Array.from(new Set([...devLevels, ...localLevels]))
    .map(String)
    .filter(lvl => lvl && !['off', 'false', 'none', 'null'].includes(lvl.toLowerCase()))

  model.availableReasoningLevels = mergedLevels

  if (mergedLevels.length > 0) {
    // 自动选中默认等级：如果当前已有选中的有效等级，保留；否则自动选中默认推荐等级
    if (model.reasoningLevel && model.reasoningLevel !== 'off' && mergedLevels.includes(String(model.reasoningLevel))) {
      // 保持当前有效选择
    } else if (mergedLevels.includes('high')) {
      model.reasoningLevel = 'high'
    } else if (mergedLevels.includes('medium')) {
      model.reasoningLevel = 'medium'
    } else {
      model.reasoningLevel = mergedLevels[0] || 'low'
    }
  } else {
    model.reasoningLevel = 'off'
  }

  return true
}
