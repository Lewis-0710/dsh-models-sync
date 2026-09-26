import React, { useState, useEffect, useCallback } from 'react'
import type { ProviderGroupInfo, ModelInfo } from '../types.ts'
import { extractAvailableReasoningLevels, extractCurrentReasoningLevel } from '../reasoning-utils.ts'

export interface ModelsSyncCardProps {
  as?: 'div' | 'li'
  ctx?: any
}

/**
 * 等级英文标签到中文的友好映射
 */
const LEVEL_LABEL_MAP: Record<string, string> = {
  off: '关',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
}

/**
 * 安全获取桌面端运行时全量模型目录（优先通过原生 modelDirectories 服务或 RPC）
 */
async function fetchRuntimeModelCatalog(ctx: any): Promise<any> {
  if (!ctx) return null

  // 1. 优先通过 modelDirectories 服务（DSH 桌面端模型选择菜单的第一真源）
  try {
    const modelsService = typeof ctx.get === 'function' ? ctx.get('modelDirectories') : ctx.modelDirectories
    if (modelsService && typeof modelsService.directoryFor === 'function') {
      const sessionsService = typeof ctx.get === 'function' ? ctx.get('sessions') : ctx.sessions
      let sessionId = ''
      try {
        const sSnap = sessionsService?.list?.getSnapshot?.()
        if (sSnap?.current) sessionId = sSnap.current
        else if (sSnap?.byId) {
          const keys = Object.keys(sSnap.byId)
          if (keys.length > 0) sessionId = keys[0]
        }
      } catch {}

      const dir = modelsService.directoryFor(sessionId)
      if (dir) {
        try {
          if (typeof dir.load === 'function') await dir.load()
        } catch {}
        const snap = (typeof dir.store?.getSnapshot === 'function' ? dir.store.getSnapshot() : null)
          || (typeof dir.getSnapshot === 'function' ? dir.getSnapshot() : null)
        if (snap && Array.isArray(snap.groups) && snap.groups.length > 0) {
          return { groups: snap.groups }
        }
      }
    }
  } catch {}

  // 2. 尝试 ctx.get('remote.session')
  try {
    if (typeof ctx.get === 'function') {
      const rs = ctx.get('remote.session')
      if (rs && typeof rs.modelCatalog === 'function') {
        const cat = await rs.modelCatalog()
        if (cat?.groups?.length) return cat
      }
    }
  } catch {}

  // 3. 尝试 ctx.get('remote')?.session
  try {
    if (typeof ctx.get === 'function') {
      const r = ctx.get('remote')
      if (r?.session && typeof r.session.modelCatalog === 'function') {
        const cat = await r.session.modelCatalog()
        if (cat?.groups?.length) return cat
      }
    }
  } catch {}

  // 4. 尝试 ctx.get('session')
  try {
    if (typeof ctx.get === 'function') {
      const s = ctx.get('session')
      if (s && typeof s.modelCatalog === 'function') {
        const cat = await s.modelCatalog()
        if (cat?.groups?.length) return cat
      }
    }
  } catch {}

  // 5. 尝试直接属性访问 ctx.remote.session
  try {
    if (ctx.remote?.session && typeof ctx.remote.session.modelCatalog === 'function') {
      const cat = await ctx.remote.session.modelCatalog()
      if (cat?.groups?.length) return cat
    }
  } catch {}

  return null
}

export const ModelsSyncCard: React.FC<ModelsSyncCardProps> = ({ as = 'div', ctx }) => {
  const Component = as as any
  const [groups, setGroups] = useState<ProviderGroupInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [syncingAll, setSyncingAll] = useState(false)
  const [testingAll, setTestingAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncingProviders, setSyncingProviders] = useState<Record<string, boolean>>({})
  const [testingProviders, setTestingProviders] = useState<Record<string, boolean>>({})
  // 供应商折叠状态：默认全部折叠，值为 true 时展开
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  // 加载数据：以客户端运行时 modelCatalog 为第一真源（动态对齐模型选择列表原生全部组），由后端 models.dev 进行 4 级优先级参数填充
  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      let initialGroups: ProviderGroupInfo[] = []

      // 1. 权威真源：直接获取 DSH 桌面端运行时全量模型组（与模型选择列表图1绝对一致，共8个组）
      try {
        const catalog = await fetchRuntimeModelCatalog(ctx)
        if (catalog && Array.isArray(catalog.groups) && catalog.groups.length > 0) {
          initialGroups = catalog.groups.map((cg: any) => {
            const rawModels = Array.isArray(cg.models) ? cg.models : []
            const models: ModelInfo[] = rawModels.map((m: any, idx: number) => {
              const availableLevels = extractAvailableReasoningLevels(m)
              const currentLevel = extractCurrentReasoningLevel(m, availableLevels)
              return {
                id: m.id,
                name: m.name || m.id,
                contextWindow: m.contextWindow || m.limit?.context || undefined,
                maxOutput: m.maxTokens || m.limit?.output || undefined,
                supportsImages: m.supportsImages === true || (Array.isArray(m.input) && m.input.includes('image')),
                supportsText: true,
                reasoningLevel: currentLevel,
                availableReasoningLevels: availableLevels,
                rawPath: `${cg.id}.models.${idx}`,
                rawIndex: idx,
                rawParentKey: `${cg.id}.models`,
              }
            })
            return {
              key: cg.id,
              title: cg.name || cg.id, // 动态组名，绝不使用正则替换，绝不硬编码，一字不差对齐图1
              isCustom: false,
              models,
            }
          })
        }
      } catch (err) {
        console.warn('[dsh-models-sync] 获取运行时 modelCatalog 异常:', err)
      }

      // 2. 发送给后端通过 models.dev 进行 4 级优先级匹配与参数元数据补充
      const res = await fetch('/api/dsh-models-sync/data', {
        method: initialGroups.length > 0 ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: initialGroups.length > 0 ? JSON.stringify({ groups: initialGroups }) : undefined,
      })
      const json = await res.json()
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        setGroups(json.data)
      } else if (initialGroups.length > 0) {
        setGroups(initialGroups)
      } else {
        showToast(json.error || '未检测到模型提供商配置', 'error')
      }
    } catch (e: any) {
      showToast('获取模型配置失败: ' + e?.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [ctx])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // 切换折叠/展开
  const toggleExpand = (providerKey: string) => {
    setExpandedMap(prev => ({
      ...prev,
      [providerKey]: !prev[providerKey],
    }))
  }

  // 1. 同步全部
  const handleSyncAll = async () => {
    setSyncingAll(true)
    try {
      const res = await fetch('/api/dsh-models-sync/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups }),
      })
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) {
        setGroups(json.data)
        showToast(`已成功同步 ${json.updatedCount || 0} 个模型的参数！`, 'success')
      } else {
        showToast(json.error || '同步失败', 'error')
      }
    } catch (e: any) {
      showToast('同步请求失败: ' + e?.message, 'error')
    } finally {
      setSyncingAll(false)
    }
  }

  // 2. 同步单个供应商
  const handleSyncProvider = async (providerKey: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSyncingProviders(prev => ({ ...prev, [providerKey]: true }))
    try {
      const res = await fetch('/api/dsh-models-sync/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups, providerKey }),
      })
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) {
        setGroups(json.data)
        showToast(`供应商模型参数已成功同步！`, 'success')
      } else {
        showToast(json.error || '同步失败', 'error')
      }
    } catch (e: any) {
      showToast('同步失败: ' + e?.message, 'error')
    } finally {
      setSyncingProviders(prev => ({ ...prev, [providerKey]: false }))
    }
  }

  // 3. 保存全部
  const handleSaveAll = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/dsh-models-sync/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups }),
      })
      const json = await res.json()
      if (json.success) {
        showToast('已全量保存并写回 .dsh/settings.yaml！', 'success')
      } else {
        showToast(json.error || '保存失败', 'error')
      }
    } catch (e: any) {
      showToast('保存失败: ' + e?.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // 4. 测试全部
  const handleTestAll = async () => {
    setTestingAll(true)
    try {
      const res = await fetch('/api/dsh-models-sync/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups }),
      })
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) {
        setGroups(json.data)
        showToast('全部模型可用性检测已完成！', 'success')
      } else {
        showToast(json.error || '测试失败', 'error')
      }
    } catch (e: any) {
      showToast('测试请求异常: ' + e?.message, 'error')
    } finally {
      setTestingAll(false)
    }
  }

  // 5. 测试单个供应商
  const handleTestProvider = async (providerKey: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setTestingProviders(prev => ({ ...prev, [providerKey]: true }))
    try {
      const res = await fetch('/api/dsh-models-sync/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups, providerKey }),
      })
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) {
        setGroups(json.data)
        showToast('该供应商模型检测完成！', 'success')
      } else {
        showToast(json.error || '测试失败', 'error')
      }
    } catch (e: any) {
      showToast('测试失败: ' + e?.message, 'error')
    } finally {
      setTestingProviders(prev => ({ ...prev, [providerKey]: false }))
    }
  }

  // 修改单个模型字段
  const updateModelField = (providerKey: string, modelId: string, updates: Partial<ModelInfo>) => {
    setGroups(prev =>
      prev.map(g => {
        if (g.key !== providerKey) return g
        return {
          ...g,
          models: g.models.map(m => (m.id === modelId ? { ...m, ...updates } : m)),
        }
      })
    )
  }

  return (
    <Component style={styles.container}>
      {/* 顶部标题栏与全局操作按钮 */}
      <div style={styles.header}>
        <div style={styles.titleContainer}>
          <span style={styles.headerTitle}>模型参数填充</span>
          {loading && <span style={styles.loadingTag}>加载中...</span>}
        </div>
        <div style={styles.buttonGroup}>
          <button
            style={{ ...styles.btn, ...(testingAll ? styles.btnDisabled : {}) }}
            onClick={handleTestAll}
            disabled={testingAll || loading}
          >
            {testingAll ? '测试中...' : '测试全部'}
          </button>
          <button
            style={{ ...styles.btn, ...(syncingAll ? styles.btnDisabled : {}) }}
            onClick={handleSyncAll}
            disabled={syncingAll || loading}
          >
            {syncingAll ? '同步中...' : '同步全部'}
          </button>
          <button
            style={{ ...styles.btn, ...styles.btnPrimary, ...(saving ? styles.btnDisabled : {}) }}
            onClick={handleSaveAll}
            disabled={saving || loading}
          >
            {saving ? '保存中...' : '保存全部'}
          </button>
        </div>
      </div>

      {/* 提示消息 */}
      {toast && (
        <div
          style={{
            ...styles.toast,
            backgroundColor:
              toast.type === 'success' ? 'rgba(34, 197, 94, 0.12)' :
              toast.type === 'error' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(59, 130, 246, 0.12)',
            borderColor:
              toast.type === 'success' ? 'rgba(34, 197, 94, 0.4)' :
              toast.type === 'error' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(59, 130, 246, 0.4)',
            color:
              toast.type === 'success' ? '#22c55e' :
              toast.type === 'error' ? '#ef4444' : '#3b82f6',
          }}
        >
          {toast.message}
        </div>
      )}

      {/* 提供商列表（线框 + 分割线风格，默认折叠） */}
      <div style={styles.providerList}>
        {groups.length === 0 && !loading && (
          <div style={styles.emptyTip}>未检测到已配置的模型提供商</div>
        )}

        {groups.map(group => {
          const isExpanded = !!expandedMap[group.key]
          const isSyncing = syncingProviders[group.key]
          const isTesting = testingProviders[group.key]

          return (
            <div key={group.key} style={styles.providerWrapper}>
              {/* 供应商头部行（点击可展开/收起） */}
              <div
                style={styles.providerHeader}
                onClick={() => toggleExpand(group.key)}
              >
                <div style={styles.providerTitleWrapper}>
                  {/* 折叠箭头指示 */}
                  <span style={styles.collapseArrow}>
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <span style={styles.providerTitle}>
                    {group.title}
                  </span>
                  {group.isCustom && <span style={styles.customBadge}>自定义</span>}
                  <span style={styles.modelCount}>({group.models.length}个模型)</span>
                </div>
                <div style={styles.providerActions}>
                  <button
                    style={styles.smallBtn}
                    onClick={(e) => handleTestProvider(group.key, e)}
                    disabled={isTesting}
                  >
                    {isTesting ? '测试中' : '测试'}
                  </button>
                  <button
                    style={styles.smallBtn}
                    onClick={(e) => handleSyncProvider(group.key, e)}
                    disabled={isSyncing}
                  >
                    {isSyncing ? '同步中' : '同步'}
                  </button>
                </div>
              </div>

              {/* 展开后的模型列表 */}
              {isExpanded && (
                <div style={styles.modelContainer}>
                  {group.models.map((model, idx) => {
                    // 模型名规则：优先使用别名，没有别名再显示模型 ID，不两个都显示
                    const displayName = (model.name && model.name.trim() && model.name !== model.id)
                      ? model.name
                      : model.id

                    // 动态计算支持的思考等级选项（关 + 实际支持的等级）
                    const supportedLevels = Array.isArray(model.availableReasoningLevels)
                      ? model.availableReasoningLevels.filter(lvl => lvl && lvl !== 'off')
                      : []
                    const validLevels = ['off', ...supportedLevels]

                    const isLast = idx === group.models.length - 1

                    return (
                      <div
                        key={model.id}
                        style={{
                          ...styles.modelRow,
                          ...(isLast ? { borderBottom: 'none' } : {}),
                        }}
                      >
                        {/* 第一行：左侧模型名，右侧图片/文本多模态支持 */}
                        <div style={styles.rowBetween}>
                          <div style={styles.modelIdentity}>
                            <span style={styles.modelNameText}>{displayName}</span>
                            {/* 测活状态 Badge */}
                            {model.testStatus === 'success' && (
                              <span style={styles.badgeSuccess} title={model.testMessage}>🟢 正常 {model.testMessage}</span>
                            )}
                            {model.testStatus === 'failed' && (
                              <span style={styles.badgeFailed} title={model.testMessage}>🔴 异常 {model.testMessage}</span>
                            )}
                            {model.testStatus === 'testing' && (
                              <span style={styles.badgeTesting}>🟡 检测中...</span>
                            )}
                          </div>

                          <div style={styles.modalityWrapper}>
                            <label style={styles.checkboxLabel}>
                              <span>图片</span>
                              <input
                                type="checkbox"
                                checked={model.supportsImages}
                                onChange={e =>
                                  updateModelField(group.key, model.id, { supportsImages: e.target.checked })
                                }
                                style={styles.checkbox}
                              />
                            </label>
                            <label style={styles.checkboxLabel}>
                              <span>文本</span>
                              <input
                                type="checkbox"
                                checked={model.supportsText}
                                onChange={e =>
                                  updateModelField(group.key, model.id, { supportsText: e.target.checked })
                                }
                                style={styles.checkbox}
                              />
                            </label>
                          </div>
                        </div>

                        {/* 第二行：上下文 与 最大输出 左右两端对齐 */}
                        <div style={styles.rowBetween}>
                          <div style={styles.fieldItem}>
                            <span style={styles.fieldLabel}>上下文:</span>
                            <input
                              type="number"
                              value={model.contextWindow ?? ''}
                              onChange={e =>
                                updateModelField(group.key, model.id, {
                                  contextWindow: e.target.value ? parseInt(e.target.value, 10) : undefined,
                                })
                              }
                              style={styles.numberInput}
                            />
                          </div>

                          <div style={styles.fieldItem}>
                            <span style={styles.fieldLabel}>最大输出:</span>
                            <input
                              type="number"
                              value={model.maxOutput ?? ''}
                              onChange={e =>
                                updateModelField(group.key, model.id, {
                                  maxOutput: e.target.value ? parseInt(e.target.value, 10) : undefined,
                                })
                              }
                              style={styles.numberInput}
                            />
                          </div>
                        </div>

                        {/* 第三行：推理等级单选（根据实际支持动态生成） */}
                        <div style={styles.reasoningRow}>
                          <span style={styles.fieldLabel}>推理等级:</span>
                          <div style={styles.levelGroup}>
                            {validLevels.map(lvl => {
                              const label = LEVEL_LABEL_MAP[lvl] || lvl
                              return (
                                <label key={lvl} style={styles.radioLabel}>
                                  <span>{label}</span>
                                  <input
                                    type="radio"
                                    name={`reasoning-${group.key}-${model.id}`}
                                    checked={model.reasoningLevel === lvl}
                                    onChange={() =>
                                      updateModelField(group.key, model.id, { reasoningLevel: lvl })
                                    }
                                    style={styles.radio}
                                  />
                                </label>
                              )
                            })}
                            {supportedLevels.length === 0 && (
                              <span style={styles.unsupportedTip}>（该模型不支持思考等级）</span>
                            )}
                          </div>
                        </div>

                        {/* 第四行：同族回退匹配提示说明 */}
                        {model.fallbackNote && (
                          <div style={styles.fallbackNotice}>
                            💡 {model.fallbackNote}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Component>
  )
}

const styles: Record<string, React.CSSProperties> = {
  // 外层容器：像素级贴合官方规范，支持深/浅色模式，透明底色，0.5px细线框，16px圆角
  container: {
    margin: '16px 0 24px 0',
    padding: '14px 16px',
    backgroundColor: 'transparent',
    border: '0.5px solid var(--dsw-alias-border-l4, rgba(255, 255, 255, 0.12))',
    borderRadius: '16px',
    color: 'var(--dsw-alias-label-primary, inherit)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: '12px',
    borderBottom: '0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08))',
    marginBottom: '12px',
  },
  titleContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  headerTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--dsw-alias-label-primary, inherit)',
  },
  loadingTag: {
    fontSize: '12px',
    color: 'var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.45))',
  },
  buttonGroup: {
    display: 'flex',
    gap: '8px',
  },
  // 胶囊药丸按钮：官方规范 height: 28px, border-radius: 14px, 0.5px 细边框
  btn: {
    boxSizing: 'border-box',
    height: '28px',
    padding: '0 12px',
    fontSize: '12px',
    lineHeight: '18px',
    fontWeight: 400,
    cursor: 'pointer',
    backgroundColor: 'transparent',
    border: '0.5px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.15))',
    color: 'var(--dsw-alias-label-primary, inherit)',
    borderRadius: '14px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
  },
  btnPrimary: {
    border: '0.5px solid var(--dsw-alias-border-brand, #3b82f6)',
    color: '#3b82f6',
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
    fontWeight: 500,
  },
  btnDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  toast: {
    padding: '8px 12px',
    border: '0.5px solid',
    borderRadius: '8px',
    marginBottom: '12px',
    fontSize: '12px',
    fontWeight: 500,
  },
  providerList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  emptyTip: {
    textAlign: 'center',
    padding: '20px',
    color: 'var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.45))',
    fontSize: '13px',
  },
  // 供应商卡片：像素级对齐官方设置页卡片
  providerWrapper: {
    backgroundColor: 'transparent',
    border: '0.5px solid var(--dsw-alias-border-l4, rgba(255, 255, 255, 0.12))',
    borderRadius: '16px',
    overflow: 'hidden',
    transition: 'border-color 0.15s ease',
  },
  providerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  providerTitleWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  collapseArrow: {
    fontSize: '10px',
    color: 'var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.5))',
    display: 'inline-block',
    width: '12px',
  },
  providerTitle: {
    fontSize: '14px',
    fontWeight: 500,
    color: 'var(--dsw-alias-label-primary, inherit)',
  },
  modelCount: {
    fontSize: '12px',
    color: 'var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.45))',
  },
  customBadge: {
    fontSize: '11px',
    lineHeight: '16px',
    padding: '1px 6px',
    border: '0.5px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.15))',
    color: 'var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.65))',
    borderRadius: '4px',
  },
  providerActions: {
    display: 'flex',
    gap: '8px',
  },
  smallBtn: {
    boxSizing: 'border-box',
    height: '28px',
    padding: '0 12px',
    fontSize: '12px',
    lineHeight: '18px',
    cursor: 'pointer',
    backgroundColor: 'transparent',
    border: '0.5px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.15))',
    color: 'var(--dsw-alias-label-primary, inherit)',
    borderRadius: '14px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
  },
  modelContainer: {
    borderTop: '0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08))',
    padding: '0 14px',
  },
  modelRow: {
    padding: '12px 0',
    borderBottom: '0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08))',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  // 左右两边对齐
  rowBetween: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  modelIdentity: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  modelNameText: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--dsw-alias-label-primary, inherit)',
  },
  modalityWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    cursor: 'pointer',
    color: 'var(--dsw-alias-label-secondary, inherit)',
  },
  checkbox: {
    cursor: 'pointer',
    accentColor: '#3b82f6',
    width: '14px',
    height: '14px',
  },
  fieldItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  fieldLabel: {
    fontSize: '12px',
    color: 'var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.7))',
  },
  numberInput: {
    boxSizing: 'border-box',
    width: '120px',
    height: '26px',
    padding: '0 8px',
    backgroundColor: 'transparent',
    border: '0.5px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.18))',
    color: 'inherit',
    fontSize: '12px',
    borderRadius: '6px',
    outline: 'none',
  },
  reasoningRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '12px',
  },
  levelGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
    cursor: 'pointer',
    color: 'var(--dsw-alias-label-secondary, inherit)',
  },
  radio: {
    cursor: 'pointer',
    accentColor: '#3b82f6',
  },
  unsupportedTip: {
    fontSize: '12px',
    color: 'var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.45))',
  },
  fallbackNotice: {
    fontSize: '12px',
    color: '#eab308',
    padding: '2px 0',
    display: 'block',
  },
  badgeSuccess: {
    fontSize: '11px',
    color: '#22c55e',
    border: '0.5px solid rgba(34, 197, 94, 0.3)',
    borderRadius: '4px',
    padding: '1px 6px',
  },
  badgeFailed: {
    fontSize: '11px',
    color: '#ef4444',
    border: '0.5px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '4px',
    padding: '1px 6px',
    maxWidth: '450px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'inline-block',
    verticalAlign: 'middle',
  },
  badgeTesting: {
    fontSize: '11px',
    color: '#eab308',
    border: '0.5px solid rgba(234, 179, 8, 0.3)',
    borderRadius: '4px',
    padding: '1px 6px',
  },
}
