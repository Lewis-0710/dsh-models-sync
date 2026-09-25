/**
 * 思考等级/推理等级提取与默认选中工具函数（纯无副作用通用模块，前后端通用）
 */

/**
 * 动态提取模型支持的全部思考等级（排除 off/false 等关闭项）
 */
export function extractAvailableReasoningLevels(rawModel: Record<string, any>): string[] {
  if (!rawModel || typeof rawModel !== 'object') return []

  const levels = new Set<string>()

  // 1. 从 rawModel.reasoning.supportedEfforts 提取 (如 workbuddy, qoder)
  if (Array.isArray(rawModel.reasoning?.supportedEfforts)) {
    for (const lvl of rawModel.reasoning.supportedEfforts) {
      if (lvl && typeof lvl === 'string') {
        levels.add(lvl.trim())
      }
    }
  }

  // 2. 从 rawModel.reasoning.supported 提取 (如 trae)
  if (Array.isArray(rawModel.reasoning?.supported)) {
    for (const lvl of rawModel.reasoning.supported) {
      if (lvl && typeof lvl === 'string') {
        levels.add(lvl.trim())
      }
    }
  }

  // 3. 从 rawModel.reasoningEfforts 对象提取 (如 llm-pi-ai / HSB / trae)
  if (rawModel.reasoningEfforts && typeof rawModel.reasoningEfforts === 'object') {
    for (const [k, v] of Object.entries(rawModel.reasoningEfforts)) {
      const keyClean = String(k).trim().toLowerCase()
      if (['off', 'false', 'none', 'null'].includes(keyClean)) continue
      levels.add(keyClean)
    }
  }

  // 4. 从 rawModel.availableReasoningLevels 提取 (若已有)
  if (Array.isArray(rawModel.availableReasoningLevels)) {
    for (const lvl of rawModel.availableReasoningLevels) {
      if (lvl && typeof lvl === 'string') {
        levels.add(lvl.trim())
      }
    }
  }

  // 5. 从 rawModel.thinkingLevels 提取
  if (Array.isArray(rawModel.thinkingLevels)) {
    for (const lvl of rawModel.thinkingLevels) {
      if (lvl && typeof lvl === 'string') {
        levels.add(lvl.trim())
      }
    }
  }

  // 6. 如果标记了支持思考但没列出具体等级，兜底提供标准等级 [low, medium, high]
  if (levels.size === 0) {
    if (rawModel.reasoningSupported === true || rawModel.reasoning?.supports === true) {
      levels.add('low')
      levels.add('medium')
      levels.add('high')
    }
  }

  // 过滤无效或关闭状态标记
  levels.delete('off')
  levels.delete('false')
  levels.delete('none')
  levels.delete('null')

  return Array.from(levels)
}

/**
 * 提取当前选中的思考等级或自动选中默认等级
 */
export function extractCurrentReasoningLevel(
  rawModel: Record<string, any>,
  availableLevels: string[]
): string {
  if (!rawModel || typeof rawModel !== 'object') return 'off'

  // 1. 显式配置了 defaultEffort
  if (rawModel.reasoning?.defaultEffort && typeof rawModel.reasoning.defaultEffort === 'string') {
    const val = rawModel.reasoning.defaultEffort.trim()
    if (availableLevels.includes(val) || val === 'off') return val
  }

  // 2. 显式配置了 reasoningEffort 或 reasoningLevel
  if (rawModel.reasoningEffort && typeof rawModel.reasoningEffort === 'string') {
    const val = rawModel.reasoningEffort.trim()
    if (availableLevels.includes(val) || val === 'off') return val
  }
  if (rawModel.reasoningLevel && typeof rawModel.reasoningLevel === 'string') {
    const val = rawModel.reasoningLevel.trim()
    if (availableLevels.includes(val) || val === 'off') return val
  }

  // 3. 如果有支持的思考等级，自动选中默认等级
  if (availableLevels.length > 0) {
    if (availableLevels.includes('high')) return 'high'
    if (availableLevels.includes('medium')) return 'medium'
    return availableLevels[0] || 'low'
  }

  return 'off'
}
