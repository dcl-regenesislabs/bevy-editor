// Component-name → curated view. ComponentCard consults this before falling
// back to the generic SchemaEditor; the json toggle still exposes RawEditor.
import type { ComponentView } from './types'
import { coreViews } from './core-views'
import { behaviorViews } from './behavior-views'
import { ScriptView } from './script-view'
import { AdminToolsView } from './admin-tools-view'
import { ADMIN_TOOLS_COMPONENT } from './admin-tools'
import { GameConfigView } from './game-config-view'
import { GAME_CONFIG_COMPONENT } from '../../gameconfig/normalize'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'

const VIEWS: Record<string, ComponentView> = {
  ...coreViews,
  ...behaviorViews,
  [SCRIPT_COMPONENT]: ScriptView,
  [ADMIN_TOOLS_COMPONENT]: AdminToolsView,
  [GAME_CONFIG_COMPONENT]: GameConfigView
}

export function getComponentView(name: string): ComponentView | undefined {
  return VIEWS[name]
}
