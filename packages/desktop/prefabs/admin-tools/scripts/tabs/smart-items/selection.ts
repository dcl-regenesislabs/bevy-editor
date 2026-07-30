// Smart-item list building and per-item panel state.
//
// `linkAllSmartItems` is a plain flag in the inspector — nothing populates the
// list from it — so it is honoured here: with it on, every entity carrying
// asset-packs::Actions joins the dropdown, named after core-schema::Name.
import { engine, Name, VisibilityComponent, type Entity } from '@dcl/sdk/ecs'
import { getActions } from '../../actions'
import { Actions, type AdminToolsValue } from '../../components'
import type { AdminState, SmartItemUiState } from '../../state'

export interface SmartItemEntry {
  entity: Entity
  customName: string
  defaultAction: string
}

export interface SmartItemsUiState {
  lastPlayed: string
  lastPlayedFailed: boolean
}

export const smartItemsUi: SmartItemsUiState = { lastPlayed: '', lastPlayedFailed: false }

function labelFor(entity: Entity): string {
  const name = Name.getOrNull(entity)
  return name !== null && name.value !== '' ? name.value : `Entity ${entity as number}`
}

export function smartItemList(config: AdminToolsValue, self: Entity): SmartItemEntry[] {
  const entries: SmartItemEntry[] = []
  const seen = new Set<number>()

  for (const item of config.smartItemsControl.smartItems ?? []) {
    if (item.entity === 0 || seen.has(item.entity)) continue
    seen.add(item.entity)
    const entity = item.entity as Entity
    entries.push({
      entity,
      customName: item.customName === '' ? labelFor(entity) : item.customName,
      defaultAction: item.defaultAction
    })
  }

  if (!config.smartItemsControl.linkAllSmartItems) return entries

  const discovered: SmartItemEntry[] = []
  for (const [entity] of engine.getEntitiesWith(Actions)) {
    if (entity === self || seen.has(entity as number)) continue
    seen.add(entity as number)
    discovered.push({
      entity,
      customName: labelFor(entity),
      defaultAction: getActions(entity)[0]?.name ?? ''
    })
  }
  discovered.sort((a, b) => (a.entity as number) - (b.entity as number))
  return [...entries, ...discovered]
}

export function uiStateFor(state: AdminState, item: SmartItemEntry): SmartItemUiState {
  const existing = state.smartItems.byEntity.get(item.entity)
  if (existing !== undefined) return existing
  const created: SmartItemUiState = {
    visible: VisibilityComponent.getOrNull(item.entity)?.visible ?? true,
    selectedAction: item.defaultAction
  }
  state.smartItems.byEntity.set(item.entity, created)
  return created
}

export function selectedItem(state: AdminState, items: SmartItemEntry[]): SmartItemEntry | undefined {
  const index = state.smartItems.selectedIndex
  if (index === undefined || index < 0 || index >= items.length) return undefined
  return items[index]
}

export function selectSmartItem(state: AdminState, items: SmartItemEntry[], index: number): void {
  if (index < 0 || index >= items.length) return
  state.smartItems.selectedIndex = index
  uiStateFor(state, items[index])
  smartItemsUi.lastPlayed = ''
  smartItemsUi.lastPlayedFailed = false
}

export function setVisible(state: AdminState, item: SmartItemEntry, visible: boolean): void {
  uiStateFor(state, item).visible = visible
  const existing = VisibilityComponent.getMutableOrNull(item.entity)
  if (existing === null) VisibilityComponent.create(item.entity, { visible })
  else existing.visible = visible
}
