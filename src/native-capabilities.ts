import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface NativeModelCapability {
  effortValues?: string[]
  supportsReasoning?: boolean
}

// 缓存原生能力映射表: providerNormalized -> Map<modelIdNormalized, NativeModelCapability>
let nativeCache: Map<string, Map<string, NativeModelCapability>> | null = null

/**
 * 扫描并加载所有本地连接器（OpenCode, Qoder, WorkBuddy, Trae等）官方真实下发的模型能力
 */
export function loadNativeConnectorCapabilities(forceRefresh = false): Map<string, Map<string, NativeModelCapability>> {
  if (nativeCache && !forceRefresh) {
    return nativeCache
  }

  const result = new Map<string, Map<string, NativeModelCapability>>()
  const home = homedir()

  function getProviderMap(providerKey: string): Map<string, NativeModelCapability> {
    const norm = providerKey.toLowerCase().replace(/\.models$/i, '').trim()
    let map = result.get(norm)
    if (!map) {
      map = new Map()
      result.set(norm, map)
    }
    return map
  }

  // 1. OpenCode 原生真实模型能力 (~/.OpenCode/agent-config.json.models.dev.json)
  try {
    const opencodePath = join(home, '.OpenCode', 'agent-config.json.models.dev.json')
    if (existsSync(opencodePath)) {
      const data = JSON.parse(readFileSync(opencodePath, 'utf8'))
      const opencodeMap = getProviderMap('opencode')
      if (Array.isArray(data.prices)) {
        for (const [id, meta] of data.prices) {
          if (typeof id === 'string' && meta && typeof meta === 'object') {
            const effortValues = Array.isArray(meta.effortValues)
              ? meta.effortValues.map(String).filter((lvl: string) => !['off', 'false', 'none', 'null'].includes(lvl.toLowerCase()))
              : []
            opencodeMap.set(id.toLowerCase().trim(), {
              effortValues,
              supportsReasoning: meta.reasoning === true,
            })
          }
        }
      }
    }
  } catch {}

  // 2. Qoder 原生真实模型能力 (~/.dsh/profiles/desktop/.dsh-qoder-connect/state/*-catalog.json)
  try {
    const qoderStateDir = join(home, '.dsh', 'profiles', 'desktop', '.dsh-qoder-connect', 'state')
    if (existsSync(qoderStateDir)) {
      const files = readdirSync(qoderStateDir).filter(f => f.endsWith('-catalog.json'))
      for (const file of files) {
        try {
          const content = JSON.parse(readFileSync(join(qoderStateDir, file), 'utf8'))
          const providerKey = file.includes('global') ? 'qoder-global' : 'qoder'
          const pMap = getProviderMap(providerKey)

          // 兼容 entries 字典结构
          const modelList: any[] = []
          if (content.entries && typeof content.entries === 'object') {
            for (const entry of Object.values(content.entries) as any[]) {
              if (Array.isArray(entry.models)) modelList.push(...entry.models)
              else if (Array.isArray(entry.catalog)) modelList.push(...entry.catalog)
            }
          }
          if (Array.isArray(content.models)) modelList.push(...content.models)
          if (Array.isArray(content)) modelList.push(...content)

          for (const m of modelList) {
            const id = (m.id || m.key || '').toLowerCase().trim()
            if (!id) continue

            let efforts: string[] | undefined
            if (Array.isArray(m.reasoning?.supportedEfforts)) efforts = m.reasoning.supportedEfforts
            else if (Array.isArray(m.reasoning?.supported)) efforts = m.reasoning.supported
            else if (Array.isArray(m.supportedEfforts)) efforts = m.supportedEfforts
            else if (Array.isArray(m.thinkingLevels)) efforts = m.thinkingLevels

            if (efforts) {
              const cleaned = efforts.map(String).filter(lvl => !['off', 'false', 'none', 'null'].includes(lvl.toLowerCase()))
              pMap.set(id, {
                effortValues: cleaned,
                supportsReasoning: m.reasoning?.supports === true || m.reasoningSupported === true,
              })
            }
          }
        } catch {}
      }
    }
  } catch {}

  // 3. Trae 原生真实模型能力 (~/.dsh/profiles/desktop/.dsh-trae-connect/state/*-catalog.json)
  try {
    const traeStateDir = join(home, '.dsh', 'profiles', 'desktop', '.dsh-trae-connect', 'state')
    if (existsSync(traeStateDir)) {
      const files = readdirSync(traeStateDir).filter(f => f.endsWith('-catalog.json'))
      for (const file of files) {
        try {
          const content = JSON.parse(readFileSync(join(traeStateDir, file), 'utf8'))
          const providerKey = file.includes('global') ? 'trae-global' : 'trae'
          const pMap = getProviderMap(providerKey)
          const modelList: any[] = Array.isArray(content.models) ? content.models : (Array.isArray(content) ? content : [])
          for (const m of modelList) {
            const id = (m.id || '').toLowerCase().trim()
            if (!id) continue
            let efforts: string[] | undefined
            if (Array.isArray(m.reasoning?.supported)) efforts = m.reasoning.supported
            else if (Array.isArray(m.supportedEfforts)) efforts = m.supportedEfforts
            if (efforts) {
              pMap.set(id, {
                effortValues: efforts.map(String).filter(lvl => !['off', 'false', 'none', 'null'].includes(lvl.toLowerCase())),
                supportsReasoning: m.reasoning?.supports === true,
              })
            }
          }
        } catch {}
      }
    }
  } catch {}

  // 4. WorkBuddy 原生真实模型能力 (~/.dsh/profiles/desktop/.dsh-workbuddy-connect/state/*-catalog.json)
  try {
    const wbStateDir = join(home, '.dsh', 'profiles', 'desktop', '.dsh-workbuddy-connect', 'state')
    if (existsSync(wbStateDir)) {
      const files = readdirSync(wbStateDir).filter(f => f.endsWith('-catalog.json'))
      for (const file of files) {
        try {
          const content = JSON.parse(readFileSync(join(wbStateDir, file), 'utf8'))
          const providerKey = file.includes('ai') ? 'workbuddy-ai' : 'workbuddy'
          const pMap = getProviderMap(providerKey)
          const modelList: any[] = Array.isArray(content.models) ? content.models : (Array.isArray(content) ? content : [])
          for (const m of modelList) {
            const id = (m.id || '').toLowerCase().trim()
            if (!id) continue
            let efforts: string[] | undefined
            if (Array.isArray(m.reasoning?.supportedEfforts)) efforts = m.reasoning.supportedEfforts
            else if (Array.isArray(m.supportedEfforts)) efforts = m.supportedEfforts
            if (efforts) {
              pMap.set(id, {
                effortValues: efforts.map(String).filter(lvl => !['off', 'false', 'none', 'null'].includes(lvl.toLowerCase())),
                supportsReasoning: m.reasoning?.supports === true,
              })
            }
          }
        } catch {}
      }
    }
  } catch {}

  nativeCache = result
  return result
}

/**
 * 查询指定供应商与模型的原生真实思考等级声明
 * 若本地连接器有明确声明，返回真实档位数组（空数组表示上游不支持分级调级，绝不能塞假档位）；
 * 若本地连接器未声明该模型，返回 undefined（允许降级使用 models.dev 数据）
 */
export function getNativeModelReasoning(providerKey: string, modelId: string): NativeModelCapability | undefined {
  const caps = loadNativeConnectorCapabilities()
  const pNorm = (providerKey || '').toLowerCase().replace(/\.models$/i, '').trim()
  const mNorm = (modelId || '').toLowerCase().trim()

  for (const [k, pMap] of caps.entries()) {
    if (k === pNorm || pNorm.includes(k) || k.includes(pNorm)) {
      if (pMap.has(mNorm)) {
        return pMap.get(mNorm)
      }
    }
  }

  return undefined
}
