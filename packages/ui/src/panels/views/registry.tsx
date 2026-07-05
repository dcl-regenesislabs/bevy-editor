// Component-name → curated view. ComponentCard consults this before falling
// back to the generic SchemaEditor; the json toggle still exposes RawEditor.
import type { ComponentView } from './types'
import { coreViews } from './core-views'
import { behaviorViews } from './behavior-views'

const VIEWS: Record<string, ComponentView> = { ...coreViews, ...behaviorViews }

export function getComponentView(name: string): ComponentView | undefined {
  return VIEWS[name]
}
