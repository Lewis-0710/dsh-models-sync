import type {} from '@deepseek-ai/dsh-client-ui-slots'

export interface ModelsFooterOwnerProps {
  children?: never
}

export interface SettingsPluginItemOwnerProps {
  children?: never
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.models.footer': {
      kind: 'list'
      scope: 'root'
      owner: ModelsFooterOwnerProps
    }
    'settings.plugin.item': {
      kind: 'keyed'
      scope: 'root'
      owner: SettingsPluginItemOwnerProps
    }
  }
}
