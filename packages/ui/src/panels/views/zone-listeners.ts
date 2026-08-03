// Which scripts in the scene name this zone. A zone's id IS its entity Name, and
// zoneBus matches names trimmed and lower-cased, so the whole scan is that same
// compare (nameKey) over every Script's string params — the honest answer to
// "does anything actually react to this?".
//
// It backs the zone card's listener line, which is the only place the editor can
// say "nothing reacts to this yet" before the creator finds out by walking into
// it. Read-only by design: this reports what the creator or the assistant
// already wrote. It is not a wiring surface — the empty state coaches with
// prompt chips, never a picker that links one entity to another.
import { SCRIPT_COMPONENT } from '../../../../scene/src/allowed-components'
import { entityName, nameKey } from '../../../../scene/src/custom-components'
import type { Snapshot } from '../../../../scene/src/state'
import { parseLayout } from '../../script/parser'

export interface ZoneListener {
  entityId: string
  /** The listening entity's Name, or its id when it has none. */
  entity: string
  /** Script file name without the extension — how the inspector titles it. */
  script: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function scriptLabel(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.(tsx?|jsx?)$/, '')
}

// Only string params can hold a zone name: the editor has no 'zone' param type,
// and an enum's options are fixed choices, not scene names.
function namesZone(layout: string | undefined, wanted: string): boolean {
  const params = parseLayout(layout)?.params
  if (!isRecord(params)) return false
  for (const param of Object.values(params)) {
    if (param.type !== 'string' || typeof param.value !== 'string') continue
    if (nameKey(param.value) === wanted) return true
  }
  return false
}

/**
 * Every script that names `zoneName` in one of its string params. The zone's own
 * entity is excluded: its script is the detector, not a listener.
 */
export function zoneListeners(snapshot: Snapshot, zoneId: string, zoneName: string): ZoneListener[] {
  const wanted = nameKey(zoneName)
  if (wanted === '') return []
  const found: ZoneListener[] = []
  for (const id of Object.keys(snapshot)) {
    if (id === zoneId) continue
    const comp = snapshot[id]?.[SCRIPT_COMPONENT]
    const items = isRecord(comp) && Array.isArray(comp.value) ? comp.value : []
    for (const item of items) {
      if (!isRecord(item) || typeof item.path !== 'string') continue
      if (!namesZone(typeof item.layout === 'string' ? item.layout : undefined, wanted)) continue
      found.push({ entityId: id, entity: entityName(snapshot, id) ?? `#${id}`, script: scriptLabel(item.path) })
    }
  }
  return found
}

// Beyond a couple of names the list stops being readable and the count carries
// the meaning.
const MAX_NAMED = 2

/** "2 scripts listen — HallDoor (Door), Chime (Speaker)". Empty when nothing does. */
export function listenerLine(listeners: ZoneListener[]): string {
  if (listeners.length === 0) return ''
  const named = listeners.slice(0, MAX_NAMED).map((l) => `${l.script} (${l.entity})`)
  const rest = listeners.length - named.length
  const head = listeners.length === 1 ? '1 script listens' : `${listeners.length} scripts listen`
  return `${head} — ${named.join(', ')}${rest > 0 ? ` +${rest} more` : ''}`
}

/** Starter asks for a zone nothing reacts to yet. Each names the zone in full. */
export function zonePrompts(zoneName: string): string[] {
  const zone = zoneName.trim()
  return [`Open the door when someone walks into "${zone}"`, `Play a sound when a player enters "${zone}"`]
}

/**
 * Generic starter for the zone's Script card: names the zone but leaves the
 * action for the creator to write in the composer.
 */
export function zoneActionPrompt(zoneName: string): string {
  return `Do something when someone enters "${zoneName.trim()}"`
}
