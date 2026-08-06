import { state, componentKey, setComponentExpanded } from '@scene/state'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import { ADMIN_TOOLS_COMPONENT } from './views/admin-tools'

// The card where an entity's behavior lives starts open the first time it is
// selected: every inspector card but Transform starts collapsed, so a creator
// who selects a trigger zone or spawner would land on a wall of headers with no
// hint that the settings worth editing are one click away. AdminTools and
// VideoScreen outrank Script because on those prefabs the script is plumbing
// with no params — the named component is where the settings are.
const PRIMARY = [ADMIN_TOOLS_COMPONENT, 'asset-packs::VideoScreen', SCRIPT_COMPONENT]

// One reveal per card per session. After that the creator's own open/collapse
// choice (persisted per entity in expandedComponents) must win on reselect —
// re-opening a card they just closed would fight them.
const revealed = new Set<string>()

export function autoExpandPrimary(entityId: string): void {
  const comps = state.snapshot[entityId]
  if (comps === undefined) return
  const name = PRIMARY.find((n) => comps[n] !== undefined)
  if (name === undefined) return
  const key = componentKey(entityId, name)
  if (revealed.has(key)) return
  revealed.add(key)
  setComponentExpanded(key, true)
}
