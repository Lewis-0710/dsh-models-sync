import { describe, it, expect } from 'vitest'
import { resolveProviderId, probeSingleModel, probeModels } from '../src/probe.ts'
import type { ModelInfo } from '../src/types.ts'

describe('模型真实测活引擎测试', () => {
  it('Provider ID 动态推导测试 (resolveProviderId)', () => {
    const available = ['trae', 'trae-global', 'workbuddy', 'workbuddy-ai', 'qoder', 'qoder-global', 'deepseek', 'openrouter']

    // 1. Trae 国际版与国内版
    expect(resolveProviderId('trae.ai', available)).toBe('trae-global')
    expect(resolveProviderId('trae-global', available)).toBe('trae-global')
    expect(resolveProviderId('trae.cn', available)).toBe('trae')
    expect(resolveProviderId('trae.models', available)).toBe('trae')

    // 2. WorkBuddy 国际版与国内版
    expect(resolveProviderId('workbuddy.ai', available)).toBe('workbuddy-ai')
    expect(resolveProviderId('workbuddy-ai.8671db05', available)).toBe('workbuddy-ai')
    expect(resolveProviderId('workbuddy.cn', available)).toBe('workbuddy')

    // 3. Qoder 国际版与国内版
    expect(resolveProviderId('qoder.ai', available)).toBe('qoder-global')
    expect(resolveProviderId('qoder.cn', available)).toBe('qoder')

    // 4. 自定义聚合与官方直连
    expect(resolveProviderId('llm-pi-ai.providers.openrouter', available)).toBe('openrouter')
    expect(resolveProviderId('llm-deepseek.models', available)).toBe('deepseek')
  })

  it('真实捕获 Trae 账号额度耗尽错误 (4008 错误码)', async () => {
    const dummyModel: ModelInfo = {
      id: 'claude-3-7-sonnet',
      name: 'Claude 3.7 Sonnet',
      supportsImages: true,
      supportsText: true,
      rawPath: 'trae.ai.models.0',
      rawIndex: 0,
      rawParentKey: 'trae.ai.models',
    }

    // 模拟真实的 Trae 适配器上游返回 4008 错误
    const mockLlmWith4008 = {
      stream: (options: any) => {
        return (async function* () {
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: {
                message: '[Trae 错误]: 当前 Trae 账号可用额度已耗尽，请前往 Trae 充值或升级套餐 (错误码 4008)',
                code: 'QUOTA_EXCEEDED',
              },
            },
          }
        })()
      },
    }

    const result = await probeSingleModel(dummyModel, {
      llm: mockLlmWith4008,
      providerId: 'trae-global',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('当前 Trae 账号可用额度已耗尽')
    expect(result.message).toContain('4008')
  })

  it('真实捕获 Trae solo-bridge 包装在流式正文内容中的 4008 额度错误', async () => {
    const dummyModel: ModelInfo = {
      id: 'claude-3-7-sonnet',
      name: 'Claude 3.7 Sonnet',
      supportsImages: true,
      supportsText: true,
      rawPath: 'trae.ai.models.0',
      rawIndex: 0,
      rawParentKey: 'trae.ai.models',
    }

    // 模拟 solo-bridge 将 4008 作为正文输出的真实行为
    const mockLlmWithContentError = {
      stream: (options: any) => {
        return (async function* () {
          yield { type: 'content-start', index: 0 }
          yield {
            type: 'delta',
            delta: '\n\n⚠️ **[Trae 错误]**: 当前 Trae 账号可用额度已耗尽，请前往 Trae 充值或升级套餐 (错误码 4008)',
          }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    }

    const result = await probeSingleModel(dummyModel, {
      llm: mockLlmWithContentError,
      providerId: 'trae-global',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('当前 Trae 账号可用额度已耗尽')
    expect(result.message).toContain('4008')
  })

  it('真实捕获 Trae 原生英文额度超限返回 (Your requests have exceeded the quota)', async () => {
    const dummyModel: ModelInfo = {
      id: 'gpt-5.4',
      name: 'GPT-5.4',
      supportsImages: true,
      supportsText: true,
      rawPath: 'trae.ai.models.0',
      rawIndex: 0,
      rawParentKey: 'trae.ai.models',
    }

    // 模拟 Trae 国际版真实返回的分片英文额度耗尽正文
    const mockLlmQuota = {
      stream: (options: any) => {
        return (async function* () {
          yield { type: 'text-delta', text: 'Your requests ' }
          yield { type: 'text-delta', text: 'have exceeded the quota.' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    }

    const result = await probeSingleModel(dummyModel, {
      llm: mockLlmQuota,
      providerId: 'trae-global',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('当前 Trae 账号可用额度已耗尽')
    expect(result.message).toContain('4008')
  })

  it('真实捕获模型正常返回 Token 并计算延迟', async () => {
    const dummyModel: ModelInfo = {
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      supportsImages: false,
      supportsText: true,
      rawPath: 'workbuddy.ai.models.0',
      rawIndex: 0,
      rawParentKey: 'workbuddy.ai.models',
    }

    // 模拟正常模型响应
    const mockLlmSuccess = {
      stream: (options: any) => {
        return (async function* () {
          yield { type: 'content-start', index: 0 }
          yield { type: 'delta', delta: '2' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    }

    const result = await probeSingleModel(dummyModel, {
      llm: mockLlmSuccess,
      providerId: 'workbuddy-ai',
    })

    expect(result.success).toBe(true)
    expect(result.message).toMatch(/\d+ms/)
  })

  it('离线或无可用 LLM 运行时环境应明确报告未连接，拒绝虚假 Mock 成功', async () => {
    const dummyModel: ModelInfo = {
      id: 'test-model',
      name: 'Test Model',
      supportsImages: false,
      supportsText: true,
      rawPath: 'test.0',
      rawIndex: 0,
      rawParentKey: 'test',
    }

    const result = await probeSingleModel(dummyModel, {
      llm: undefined,
      providerId: 'unknown',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('未检测到可用的 LLM 运行时')
  })
})

