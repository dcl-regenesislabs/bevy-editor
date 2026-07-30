// Component-name → curated view. ComponentCard consults this before falling
// back to the generic SchemaEditor; the json toggle still exposes RawEditor.
import type { ComponentView } from './types'
import { coreViews } from './core-views'
import { behaviorViews } from './behavior-views'
import { ScriptView } from './script-view'
import { AdminToolsView } from './admin-tools-view'
import { ADMIN_TOOLS_COMPONENT } from './admin-tools'
import { SCRIPT_COMPONENT } from '../../../../scene/src/allowed-components'

const VIEWS: Record<string, ComponentView> = {
  ...coreViews,
  ...behaviorViews,
  [SCRIPT_COMPONENT]: ScriptView,
  [ADMIN_TOOLS_COMPONENT]: AdminToolsView
}

export function getComponentView(name: string): ComponentView | undefined {
  return VIEWS[name]
}
