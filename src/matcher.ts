import type { ModelsDevEntry, ModelInfo } from './types.ts'

/**
 * 提取去前缀去噪音的纯模型标识
 */
export function cleanId(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim().toLowerCase()
  // 去除命名空间，如 'openai/gpt-4o' -> 'gpt-4o'
  const bare = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed
  // 去除常见包装后缀
  return bare.replace(/-openai-compact$/, '').replace(/:\w+$/, '')
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
 * 如 'qwen3.8-max' -> 'qwen3.8'
 */
function getFamilyStem(id: string): string {
  const c = cleanId(id)
  return c
    .replace(/-(flash|turbo|pro|plus|max|lite|mini|chat|thinking|preview|code|sg|volc|next|prime)$/i, '')
    .replace(/-(flash|turbo|pro|plus|max|lite|mini|chat|thinking|preview|code|sg|volc|next|prime)$/i, '') // 容许多重后缀
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
  const rawIdClean = cleanId(modelId)
  const rawNameClean = cleanId(modelName)

  // ==========================================
  // 优先级 1：先使用模型 ID 和 models.dev 匹配
  // ==========================================
  // 1.1 精确匹配 id
  let hit = catalog.find(m => m.id.toLowerCase() === modelId.toLowerCase())
  if (!hit) {
    // 1.2 去命名空间前缀匹配
    hit = catalog.find(m => cleanId(m.id) === rawIdClean)
  }
  if (hit) {
    return {
      entry: hit,
      matchedVia: 'id',
      matchedId: hit.id,
    }
  }

  // ==========================================
  // 优先级 2：如果匹配不到就使用模型别名去匹配
  // ==========================================
  if (modelName && modelName.trim() && modelName !== modelId) {
    hit = catalog.find(m => m.name.toLowerCase() === modelName.toLowerCase())
    if (!hit) {
      hit = catalog.find(m => cleanId(m.name) === rawNameClean || cleanId(m.id) === rawNameClean)
    }
    if (hit) {
      return {
        entry: hit,
        matchedVia: 'alias',
        matchedId: hit.id,
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
    // 寻找同族模型（如 mimo-2.7-flash 寻找 mimo-2.7）
    hit = catalog.find(m => {
      const mClean = cleanId(m.id)
      return mClean === familyStem || getFamilyStem(mClean) === familyStem
    })

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
      hit = catalog.find(m => {
        const mClean = cleanId(m.id)
        const mNameClean = cleanId(m.name)
        return mClean === nameStem || mNameClean === nameStem || getFamilyStem(mClean) === nameStem
      })
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
  model.supportsImages = entry.input.includes('image')
  model.supportsText = entry.input.includes('text') || true

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
