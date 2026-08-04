// The [Scene] block the assistant gets on every turn. The CLI is a chat wrapper
// around a coding agent with the project as its cwd — it cannot query the live
// scene, so everything it knows about what the creator built has to arrive as
// prompt text. Without this, "the door" and "Front Hall" are unresolvable and
// the only entity it can reason about is whatever happens to be selected.
//
// Names, not ids, are the shared handle: the creator types one in the hierarchy,
// a script asks for the same one via isInZone(), and the assistant reads it here.
// Transforms are reported in WORLD metres (the frame the creator sees in the
// inspector and the frame a place-request is interpreted in), never raw local
// Transform values, which are meaningless under a parented entity.
import { NAME_COMPONENT, entityName } from '../../../scene/src/custom-components'
import { describeEntity } from '../../../scene/src/entity-kind'
import { isUiEntity, type Snapshot } from '../../../scene/src/state'
import {
  SCRIPT_COMPONENT,
  TRIGGER_AREA,
  isAllowedComponent
} from '../../../scene/src/allowed-components'
import { worldTransformOf } from '../../../scene/src/world-pos'
import { parseLayout, type ScriptParam } from '../script/parser'

// Below this the ids are engine-reserved (root, player, camera, world origin).
const FIRST_AUTHORED = 512
// A big scene would otherwise crowd out the actual request. Zones are exempt:
// they are the point of the roster and there are never many of them.
const MAX_ROWS = 80

interface Vec3 {
  x: number
  y: number
  z: number
}

interface ScriptRow {
  path: string
  params: string
}

interface EntityRow {
  id: string
  name: string
  kind: string
  position: Vec3
  scale: Vec3
  comps: string[]
  scripts: ScriptRow[]
  zone: boolean
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

// Two decimals is the inspector's own precision; -0 reads as a bug.
function metres(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const r = Math.round(n * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

function vec(v: Vec3): string {
  return `${metres(v.x)} ${metres(v.y)} ${metres(v.z)}`
}

function readVec(v: unknown, fallback: number): Vec3 {
  if (!isRecord(v)) return { x: fallback, y: fallback, z: fallback }
  const n = (k: string): number => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? v[k] : fallback)
  return { x: n('x'), y: n('y'), z: n('z') }
}

// World frame when the world origin is present, the authored local Transform
// otherwise — a roster that silently drops positions is worse than one that
// reports the only frame it can establish.
function placement(snapshot: Snapshot, id: string): { position: Vec3; scale: Vec3 } {
  const world = worldTransformOf(snapshot, id)
  if (world !== null) {
    return {
      position: { x: world.position.x, y: world.position.y, z: world.position.z },
      scale: { x: world.scale.x, y: world.scale.y, z: world.scale.z }
    }
  }
  const t = snapshot[id]?.Transform
  const local = isRecord(t) ? t : {}
  return { position: readVec(local.position, 0), scale: readVec(local.scale, 1) }
}

function paramText(params: Record<string, ScriptParam> | undefined): string {
  if (params === undefined) return ''
  return Object.entries(params)
    .map(([name, param]) => `${name}: ${JSON.stringify(param.value)}`)
    .join(', ')
}

function scriptRows(bag: Record<string, unknown>): ScriptRow[] {
  const comp = bag[SCRIPT_COMPONENT]
  const items = isRecord(comp) && Array.isArray(comp.value) ? comp.value : []
  const rows: ScriptRow[] = []
  for (const item of items) {
    if (!isRecord(item) || typeof item.path !== 'string') continue
    const layout = parseLayout(typeof item.layout === 'string' ? item.layout : undefined)
    rows.push({ path: item.path, params: paramText(layout?.params) })
  }
  return rows
}

// The kind derivation reads only this entity's own components, so a one-key
// snapshot is enough — and stripping the Name is what makes it answer with the
// KIND ("Trigger area") instead of echoing the name back.
function kindOf(snapshot: Snapshot, id: string, hasChildren: boolean): string {
  const bag = snapshot[id] ?? {}
  const withoutName: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(bag)) if (k !== NAME_COMPONENT) withoutName[k] = v
  const kind = describeEntity({ [id]: withoutName }, id, hasChildren)
  return kind.detail === null ? kind.primary : `${kind.primary} · ${kind.detail}`
}

function childCounts(snapshot: Snapshot): Map<string, number> {
  const counts = new Map<string, number>()
  for (const bag of Object.values(snapshot)) {
    const t = bag.Transform
    const parent = isRecord(t) && typeof t.parent === 'number' ? String(t.parent) : '0'
    counts.set(parent, (counts.get(parent) ?? 0) + 1)
  }
  return counts
}

export function sceneRows(snapshot: Snapshot): EntityRow[] {
  const counts = childCounts(snapshot)
  const rows: EntityRow[] = []
  for (const id of Object.keys(snapshot)) {
    const numeric = Number(id)
    if (!Number.isFinite(numeric) || numeric < FIRST_AUTHORED) continue
    const bag = snapshot[id]
    if (bag === undefined) continue
    // A Name is what makes an entity addressable — the handle the assistant
    // would have to use to talk about it. Nameless code entities can't be named
    // in a prompt or a request, so listing them only spends tokens.
    const name = entityName(snapshot, id)
    if (name === undefined || isUiEntity(snapshot, id)) continue
    const { position, scale } = placement(snapshot, id)
    rows.push({
      id,
      name,
      kind: kindOf(snapshot, id, (counts.get(id) ?? 0) > 0),
      position,
      scale,
      comps: Object.keys(bag).filter(
        (n) => isAllowedComponent(n) && n !== NAME_COMPONENT && n !== 'Transform' && n !== SCRIPT_COMPONENT
      ),
      scripts: scriptRows(bag),
      zone: bag[TRIGGER_AREA] !== undefined
    })
  }
  rows.sort((a, b) => Number(a.id) - Number(b.id))
  return rows
}

function lineFor(row: EntityRow): string {
  const parts = [
    `- "${row.name}" (id ${row.id}) — ${row.kind}`,
    `at ${vec(row.position)} m`,
    `size ${vec(row.scale)} m`
  ]
  if (row.comps.length > 0) parts.push(`has ${row.comps.join(', ')}`)
  const lines = [parts.join(' — ')]
  for (const script of row.scripts) {
    lines.push(`    script ${script.path}${script.params === '' ? '' : ` — ${script.params}`}`)
  }
  return lines.join('\n')
}

// The whole [Scene] block, ready to prepend to a turn. Pure: everything comes
// from the snapshot the hierarchy and inspector already read.
export function buildSceneRoster(snapshot: Snapshot, max = MAX_ROWS): string {
  const rows = sceneRows(snapshot)
  const zones = rows.filter((r) => r.zone)
  let shown = rows
  let omitted = 0
  if (rows.length > max) {
    const room = Math.max(0, max - zones.length)
    const rest = rows.filter((r) => !r.zone).slice(0, room)
    const keep = new Set([...zones, ...rest].map((r) => r.id))
    shown = rows.filter((r) => keep.has(r.id))
    omitted = rows.length - shown.length
  }

  const head =
    '[Scene] What the creator has authored, as the editor sees it right now. Refer to an entity by its Name — ' +
    'that name is the one handle the creator, the scripts and you all share. Positions and sizes are WORLD metres; ' +
    "a zone's size IS its Transform scale."
  const body =
    shown.length === 0 ? 'The scene has no authored entities yet.' : shown.map(lineFor).join('\n')
  const tail = omitted === 0 ? [] : [`…and ${omitted} more entit${omitted === 1 ? 'y' : 'ies'} not listed.`]
  const zoneLine =
    zones.length === 0
      ? 'Zones in this scene: none yet.'
      : `Zones in this scene: ${zones.map((z) => `"${z.name}"`).join(', ')}`

  return [head, body, ...tail, zoneLine].join('\n')
}

// One line per prefab copy in this project that ships an ai.md, so the prompt
// stays O(1) in prefab count: the assistant pulls the guide itself instead of
// carrying every prefab's rules in DCL_SYSTEM_PROMPT. Copies, not placed
// instances — a script imports from custom/<slug>/ whether or not an instance is
// in the scene, and the `_2` dedup is already per copy.
export interface GuideEntry {
  // project-relative prefab folder, e.g. 'custom/trigger_zone'
  folder: string
  name: string
  version: string
  description: string
}

// data.json's name and description are importable text from a folder the creator
// may have got from anyone, and they land in the prompt — so each arrives as one
// truncated line and can't fake a block of its own.
const MAX_NAME = 80
const MAX_DESCRIPTION = 200

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

export function buildGuideIndex(entries: GuideEntry[]): string {
  if (entries.length === 0) return ''
  const head =
    '[Prefab guides] Prefab copies in this project that ship an AI guide — each guide documents the exact copy ' +
    'on disk. MANDATORY: before writing or editing any code that touches one of these prefabs (importing from its ' +
    'folder, reacting to its zones or events, calling its API, setting its params), read its guide first.'
  const lines = entries.map((entry) => {
    const version = entry.version === '' ? '' : ` v${entry.version}`
    const label = `${oneLine(entry.name, MAX_NAME)}${version}`
    const description = oneLine(entry.description, MAX_DESCRIPTION)
    const parts = [entry.folder, label, ...(description === '' ? [] : [description]), `guide: ${entry.folder}/ai.md`]
    return `- ${parts.join(' — ')}`
  })
  return [head, ...lines].join('\n')
}
