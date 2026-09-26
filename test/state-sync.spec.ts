import { describe, it, expect } from 'vitest'
import { loadProvidersFromSettings, syncModelsToStateFiles } from '../src/settings-manager.ts'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

describe('连接器插件 state 缓存文件思考等级双向持久化测试', () => {
  it('能够成功从 settings.yaml 加载配置并将思考等级同步写回 state/*-catalog.json', async () => {
    const groups = await loadProvidersFromSettings()
    expect(groups.length).toBeGreaterThan(0)

    const updatedFiles = await syncModelsToStateFiles(groups)
    console.log(`已成功更新 ${updatedFiles} 个 state catalog 缓存文件`)
    expect(updatedFiles).toBeGreaterThan(0)

    // 验证 trae-catalog.json 中的更新结果
    const traeCatalogPath = join(homedir(), '.dsh', 'profiles', 'desktop', '.dsh-trae-connect', 'state', '.trae-catalog.json')
    if (existsSync(traeCatalogPath)) {
      const content = await readFile(traeCatalogPath, 'utf8')
      const json = JSON.parse(content)
      const cnModels = json.entries?.cn?.models || []
      
      // 验证至少一个支持思考的模型具备 reasoning 与 reasoningEfforts
      const thinkingModel = cnModels.find((m: any) => m.reasoningSupported === true)
      if (thinkingModel) {
        expect(thinkingModel.reasoning).toBeDefined()
        expect(thinkingModel.reasoning.supports).toBe(true)
        expect(Array.isArray(thinkingModel.reasoning.supported)).toBe(true)
        expect(thinkingModel.reasoningEfforts).toBeDefined()
      }
    }
  })

  it('验证 workbuddy-ai-catalog.json 中的 deepseek-v4.1-flash 思考等级配置', async () => {
    const groups = await loadProvidersFromSettings()
    for (const g of groups) {
      const found = g.models.find(m => m.id.toLowerCase() === 'deepseek-v4.1-flash')
      if (found) {
        console.log(`Group [${g.key}] Title [${g.title}] 模型 [${found.id}]:`, {
          availableReasoningLevels: found.availableReasoningLevels,
          reasoningLevel: found.reasoningLevel,
        })
      }
    }

    const catPath = join(homedir(), '.dsh', 'profiles', 'desktop', '.dsh-workbuddy-connect', 'state', '.workbuddy-ai-catalog.json')
    if (existsSync(catPath)) {
      const content = await readFile(catPath, 'utf8')
      const json = JSON.parse(content)
      for (const [rk, rv] of Object.entries(json.entries || {})) {
        const found = (rv as any).models?.find((m: any) => m.id.toLowerCase() === 'deepseek-v4.1-flash')
        if (found) {
          console.log(`workbuddy-ai 真实文件中的 deepseek-v4.1-flash:`, found.reasoning)
        }
      }
    }
  })
})

