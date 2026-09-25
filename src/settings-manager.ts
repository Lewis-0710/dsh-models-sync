import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import YAML from 'yaml'
import type { ModelInfo, ProviderGroupInfo, ThinkingLevel } from './types.ts'

const SETTINGS_PATH = join(homedir(), '.dsh', 'settings.yaml')
const BACKUP_DIR = join(homedir(), '.dsh', 'backups')

import { extractAvailableReasoningLevels, extractCurrentReasoningLevel } from './reasoning-utils.ts'
export { extractAvailableReasoningLevels, extractCurrentReasoningLevel }


/**
 * 判断是否支持图片
 */
function extractSupportsImages(rawModel: Record<string, any>): boolean {
  if (rawModel.supportsImages === true) return true
  if (Array.isArray(rawModel.input) && rawModel.input.includes('image')) return true
  return false
}

import { readdirSync } from 'node:fs'

/**
 * 从各个插件本地的状态缓存文件（state/*-catalog.json）读取已配置/已缓存的模型列表
 */
import { basename } from 'node:path'

/**
 * 动态从各个插件本地状态缓存文件提取已缓存的模型列表（100% 动态读取，零硬编码映射）
 */
export async function loadProvidersFromStateFiles(): Promise<ProviderGroupInfo[]> {
  const groups: ProviderGroupInfo[] = []
  const baseDir = join(homedir(), '.dsh')

  function walk(dir: string, depth = 0): string[] {
    if (depth > 5 || !existsSync(dir)) return []
    const results: string[] = []
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '.git') {
            results.push(...walk(full, depth + 1))
          }
        } else if (entry.name.endsWith('-catalog.json')) {
          results.push(full)
        }
      }
    } catch {}
    return results
  }

  const catalogFiles = walk(baseDir)
  for (const file of catalogFiles) {
    try {
      const content = await readFile(file, 'utf8')
      const json = JSON.parse(content)
      if (json.entries && typeof json.entries === 'object') {
        const baseSlug = basename(file).replace(/^\./, '').replace(/-catalog\.json$/, '')

        for (const [regionKey, regionVal] of Object.entries(json.entries as Record<string, any>)) {
          if (Array.isArray(regionVal?.models) && regionVal.models.length > 0) {
            // 动态解析标题与标识符：优先使用配置元数据自声明的 displayName / name
            const dynamicTitle = regionVal.displayName
              || regionVal.name
              || (regionVal.account && typeof regionVal.account === 'string' && !regionVal.account.includes(':') ? `${baseSlug} (${regionVal.account})` : baseSlug)
              || regionKey
            const dynamicKey = `${baseSlug}.${regionKey}`
            const rawParentKey = `${baseSlug}.regions.${regionKey}.lastCatalog`

            groups.push({
              key: dynamicKey,
              title: dynamicTitle,
              isCustom: false,
              models: parseCatalogList(regionVal.models, rawParentKey),
            })
          }
        }
      }
    } catch {}
  }

  return groups
}

/**
 * 通用动态读取并解析 settings.yaml 中的所有模型提供商（全动态遍历，零特定供应商写死）
 */
export async function loadProvidersFromSettings(): Promise<ProviderGroupInfo[]> {
  const groupMap = new Map<string, ProviderGroupInfo>()

  // 1. 全动态深度解析 settings.yaml 中的所有提供商配置节点
  if (existsSync(SETTINGS_PATH)) {
    try {
      const content = await readFile(SETTINGS_PATH, 'utf8')
      const doc = YAML.parse(content) as Record<string, any>
      if (doc && typeof doc === 'object') {
        for (const [topKey, topVal] of Object.entries(doc)) {
          if (!topVal || typeof topVal !== 'object') continue

          // 结构 A：带有 regions 分区的提供商（如 trae, workbuddy 等）
          if (topVal.regions && typeof topVal.regions === 'object') {
            for (const [rKey, rVal] of Object.entries(topVal.regions as Record<string, any>)) {
              if (Array.isArray(rVal?.lastCatalog) && rVal.lastCatalog.length > 0) {
                const title = rVal.displayName || rVal.name || topVal.displayName || `${topKey}.${rKey}`
                groupMap.set(`${topKey}.${rKey}`, {
                  key: `${topKey}.${rKey}`,
                  title,
                  isCustom: false,
                  models: parseCatalogList(rVal.lastCatalog, `${topKey}.regions.${rKey}.lastCatalog`),
                })
              }
            }
          }

          // 结构 B：带有 providers 字典的聚合插件（如 llm-pi-ai 等自定义提供商）
          if (topVal.providers && typeof topVal.providers === 'object') {
            for (const [pKey, pVal] of Object.entries(topVal.providers as Record<string, any>)) {
              if (Array.isArray(pVal?.models) && pVal.models.length > 0) {
                const title = pVal.displayName || pVal.name || pKey
                groupMap.set(`${topKey}.providers.${pKey}`, {
                  key: `${topKey}.providers.${pKey}`,
                  title,
                  isCustom: true,
                  models: parseCatalogList(pVal.models, `${topKey}.providers.${pKey}.models`),
                })
              }
            }
          }

          // 结构 C：根节点直接挂载 models 数组的常规提供商插件（如 llm-deepseek 等）
          if (Array.isArray(topVal.models) && topVal.models.length > 0) {
            const title = topVal.displayName || topVal.name || topKey
            groupMap.set(`${topKey}.models`, {
              key: `${topKey}.models`,
              title,
              isCustom: false,
              models: parseCatalogList(topVal.models, `${topKey}.models`),
            })
          }
        }
      }
    } catch {}
  }

  // 2. 深度扫描各插件本地 state 文件，自动兜底补齐未显式写入 settings.yaml 的模型
  const stateGroups = await loadProvidersFromStateFiles()
  for (const sg of stateGroups) {
    if (!groupMap.has(sg.key) || (groupMap.get(sg.key)?.models.length || 0) < sg.models.length) {
      groupMap.set(sg.key, sg)
    }
  }

  return Array.from(groupMap.values())
}

function parseCatalogList(list: any[], rawBasePath: string): ModelInfo[] {
  return list.map((item, index) => {
    const id = String(item.id || '')
    const name = String(item.name || id)
    const contextWindow = typeof item.contextWindow === 'number'
      ? item.contextWindow
      : (typeof item.maxContextWindow === 'number' ? item.maxContextWindow : undefined)
    const maxOutput = typeof item.maxTokens === 'number'
      ? item.maxTokens
      : (typeof item.maxOutput === 'number' ? item.maxOutput : undefined)

    const availableReasoningLevels = extractAvailableReasoningLevels(item)
    const reasoningLevel = extractCurrentReasoningLevel(item, availableReasoningLevels)

    return {
      id,
      name,
      contextWindow,
      maxOutput,
      supportsImages: extractSupportsImages(item),
      supportsText: true,
      reasoningLevel,
      availableReasoningLevels,
      rawPath: `${rawBasePath}.${index}`,
      rawIndex: index,
      rawParentKey: rawBasePath,
    }
  })
}

/**
 * 确保 YAML 文档路径存在，并返回目标 Seq 节点
 */
function ensureYamlSeq(doc: any, pathParts: string[]): any {
  let current: any = doc
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i]
    let next = current.get ? current.get(part) : current[part]
    if (!next) {
      if (i === pathParts.length - 1) {
        next = new YAML.YAMLSeq()
      } else {
        next = new YAML.YAMLMap()
      }
      if (current.set) {
        current.set(part, next)
      } else {
        current[part] = next
      }
    }
    current = next
  }
  return current
}

/**
 * 全量将更正后的模型参数写回 settings.yaml，保留原有结构与注释；节点不存在时自动补全创建
 */
export async function saveModelsToSettings(groups: ProviderGroupInfo[]): Promise<boolean> {
  let rawText = ''
  if (existsSync(SETTINGS_PATH)) {
    rawText = await readFile(SETTINGS_PATH, 'utf8')
  }

  // 使用 YAML.parseDocument 保留所有格式与注释
  const doc = YAML.parseDocument(rawText || '')

  // 自动创建备份
  try {
    if (!existsSync(BACKUP_DIR)) {
      await mkdir(BACKUP_DIR, { recursive: true })
    }
    const backupFile = join(BACKUP_DIR, `settings.yaml.${Date.now()}.bak`)
    await writeFile(backupFile, rawText, 'utf8')
  } catch {
    // 忽略备份异常
  }

  for (const group of groups) {
    // 动态推导目标保存路径
    let targetParentKey = ''
    const gKeyLower = (group.key || '').toLowerCase()
    if (gKeyLower.includes('trae') && (gKeyLower.includes('ai') || gKeyLower.includes('global'))) {
      targetParentKey = 'trae.regions.ai.lastCatalog'
    } else if (gKeyLower.includes('trae')) {
      targetParentKey = 'trae.regions.cn.lastCatalog'
    } else if (gKeyLower.includes('workbuddy') && (gKeyLower.includes('ai') || gKeyLower.includes('global'))) {
      targetParentKey = 'workbuddy.regions.ai.lastCatalog'
    } else if (gKeyLower.includes('workbuddy')) {
      targetParentKey = 'workbuddy.regions.cn.lastCatalog'
    } else if (gKeyLower.startsWith('llm-pi-ai.providers.')) {
      targetParentKey = `${group.key}.models`
    } else if (gKeyLower === 'llm-deepseek.models') {
      targetParentKey = 'llm-deepseek.models'
    } else {
      targetParentKey = group.models[0]?.rawParentKey || `${group.key}.models`
    }

    const pathParts = targetParentKey.split('.')
    const listSeq = ensureYamlSeq(doc, pathParts)

    for (let idx = 0; idx < group.models.length; idx++) {
      const model = group.models[idx]
      let itemNode: any = null

      // 1. 优先在当前列表中按 id 查找已有模型节点（避免错位）
      if (listSeq.items && Array.isArray(listSeq.items)) {
        itemNode = listSeq.items.find((it: any) => it && (it.get ? it.get('id') : it['id']) === model.id)
      }

      // 2. 若未按 id 找到，且该序号存在节点，使用该序号节点
      if (!itemNode && listSeq.items && listSeq.items[idx]) {
        itemNode = listSeq.items[idx]
      }

      // 3. 都不存在时新建 YAMLMap 节点
      if (!itemNode) {
        itemNode = new YAML.YAMLMap()
        itemNode.set('id', model.id)
        itemNode.set('name', model.name)
        listSeq.add(itemNode)
      }

      if (itemNode) {
        // 保证基础元数据准确
        if (!itemNode.has('id')) itemNode.set('id', model.id)
        if (model.name) itemNode.set('name', model.name)

        // 更新 contextWindow
        if (model.contextWindow !== undefined && model.contextWindow > 0) {
          itemNode.set('contextWindow', model.contextWindow)
        }
        // 更新 maxTokens / maxOutput
        if (model.maxOutput !== undefined && model.maxOutput > 0) {
          itemNode.set('maxTokens', model.maxOutput)
        }
        // 更新图片支持
        itemNode.set('supportsImages', model.supportsImages === true)
        const inputs = ['text']
        if (model.supportsImages === true) inputs.push('image')
        itemNode.set('input', inputs)

        // ========================================================
        // 核心：全量将每个模型支持的思考等级列表与选中的默认值写入配置文件
        // ========================================================
        const rawLevels = Array.isArray(model.availableReasoningLevels)
          ? model.availableReasoningLevels.map(String).map(s => s.trim().toLowerCase())
          : []
        const levels = Array.from(new Set(rawLevels.filter(lvl => lvl && !['off', 'false', 'none', 'null'].includes(lvl))))
        const hasReasoning = levels.length > 0

        // 默认选中的思考等级（默认值）
        let currentEffort = 'off'
        if (model.reasoningLevel && typeof model.reasoningLevel === 'string') {
          const clean = model.reasoningLevel.trim().toLowerCase()
          if (levels.includes(clean) || clean === 'off') {
            currentEffort = clean
          }
        }
        if (currentEffort === 'off' && hasReasoning) {
          if (levels.includes('high')) currentEffort = 'high'
          else if (levels.includes('medium')) currentEffort = 'medium'
          else currentEffort = levels[0]
        }

        // 1. 写入思考支持状态布尔标记
        itemNode.set('reasoningSupported', hasReasoning)

        // 2. 写入支持的全部思考等级列表
        itemNode.set('thinkingLevels', levels)
        itemNode.set('supportedEfforts', levels)

        // 3. 写入选中的默认值
        itemNode.set('reasoningEffort', currentEffort)
        itemNode.set('reasoningLevel', currentEffort)

        // 4. 写入/更新标准嵌套 reasoning 对象
        let rNode = itemNode.get ? itemNode.get('reasoning') : itemNode['reasoning']
        if (!rNode || typeof rNode !== 'object' || typeof rNode.set !== 'function') {
          rNode = new YAML.YAMLMap()
          itemNode.set('reasoning', rNode)
        }
        rNode.set('supports', hasReasoning)
        rNode.set('defaultEffort', currentEffort === 'off' ? null : currentEffort)
        rNode.set('supportedEfforts', levels)
        rNode.set('supported', levels)
        if (hasReasoning) {
          rNode.set('canDisableThinking', true)
        }

        // 5. 若存在 reasoningEfforts 映射对象格式，同步维护
        if (itemNode.has && itemNode.has('reasoningEfforts')) {
          const effortsMap: Record<string, string | null> = { off: null }
          for (const lvl of levels) {
            effortsMap[lvl] = lvl
          }
          itemNode.set('reasoningEfforts', effortsMap)
        }
      }
    }
  }

  // 1. 安全写入 settings.yaml
  const newContent = doc.toString()
  await writeFile(SETTINGS_PATH, newContent, 'utf8')

  // 2. 核心：同步更新所有连接器本地状态缓存文件（state/*-catalog.json）
  try {
    await syncModelsToStateFiles(groups)
  } catch {
    // 容错处理，避免异常阻断
  }

  return true
}

/**
 * 动态将模型参数与思考等级全量同步回写至各连接器插件本地的 state/*-catalog.json 缓存文件
 * （解决 DSH Desktop 对话框选择模型时因 state 缓存缺少 reasoning 字段而无法选择思考等级的问题）
 */
export async function syncModelsToStateFiles(groups: ProviderGroupInfo[]): Promise<number> {
  const baseDir = join(homedir(), '.dsh')

  function walk(dir: string, depth = 0): string[] {
    if (depth > 5 || !existsSync(dir)) return []
    const results: string[] = []
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '.git') {
            results.push(...walk(full, depth + 1))
          }
        } else if (entry.name.endsWith('-catalog.json')) {
          results.push(full)
        }
      }
    } catch {}
    return results
  }

  // 建立动态高效检索索引
  const directMap = new Map<string, ModelInfo>()
  const fallbackIdMap = new Map<string, ModelInfo>()
  const fallbackNameMap = new Map<string, ModelInfo>()

  for (const group of groups) {
    const gKey = (group.key || '').toLowerCase()
    for (const model of group.models) {
      const idKey = (model.id || '').toLowerCase()
      const nameKey = (model.name || '').toLowerCase()
      if (idKey) {
        directMap.set(`${gKey}:${idKey}`, model)
        if (!fallbackIdMap.has(idKey)) {
          fallbackIdMap.set(idKey, model)
        }
      }
      if (nameKey && !fallbackNameMap.has(nameKey)) {
        fallbackNameMap.set(nameKey, model)
      }
    }
  }

  const catalogFiles = walk(baseDir)
  let updatedFilesCount = 0

  for (const file of catalogFiles) {
    try {
      const content = await readFile(file, 'utf8')
      const json = JSON.parse(content)
      if (!json || typeof json !== 'object' || !json.entries || typeof json.entries !== 'object') {
        continue
      }

      const baseSlug = basename(file).replace(/^\./, '').replace(/-catalog\.json$/, '').toLowerCase()
      let fileModified = false

      for (const [regionKey, regionVal] of Object.entries(json.entries as Record<string, any>)) {
        if (!Array.isArray(regionVal?.models)) continue
        const rKeyLower = regionKey.toLowerCase()

        for (const item of regionVal.models) {
          if (!item || typeof item !== 'object' || !item.id) continue
          const itemIdLower = String(item.id).toLowerCase()
          const itemNameLower = String(item.name || '').toLowerCase()

          // 动态三级匹配：复合路径 -> ID 兜底 -> 名称兜底
          const matchedModel =
            directMap.get(`${baseSlug}.${rKeyLower}:${itemIdLower}`) ||
            directMap.get(`${baseSlug}:${itemIdLower}`) ||
            fallbackIdMap.get(itemIdLower) ||
            fallbackNameMap.get(itemNameLower)

          if (!matchedModel) continue

          const rawLevels = Array.isArray(matchedModel.availableReasoningLevels)
            ? matchedModel.availableReasoningLevels.map(String).map(s => s.trim().toLowerCase())
            : []
          const levels = Array.from(new Set(rawLevels.filter(lvl => lvl && !['off', 'false', 'none', 'null'].includes(lvl))))
          const hasReasoning = levels.length > 0

          let currentEffort = 'off'
          if (matchedModel.reasoningLevel && typeof matchedModel.reasoningLevel === 'string') {
            const clean = matchedModel.reasoningLevel.trim().toLowerCase()
            if (levels.includes(clean) || clean === 'off') {
              currentEffort = clean
            }
          }
          if (currentEffort === 'off' && hasReasoning) {
            if (levels.includes('high')) currentEffort = 'high'
            else if (levels.includes('medium')) currentEffort = 'medium'
            else currentEffort = levels[0]
          }

          if (hasReasoning) {
            item.reasoningSupported = true
            item.thinkingLevels = levels
            item.supportedEfforts = levels
            item.reasoningEffort = currentEffort
            item.reasoning = {
              supports: true,
              supported: levels,
              supportedEfforts: levels,
              defaultEffort: currentEffort === 'off' ? (levels.includes('high') ? 'high' : levels[0]) : currentEffort,
              canDisableThinking: true,
            }

            const effortsMap: Record<string, string | null> = {
              off: null,
              low: levels.includes('low') ? 'light' : null,
              medium: levels.includes('medium') ? 'medium' : null,
              high: levels.includes('high') ? 'high' : null,
              xhigh: levels.includes('xhigh') ? 'extra_high' : null,
              max: levels.includes('max') ? 'max' : null,
            }
            for (const lvl of levels) {
              if (!effortsMap[lvl]) {
                effortsMap[lvl] = lvl === 'low' ? 'light' : (lvl === 'xhigh' ? 'extra_high' : lvl)
              }
            }
            item.reasoningEfforts = effortsMap
          } else {
            item.reasoningSupported = false
            if (item.reasoning && typeof item.reasoning === 'object') {
              item.reasoning.supports = false
              delete item.reasoning.supported
              delete item.reasoning.supportedEfforts
            }
            delete item.reasoningEfforts
            delete item.thinkingLevels
            delete item.supportedEfforts
          }

          if (matchedModel.contextWindow && matchedModel.contextWindow > 0) {
            item.contextWindow = matchedModel.contextWindow
          }
          if (matchedModel.maxOutput && matchedModel.maxOutput > 0) {
            item.maxTokens = matchedModel.maxOutput
          }
          if (matchedModel.supportsImages !== undefined) {
            item.supportsImages = matchedModel.supportsImages
            const input = ['text']
            if (matchedModel.supportsImages) input.push('image')
            item.input = input
          }

          fileModified = true
        }
      }

      if (fileModified) {
        await writeFile(file, JSON.stringify(json, null, 2), 'utf8')
        updatedFilesCount++
      }
    } catch {}
  }

  return updatedFilesCount
}
