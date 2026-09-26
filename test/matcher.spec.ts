import { describe, it, expect } from 'vitest'
import { matchModel } from '../src/matcher.ts'
import type { ModelsDevEntry } from '../src/types.ts'

const mockCatalog: ModelsDevEntry[] = [
  {
    id: 'qwen/qwen3.8-max',
    name: 'Qwen3.8 Max',
    contextWindow: 1000000,
    maxOutput: 131072,
    input: ['text', 'image'],
    thinkingLevels: ['minimal', 'low', 'medium', 'high'],
  },
  {
    id: 'zhipu/glm-5.2',
    name: 'GLM-5.2',
    contextWindow: 200000,
    maxOutput: 128000,
    input: ['text'],
    thinkingLevels: ['low', 'medium', 'high'],
  },
  {
    id: 'zhipu/glm-5.3',
    name: 'GLM-5.3',
    contextWindow: 1000000,
    maxOutput: 128000,
    input: ['text', 'image'],
    thinkingLevels: ['low', 'medium', 'high', 'xhigh'],
  },
  {
    id: 'zhipu/glm-5.2-flash',
    name: 'GLM-5.2 Flash',
    contextWindow: 128000,
    maxOutput: 64000,
    input: ['text'],
    thinkingLevels: ['low', 'medium'],
  },
  {
    id: 'zhipu/glm-5.3-flash',
    name: 'GLM-5.3 Flash',
    contextWindow: 1000000,
    maxOutput: 128000,
    input: ['text', 'image'],
    thinkingLevels: ['low', 'medium', 'high'],
  },
  {
    id: 'xiaomi/mimo-2.7',
    name: 'MiMo-2.7',
    contextWindow: 256000,
    maxOutput: 32000,
    input: ['text'],
    thinkingLevels: [],
  },
  {
    id: 'XiaomiMiMo/MiMo-V2.6-Flash',
    name: 'MiMo-V2.6-Flash',
    contextWindow: 1000000,
    maxOutput: 65536,
    input: ['text', 'image'],
    thinkingLevels: ['low', 'medium', 'high'],
  },
  {
    id: 'empiriolabs/muse-spark-1.2-contributor',
    name: 'Muse Spark 1.2 Contributor',
    contextWindow: 128000,
    maxOutput: 16384,
    input: ['text'],
    thinkingLevels: ['low', 'high'],
  },
  {
    id: 'bailing/ling-3.0-flash-fin',
    name: 'Ling 3.0 Flash Fin',
    contextWindow: 128000,
    maxOutput: 8192,
    input: ['text'],
    thinkingLevels: [],
  },
]

describe('4级优先级模型匹配逻辑测试', () => {
  it('优先级 1：根据模型 ID 精准匹配', () => {
    const res = matchModel('qwen3.8-max', '任何别名', mockCatalog)
    expect(res.matchedVia).toBe('id')
    expect(res.matchedId).toBe('qwen/qwen3.8-max')
    expect(res.entry?.contextWindow).toBe(1000000)
    expect(res.fallbackNote).toBeUndefined()
  })

  it('优先级 2：ID 匹配不到，根据模型别名匹配', () => {
    const res = matchModel('unknown-model-xyz', 'Qwen3.8 Max', mockCatalog)
    expect(res.matchedVia).toBe('alias')
    expect(res.matchedId).toBe('qwen/qwen3.8-max')
    expect(res.fallbackNote).toBeUndefined()
  })

  it('优先级 3：latest 逻辑路由匹配该模型最新版本 (glm-latest)', () => {
    const res = matchModel('glm-latest', 'GLM Latest', mockCatalog)
    expect(res.matchedVia).toBe('latest')
    expect(res.matchedId).toBe('zhipu/glm-5.3')
    expect(res.entry?.contextWindow).toBe(1000000)
    expect(res.fallbackNote).toBeUndefined()
  })

  it('优先级 3：latest 变体逻辑路由匹配该模型变体最新版本 (glm-latest-flash)', () => {
    const res = matchModel('glm-latest-flash', 'GLM Flash Latest', mockCatalog)
    expect(res.matchedVia).toBe('latest')
    expect(res.matchedId).toBe('zhipu/glm-5.3-flash')
    expect(res.entry?.maxOutput).toBe(128000)
    expect(res.fallbackNote).toBeUndefined()
  })

  it('优先级 4：同族数据匹配 (mimo-2.7-flash 降级匹配 mimo-2.7 并带提示)', () => {
    const res = matchModel('mimo-2.7-flash', 'mimo-2.7-flash', mockCatalog)
    expect(res.matchedVia).toBe('family')
    expect(res.matchedId).toBe('xiaomi/mimo-2.7')
    expect(res.fallbackNote).toContain('根据同族模型')
    expect(res.fallbackNote).toContain('mimo-2.7')
  })

  it('去除 free 标识测试：muse-spark-1.2-contributor-free / mimo-v2.6-flash-free / ling-3.0-flash-fin-free 自动去除 free 后匹配', () => {
    // 1. mimo-v2.6-flash-free
    const resMimo = matchModel('mimo-v2.6-flash-free', 'MiMo V2.6 Flash Free', mockCatalog)
    expect(resMimo.matchedVia).toBe('id')
    expect(resMimo.matchedId).toBe('XiaomiMiMo/MiMo-V2.6-Flash')
    expect(resMimo.entry?.contextWindow).toBe(1000000)
    expect(resMimo.fallbackNote).toContain('已自动去除 free 标识')

    // 2. muse-spark-1.2-contributor-free
    const resMuse = matchModel('muse-spark-1.2-contributor-free', 'Muse Spark', mockCatalog)
    expect(resMuse.matchedVia).toBe('id')
    expect(resMuse.matchedId).toBe('empiriolabs/muse-spark-1.2-contributor')
    expect(resMuse.fallbackNote).toContain('已自动去除 free 标识')

    // 3. ling-3.0-flash-fin-free
    const resLing = matchModel('ling-3.0-flash-fin-free', 'Ling 3.0', mockCatalog)
    expect(resLing.matchedVia).toBe('id')
    expect(resLing.matchedId).toBe('bailing/ling-3.0-flash-fin')
    expect(resLing.fallbackNote).toContain('已自动去除 free 标识')

    // 4. 别名带 (Free) 的情况
    const resAlias = matchModel('unknown-id-xyz', 'MiMo-V2.6-Flash (Free)', mockCatalog)
    expect(resAlias.matchedVia).toBe('alias')
    expect(resAlias.matchedId).toBe('XiaomiMiMo/MiMo-V2.6-Flash')
  })

  it('完全无匹配时返回 none', () => {
    const res = matchModel('totally-random-unknown-model-12345', 'Random', mockCatalog)
    expect(res.matchedVia).toBe('none')
    expect(res.entry).toBeUndefined()
  })
})
