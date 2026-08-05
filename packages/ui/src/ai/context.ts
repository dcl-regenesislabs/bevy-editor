// The turn context: everything the assistant should see about the scene that the
// creator shouldn't have to retype — the selection and its components, the prefab
// guides this project ships, the open file, and any attached code range. It is
// prepended to the prompt, never shown as the chat bubble.
//
// Pure with respect to its arguments (the open file and code selection come in as
// parameters) so it can be exercised without a mounted panel, like roster.ts.
import { state, entityLabel, type Snapshot } from '@scene/state'
import { entityName, NAME_COMPONENT } from '@scene/custom-components'
import { isAllowedComponent, SCRIPT_COMPONENT } from '@scene/allowed-components'
import { isEntryPoint } from '../script/guarded'
import { buildGuideIndex, buildSceneRoster, type GuideEntry } from './roster'
import { buildGameConfigIndex, buildSpawnableIndex, type SpawnableEntry } from './kit-context'
import { GAME_CONFIG_COMPONENT, normalizeGameConfig, type GameConfigValue } from '../gameconfig/normalize'
import { readSpawnable } from '../prefabs/spawnable'
import { prefabStore } from '../panels/prefab-store'
import { type CodeSelection } from '../panels/ai-store'

export interface EntityInfo {
  id: string
  name: string
  comps: Array<[string, unknown]>
}

function displayName(n: string): string {
  if (n === SCRIPT_COMPONENT) return 'Script'
  const i = n.indexOf('::')
  return i === -1 ? n : n.slice(i + 2)
}

// The script files attached to the currently selected entity (its Script
// component's paths) — what the dock's ⤢ Code button opens as tabs.
export function entityScriptFiles(): string[] {
  const id = state.activeEntity
  if (id === null) return []
  const comp = state.snapshot[id]?.[SCRIPT_COMPONENT] as { value?: Array<{ path?: string }> } | undefined
  return Array.isArray(comp?.value) ? comp.value.map((s) => s.path).filter((p): p is string => typeof p === 'string') : []
}

// All selected entities, active (gizmo anchor) first.
export function selectedEntities(): EntityInfo[] {
  const snap = state.snapshot
  const active = state.activeEntity
  const ids: string[] = []
  if (active !== null) ids.push(active)
  for (const id of state.selected) if (id !== active) ids.push(id)
  const out: EntityInfo[] = []
  for (const id of ids) {
    const bag = snap[id]
    if (bag === undefined) continue
    const name = entityName(snap as Snapshot, id) ?? entityLabel(id)
    const comps = Object.entries(bag).filter(([n]) => isAllowedComponent(n) && n !== NAME_COMPONENT)
    out.push({ id, name, comps })
  }
  return out
}

function guideEntries(): GuideEntry[] {
  return prefabStore.items
    .filter((item) => item.hasGuide)
    .map((item) => ({
      folder: item.folder,
      name: item.data.name,
      version: item.data.version ?? '',
      description: item.data.description ?? ''
    }))
}

function spawnableEntries(): SpawnableEntry[] {
  const entries: SpawnableEntry[] = []
  for (const item of prefabStore.items) {
    const spawnable = readSpawnable(item.data)
    if (spawnable === null) continue
    entries.push({
      name: item.data.name,
      folder: item.folder,
      max: spawnable.max,
      instancing: spawnable.instancing ?? 'onDemand'
    })
  }
  return entries
}

// The Game Config component lives on the scene root, like the inspector reads it.
function gameConfigValue(): GameConfigValue | null {
  const raw = state.snapshot['0']?.[GAME_CONFIG_COMPONENT]
  return raw === undefined ? null : normalizeGameConfig(raw)
}

export function buildContext(sel: CodeSelection | null, open: string | null): string | undefined {
  const parts: string[] = [buildSceneRoster(state.snapshot)]
  const spawnables = buildSpawnableIndex(spawnableEntries())
  if (spawnables !== '') parts.push(spawnables)
  const config = buildGameConfigIndex(gameConfigValue())
  if (config !== '') parts.push(config)
  const guides = buildGuideIndex(guideEntries())
  if (guides !== '') parts.push(guides)
  if (open !== null) {
    parts.push(
      isEntryPoint(open)
        ? `[Open file] The user has ${open} open — the scene's ENTRY POINT, not a per-entity script. ` +
            `Code here is scene-global: systems registered with engine.addSystem, shared state, entities the scene ` +
            `creates itself. It must keep exporting a working main(); register systems inside it. ` +
            `Do not turn this file into a Script class.`
        : `[Open file] The user has ${open} open in the editor.`
    )
  }
  const ents = selectedEntities()
  if (ents.length > 0) {
    const compact = (v: unknown): string => {
      try {
        const s = JSON.stringify(v)
        return s.length > 220 ? s.slice(0, 220) + '…' : s
      } catch {
        return String(v)
      }
    }
    const block = (e: EntityInfo): string => {
      const lines = e.comps.map(([n, v]) => `- ${displayName(n)}: ${compact(v)}`)
      return `Entity: "${e.name}" (id ${e.id})\n` + (lines.length > 0 ? `Components on it:\n${lines.join('\n')}` : 'It has no components yet.')
    }
    const many = ents.length > 1
    const scope = many
      ? `has ${ents.length} entities selected. ` +
        `When they say "these", "them", or "the selected entities", they mean all of them; ` +
        `"this" or "it" most likely means the active one, "${ents[0].name}"`
      : `has ONE entity selected. When they say "this", "it", or "this entity", they mean this one`
    const script = many
      ? ' — a Script attached to an entity receives that entity as `this.entity`'
      : ' — a Script for it receives it as `this.entity`'
    parts.push(
      `[Editor context] The user is editing this scene visually and ${scope}` +
        (isEntryPoint(open) ? '' : script) +
        `.\n` +
        ents.map(block).join('\n')
    )
  }
  if (sel !== null) {
    parts.push(
      `[Selected code] The user is asking about THIS code — ${sel.path}, lines ${sel.startLine}–${sel.endLine}. Edit this file directly if a change is needed:\n\`\`\`ts\n${sel.text}\n\`\`\``
    )
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}
