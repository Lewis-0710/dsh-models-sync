import { describe, it, expect } from 'vitest'
import { extractAvailableReasoningLevels, extractCurrentReasoningLevel } from '../src/settings-manager.ts'
import { applyMatchToModel } from '../src/matcher.ts'
import type { ModelInfo, MatchResult } from '../src/types.ts'

describe('思考等级解析与自动默认选中测试', () => {
  it('正确解析 workbuddy 中的 supportedEfforts 与 defaultEffort', () => {
    const raw = {
      id: 'auto',
      reasoning: {
        supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffort: 'high',
      },
    }
    const levels = extractAvailableReasoningLevels(raw)
    expect(levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    const current = extractCurrentReasoningLevel(raw, levels)
    expect(current).toBe('high')
  })

  it('正确解析 trae 中的 reasoning.supported', () => {
    const raw = {
      id: 'Doubao-Seed-2.1-Pro',
      reasoning: {
        supported: ['low', 'high'],
        defaultEffort: 'high',
      },
    }
    const levels = extractAvailableReasoningLevels(raw)
    expect(levels).toEqual(['low', 'high'])
    const current = extractCurrentReasoningLevel(raw, levels)
    expect(current).toBe('high')
  })

  it('正确解析 llm-pi-ai / HSB 中的 reasoningEfforts 对象', () => {
    const raw = {
      id: 'qwen3.7-plus',
      reasoningEfforts: {
        off: null,
        minimal: 'minimal',
        low: 'low',
        medium: 'medium',
        high: 'high',
      },
    }
    const levels = extractAvailableReasoningLevels(raw)
    expect(levels).toContain('minimal')
    expect(levels).toContain('low')
    expect(levels).toContain('medium')
    expect(levels).toContain('high')
    expect(levels).not.toContain('off')

    const current = extractCurrentReasoningLevel(raw, levels)
    expect(current).toBe('high') // 自动推荐默认等级为 high
  })

  it('对于不支持思考等级的模型（如 LongCat-2.0 ），正确识别为 off 且列表为空', () => {
    const raw = {
      id: 'LongCat-2.0',
      reasoningEfforts: false,
    }
    const levels = extractAvailableReasoningLevels(raw)
    expect(levels).toEqual([])
    const current = extractCurrentReasoningLevel(raw, levels)
    expect(current).toBe('off')
  })

  it('applyMatchToModel 动态合并 models.dev 的思考等级并自动选中默认等级', () => {
    const model: ModelInfo = {
      id: 'test-model',
      name: 'Test Model',
      supportsImages: false,
      supportsText: true,
      reasoningLevel: 'off',
      availableReasoningLevels: [],
      rawPath: 'test.0',
    }

    const match: MatchResult = {
      matchedVia: 'id',
      entry: {
        id: 'test-model',
        name: 'Test Model',
        input: ['text', 'image'],
        thinkingLevels: ['minimal', 'low', 'medium', 'high'],
      },
    }

    applyMatchToModel(model, match)
    expect(model.availableReasoningLevels).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(model.reasoningLevel).toBe('high')
  })
})
