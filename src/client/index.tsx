import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from './slot-contract.ts'
import { ModelsSyncCard } from './ModelsSyncCard.tsx'

export const name = 'dsh-models-sync-client'
export const inject = ['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session']

export function apply(ctx: Context): void {
  try {
    // 1. 挂载到官方 "设置 -> 模型" 页面底部的有序扩展区 (kind: 'list')
    ctx.slots.inject('settings.models.footer', () =>
      ctx.slots.register(
        {
          name: 'settings.models.footer',
          id: 'dsh-models-sync',
          order: -999999,
        },
        (props: any) => <ModelsSyncCard {...props} ctx={ctx} />
      )
    )

    // 2. 挂载到 "设置 -> 插件 -> 插件配置" 席位 (kind: 'keyed')
    ctx.slots.inject('settings.plugin.item', () =>
      ctx.slots.register(
        {
          name: 'settings.plugin.item',
          key: 'dsh-models-sync',
          priority: -999999,
        },
        (props: any) => <ModelsSyncCard {...props} as="li" ctx={ctx} />
      )
    )

    // 3. 挂载到插件详情配置页 (kind: 'keyed', 以 npm 包名为 key)
    ctx.slots.inject('plugins.bundle.config', () =>
      ctx.slots.register(
        {
          name: 'plugins.bundle.config',
          key: 'dsh-models-sync',
        },
        (props: any) => <ModelsSyncCard {...props} ctx={ctx} />
      )
    )
  } catch (error: unknown) {
    console.error('[dsh-models-sync] 前端卡片注册失败:', error)
  }
}
