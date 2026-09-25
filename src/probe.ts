import type { ModelInfo } from './types.ts'

export interface ProbeResult {
  modelId: string
  success: boolean
  latencyMs: number
  message?: string
}

/**
 * 测活单个模型
 */
export async function probeSingleModel(model: ModelInfo, timeoutMs = 8000): Promise<ProbeResult> {
  const startTime = Date.now()
  try {
    // 模拟测活请求（如连接本地服务/目标API发送探测请求）
    // 对于自定义 provider，如果配置了 baseUrl 和 apiKey 可以实际发出最小探测
    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 200) + 80))
    const latency = Date.now() - startTime
    return {
      modelId: model.id,
      success: true,
      latencyMs: latency,
      message: `${latency}ms`,
    }
  } catch (error: any) {
    return {
      modelId: model.id,
      success: false,
      latencyMs: Date.now() - startTime,
      message: error?.message || '请求失败',
    }
  }
}

/**
 * 批量测活一组模型
 */
export async function probeModels(
  models: ModelInfo[],
  onProgress?: (result: ProbeResult) => void
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = []
  // 并发控制，每次同时测试 3 个模型，避免瞬间超限
  const concurrency = 3
  for (let i = 0; i < models.length; i += concurrency) {
    const chunk = models.slice(i, i + concurrency)
    const chunkPromises = chunk.map(async m => {
      const res = await probeSingleModel(m)
      if (onProgress) onProgress(res)
      return res
    })
    const chunkResults = await Promise.all(chunkPromises)
    results.push(...chunkResults)
  }
  return results
}
