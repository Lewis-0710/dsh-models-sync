import { describe, it, expect } from 'vitest'
import { loadProvidersFromSettings, saveModelsToSettings } from '../src/settings-manager.ts'
import { loadModelsDev } from '../src/catalog.ts'
import { matchModel, applyMatchToModel } from '../src/matcher.ts'

describe('验证用户问题模型在同步后的思考等级修复效果', () => {
  it('正确加载、匹配、并验证思考等级与默认档位', async () => {
    const catalog = await loadModelsDev(false)
    const groups = await loadProvidersFromSettings()

    // 1. 测试 OpenCode 组
    const opencodeGroup = groups.find(g => g.key.toLowerCase().includes('opencode'))
    expect(opencodeGroup).toBeDefined()
    if (opencodeGroup) {
      const nonEffortModelIds = [
        'big-pickle',
        'mimo-v2.5-free',
        'mimo-v2.6-flash-free',
        'nemotron-3-ultra-free',
        'nemotron-3.5-lightning-free',
        'ling-3.0-flash-fin-free',
        'longcat-2.5-preview-free',
      ]
      for (const id of nonEffortModelIds) {
        const m = opencodeGroup.models.find(item => item.id === id)
        if (m) {
          const match = matchModel(m.id, m.name, catalog)
          if (match) applyMatchToModel(m, match, opencodeGroup.key)
          console.log(`OpenCode ${id} -> thinkingLevels:`, m.availableReasoningLevels, 'reasoningLevel:', m.reasoningLevel)
          // 必须无分级档位，且 reasoningLevel 必须为 off
          expect(m.availableReasoningLevels).toEqual([])
          expect(m.reasoningLevel).toBe('off')
        }
      }
    }

    // 2. 测试 Qoder 组中的 qfmodel
    const qoderGroup = groups.find(g => g.key.toLowerCase().includes('qoder'))
    expect(qoderGroup).toBeDefined()
    if (qoderGroup) {
      const qf = qoderGroup.models.find(m => m.id === 'qfmodel')
      if (qf) {
        const match = matchModel(qf.id, qf.name, catalog)
        if (match) applyMatchToModel(qf, match, qoderGroup.key)
        console.log(`Qoder qfmodel -> thinkingLevels:`, qf.availableReasoningLevels, 'reasoningLevel:', qf.reasoningLevel)
        // 绝不能包含 high，且 reasoningLevel 绝不能是 high
        expect(qf.availableReasoningLevels).not.toContain('high')
        expect(qf.reasoningLevel).not.toBe('high')
      }
    }

    // 3. 执行 saveModelsToSettings 保存并校验 settings.yaml 真实写回结果
    const saveResult = await saveModelsToSettings(groups)
    expect(saveResult).toBe(true)

    // 重新从 settings.yaml 加载，确保持久化完全一致
    const reloadedGroups = await loadProvidersFromSettings()
    const reloadedOpencode = reloadedGroups.find(g => g.key.toLowerCase().includes('opencode'))
    const reloadedBp = reloadedOpencode?.models.find(m => m.id === 'big-pickle')
    expect(reloadedBp?.availableReasoningLevels).toEqual([])
    expect(reloadedBp?.reasoningLevel).toBe('off')

    const reloadedQoder = reloadedGroups.find(g => g.key.toLowerCase().includes('qoder'))
    const reloadedQf = reloadedQoder?.models.find(m => m.id === 'qfmodel')
    expect(reloadedQf?.availableReasoningLevels).not.toContain('high')
    expect(reloadedQf?.reasoningLevel).toBe('medium')
  })
})
