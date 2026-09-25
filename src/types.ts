export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ModelInfo {
  id: string
  name: string
  contextWindow?: number
  maxOutput?: number
  supportsImages: boolean
  supportsText: boolean
  reasoningLevel: ThinkingLevel | string
  availableReasoningLevels?: string[]
  fallbackNote?: string
  matchedVia?: 'id' | 'alias' | 'latest' | 'family' | 'none'
  matchedId?: string
  testStatus?: 'idle' | 'testing' | 'success' | 'failed'
  testMessage?: string
  rawPath: string
  rawIndex?: number
  rawParentKey?: string
}

export interface ProviderGroupInfo {
  key: string
  title: string
  isCustom?: boolean
  models: ModelInfo[]
  testStatus?: 'idle' | 'testing' | 'success' | 'failed'
}

export interface ModelsDevEntry {
  id: string
  name: string
  provider?: string
  contextWindow?: number
  maxOutput?: number
  input: string[]
  thinkingLevels: string[]
}

export interface SyncResult {
  updatedModels: number
  details: Array<{
    providerKey: string
    modelId: string
    matchedVia: 'id' | 'alias' | 'latest' | 'family' | 'none'
    matchedId?: string
    fallbackNote?: string
  }>
}
