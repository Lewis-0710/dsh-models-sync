import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { loadProvidersFromSettings, saveModelsToSettings } from './settings-manager.ts'
import { loadModelsDev } from './catalog.ts'
import { matchModel, applyMatchToModel } from './matcher.ts'
import { probeModels, resolveProviderId } from './probe.ts'
import type { ProviderGroupInfo } from './types.ts'

export const name = 'dsh-models-sync'
export const inject = ['webServer', 'llm']

/**
 * 安全解析运行时 LLM 核心服务，严格防止未声明 inject 时 Cordis 抛出拦截异常
 */
function resolveLlm(context: any): any {
  if (!context) return undefined

  // 1. 优先通过 Cordis 官方 reflect.get 读取，无需 inject 权限要求
  try {
    const fromReflect = context.reflect?.get?.('llm', false)
    if (fromReflect) return fromReflect
  } catch {}

  // 2. 尝试从当前 context 安全读取
  try {
    if (context.llm) return context.llm
  } catch {}

  // 3. 尝试从祖先/根 context 安全读取
  try {
    const parent = context.root || context.fiber?.parent?.ctx
    const fromParent = parent?.reflect?.get?.('llm', false) || parent?.llm
    if (fromParent) return fromParent
  } catch {}

  return undefined
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<any> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
  }
  return body ? JSON.parse(body) : {}
}

export function apply(ctx: Context): void {
  ctx.logger.info('[dsh-models-sync] plugin activating...')

  let cachedGroups: ProviderGroupInfo[] = []

  // 惰性挂载到 webServer（宿主按需提供）
  ctx.inject(['webServer'], (webCtx: any) => {
    const webServer = webCtx.webServer
    if (!webServer || typeof webServer.register !== 'function') return

    // 1. 获取/丰富模型与提供商数据（支持 GET 与 POST）
    webServer.register({
      kind: 'exact',
      path: '/api/dsh-models-sync/data',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET' && req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }
        try {
          let incomingGroups: ProviderGroupInfo[] | null = null
          if (req.method === 'POST') {
            const body = await readBody(req)
            if (Array.isArray(body?.groups) && body.groups.length > 0) {
              incomingGroups = body.groups
            }
          }

          if (incomingGroups && incomingGroups.length > 0) {
            cachedGroups = incomingGroups
          } else if (cachedGroups.length === 0) {
            cachedGroups = await loadProvidersFromSettings()
          }

          const catalog = await loadModelsDev()

          // 对所有模型进行 models.dev 4 级优先级匹配与参数元数据补充
          for (const group of cachedGroups) {
            for (const model of group.models) {
              const match = matchModel(model.id, model.name, catalog)
              if (match.entry) {
                applyMatchToModel(model, match)
              }
            }
          }

          sendJson(res, 200, { success: true, data: cachedGroups })
        } catch (err: any) {
          sendJson(res, 500, { success: false, error: err?.message || String(err) })
        }
      },
    })

    // 2. 同步全部模型 / 同步特定供应商模型
    webServer.register({
      kind: 'exact',
      path: '/api/dsh-models-sync/sync',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }
        try {
          const parsed = await readBody(req)
          const targetProviderKey: string | undefined = parsed.providerKey
          if (Array.isArray(parsed.groups) && parsed.groups.length > 0) {
            cachedGroups = parsed.groups
          }

          const catalog = await loadModelsDev(true) // 强制获取最新数据
          if (cachedGroups.length === 0) {
            cachedGroups = await loadProvidersFromSettings()
          }

          let updatedCount = 0
          for (const group of cachedGroups) {
            if (targetProviderKey && group.key !== targetProviderKey) {
              continue
            }
            for (const model of group.models) {
              const match = matchModel(model.id, model.name, catalog)
              if (match.entry) {
                applyMatchToModel(model, match)
                updatedCount++
              }
            }
          }

          sendJson(res, 200, { success: true, updatedCount, data: cachedGroups })
        } catch (err: any) {
          sendJson(res, 500, { success: false, error: err?.message || String(err) })
        }
      },
    })

    // 3. 全量保存写入 .dsh/settings.yaml
    webServer.register({
      kind: 'exact',
      path: '/api/dsh-models-sync/save',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }
        try {
          const parsed = await readBody(req)
          const groupsToSave: ProviderGroupInfo[] = parsed.groups || cachedGroups

          const ok = await saveModelsToSettings(groupsToSave)
          if (ok) {
            cachedGroups = groupsToSave
          }
          sendJson(res, 200, { success: ok })
        } catch (err: any) {
          sendJson(res, 500, { success: false, error: err?.message || String(err) })
        }
      },
    })

    // 4. 测试模型可用性（全部或指定供应商）
    webServer.register({
      kind: 'exact',
      path: '/api/dsh-models-sync/test',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }
        try {
          const parsed = await readBody(req)
          const targetProviderKey: string | undefined = parsed.providerKey
          if (Array.isArray(parsed.groups) && parsed.groups.length > 0) {
            cachedGroups = parsed.groups
          }

          if (cachedGroups.length === 0) {
            cachedGroups = await loadProvidersFromSettings()
          }

          // 动态安全获取运行时 llm 核心服务，杜绝触发 Cordis inject 检查异常
          const llm = resolveLlm(webCtx) || resolveLlm(ctx)
          const availableProviders: string[] = typeof llm?.listProviders === 'function'
            ? llm.listProviders().map((p: any) => p.id)
            : []

          const itemsToTest: { model: ModelInfo; providerId: string }[] = []
          for (const group of cachedGroups) {
            if (targetProviderKey && group.key !== targetProviderKey) continue
            const providerId = resolveProviderId(group.key, availableProviders)
            for (const model of group.models) {
              itemsToTest.push({ model, providerId })
            }
          }

          // 执行真实测活
          const testResults = await probeModels(itemsToTest, llm)
          const resultMap = new Map(testResults.map(r => [r.modelId, r]))

          for (const group of cachedGroups) {
            if (targetProviderKey && group.key !== targetProviderKey) continue
            for (const m of group.models) {
              const r = resultMap.get(m.id)
              if (r) {
                m.testStatus = r.success ? 'success' : 'failed'
                m.testMessage = r.message
              }
            }
          }

          sendJson(res, 200, { success: true, results: testResults, data: cachedGroups })
        } catch (err: any) {
          sendJson(res, 500, { success: false, error: err?.message || String(err) })
        }
      },
    })

    ctx.logger.info('[dsh-models-sync] webServer routes registered successfully.')
  })
}
