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
 * 动态判断模型命名是否包含业界通用的视觉/多模态特征标识
 * （如 vl, vision, omni, multimodal, 4v, 4o, visual 等工业界通用词根）
 * 100% 通用，零品牌/零特定模型名硬编码
 */
export function hasVisionFeatureFlag(modelId: string, modelName = ''): boolean {
  const text = `${modelId} ${modelName}`.toLowerCase()
  return /(^|[-_.\s])(vl|vision|omni|multimodal|visual|4v|4o)([-_.\s]|$)/i.test(text)
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

    // 2. 原厂/官方 Provider 优先（判断 provider 名称是否与模型命名空间前缀一致，如 org/model-id）
    const isOfficialA = !!(a.provider && a.id.toLowerCase().startsWith(`${a.provider.toLowerCase()}/`))
    const isOfficialB = !!(b.provider && b.id.toLowerCase().startsWith(`${b.provider.toLowerCase()}/`))
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

  // 核心辅助：同族基座多模态动态继承（Family Modality Inheritance）
  // 零模型名硬编码：动态查询 catalog 中同族基座是否具备 image 等模态，自动补全变体第三方脏数据
  function enrichWithFamilyModality(matchedEntry: ModelsDevEntry): ModelsDevEntry {
    if (matchedEntry.input && matchedEntry.input.includes('image')) {
      return matchedEntry
    }
    const stem = getFamilyStem(matchedEntry.id)
    if (stem && stem !== cleanId(matchedEntry.id)) {
      const familyCandidates = catalog.filter(m => cleanId(m.id) === stem || getFamilyStem(m.id) === stem)
      const bestFamily = pickBestEntry(familyCandidates)
      if (bestFamily && bestFamily.input && bestFamily.input.includes('image')) {
        return {
          ...matchedEntry,
          input: Array.from(new Set([...(matchedEntry.input || ['text']), ...bestFamily.input])),
        }
      }
    }
    return matchedEntry
  }

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
    hit = enrichWithFamilyModality(hit)
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
      hit = enrichWithFamilyModality(hit)
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
            entry: enrichWithFamilyModality(best),
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
    // 寻找同族模型（如 xxx-luna / xxx-flash 寻找同族模型）
    const familyCandidates = catalog.filter(m => {
      const mClean = cleanId(m.id)
      return mClean === familyStem || getFamilyStem(mClean) === familyStem
    })
    hit = pickBestEntry(familyCandidates)

    if (hit) {
      hit = enrichWithFamilyModality(hit)
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
        hit = enrichWithFamilyModality(hit)
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
    // 即使未匹配到 models.dev，根据业界通用的视觉/多模态特征标识（如 vl, vision, omni 等）自适应推导
    if (hasVisionFeatureFlag(model.id, model.name)) {
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

  // 多模态图片支持判断：优先采纳 entry 声明，结合通用视觉特征标记（如 *-vl, *-vision 等）
  let supportsImages = entry.input.includes('image')
  if (!supportsImages && hasVisionFeatureFlag(model.id, model.name || entry.name)) {
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
