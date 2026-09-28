import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ModelsDevEntry } from './types.ts'

import { writeFile } from 'node:fs/promises'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const TIMEOUT_MS = 5000

let memoryEntries: ModelsDevEntry[] = []

/**
 * 规范化 models.dev 的单条原始数据
 */
function parseRawApi(data: Record<string, any>): ModelsDevEntry[] {
  const result: ModelsDevEntry[] = []
  for (const [provider, block] of Object.entries(data)) {
    if (!block || typeof block !== 'object') continue
    const models = block.models
    if (!models || typeof models !== 'object') continue

    for (const [modelKey, raw] of Object.entries(models as Record<string, any>)) {
      if (!raw || typeof raw !== 'object') continue
      const limit = raw.limit || {}
      const contextWindow = typeof limit.context === 'number' && limit.context > 0 && limit.context < 99999999
        ? limit.context
        : undefined
      const maxOutput = typeof limit.output === 'number' && limit.output > 0 && limit.output < 99999999
        ? limit.output
        : undefined

      const rawInput = Array.isArray(raw.modalities?.input) ? raw.modalities.input : ['text']
      const input = rawInput.map(String)

      const thinkingLevels: string[] = []
      if (raw.reasoning) {
        if (Array.isArray(raw.reasoning_options)) {
          for (const opt of raw.reasoning_options) {
            if (opt?.type === 'effort' && Array.isArray(opt.values)) {
              thinkingLevels.push(...opt.values.map(String))
            }
          }
        }
        if (thinkingLevels.length === 0) {
          thinkingLevels.push('low', 'medium', 'high')
        }
      }

      result.push({
        id: modelKey,
        name: raw.name || modelKey,
        provider,
        contextWindow,
        maxOutput,
        input,
        thinkingLevels: [...new Set(thinkingLevels)],
      })
    }
  }
  return result
}

/**
 * 加载 models.dev 数据
 * 优先级：
 * 1. 内存缓存（非强制刷新时）
 * 2. 在线 API 拉取 https://models.dev/api.json
 * 3. 本地已缓存 ~/.dsh/models-dev.json
 * 4. 内置快照 ~/.dsh/models-dev-snapshot.json
 */
export async function loadModelsDev(forceOnline = false): Promise<ModelsDevEntry[]> {
  if (memoryEntries.length > 0 && !forceOnline) {
    return memoryEntries
  }

  const localPath = join(homedir(), '.dsh', 'models-dev.json')
  const localSnapshot = join(homedir(), '.dsh', 'models-dev-snapshot.json')

  // 若不强制在线，优先读取本地文件缓存
  if (!forceOnline && existsSync(localPath)) {
    try {
      const content = await readFile(localPath, 'utf8')
      const json = JSON.parse(content)
      if (Array.isArray(json.models) && json.models.length > 0) {
        memoryEntries = json.models.map((m: any) => ({
          id: String(m.id || ''),
          name: String(m.name || m.id || ''),
          provider: String(m.provider || ''),
          contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : undefined,
          maxOutput: typeof m.maxOutput === 'number' ? m.maxOutput : undefined,
          input: Array.isArray(m.input) ? m.input.map(String) : ['text'],
          thinkingLevels: Array.isArray(m.thinkingLevels) ? m.thinkingLevels.map(String) : [],
        }))
        return memoryEntries
      }
    } catch {
      // 忽略读取错误，尝试下一步
    }
  }

  // 尝试在线拉取（带超时保护）
  try {
    const res = await fetch(MODELS_DEV_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'dsh-models-sync' },
    })
    if (res.ok) {
      const rawJson = await res.json()
      const parsed = parseRawApi(rawJson)
      if (parsed.length > 0) {
        memoryEntries = parsed
        // 异步写入本地持久缓存，下次可秒级读取
        writeFile(localPath, JSON.stringify({ models: parsed }, null, 2), 'utf8').catch(() => {})
        return memoryEntries
      }
    }
  } catch {
    // 在线网络失败或超时，自动回退
  }

  // 在线拉取失败时，立即尝试从本地已有缓存加载
  if (existsSync(localPath)) {
    try {
      const content = await readFile(localPath, 'utf8')
      const json = JSON.parse(content)
      if (Array.isArray(json.models) && json.models.length > 0) {
        memoryEntries = json.models
        return memoryEntries
      }
    } catch {}
  }

  // 尝试快照降级
  if (existsSync(localSnapshot)) {
    try {
      const content = await readFile(localSnapshot, 'utf8')
      const json = JSON.parse(content)
      if (Array.isArray(json.models) && json.models.length > 0) {
        memoryEntries = json.models
        return memoryEntries
      }
    } catch {}
  }

  return memoryEntries
}
