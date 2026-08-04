// Which scripts in the scene react to a zone, and the starter asks offered when
// none do yet. A zone's id IS its entity Name, and zoneBus matches names trimmed
// and lower-cased, so the scan is that same compare (nameKey) over every Script's
// string params — the honest answer to "does anything actually react to this?".
//
// It backs the Script card's reaction list, which is the only place the editor can
// say "nothing reacts to this yet" before the creator finds out by walking into it.
// Read-only by design: this reports what the creator or the assistant already
// wrote. It is not a wiring surface — the empty state coaches with prompt chips,
// never a picker that links one entity to another.
import { entityName, nameKey } from '@scene/custom-components'
import type { Snapshot } from '@scene/state'
import { scriptsOn, stringParams } from '../../script/references'

export interface ZoneListener {
  entityId: string
  /** The listening entity's Name, or its id when it has none. */
  entity: string
  /** Script file name without the extension — how the inspector titles it. */
  script: string
  /** True when it sits on the zone itself rather than on another object. */
  here: boolean
}

function scriptLabel(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.(tsx?|jsx?)$/, '')
}

/**
 * Every script that reacts to `zoneName`, wherever it lives.
 *
 * On the zone's OWN entity that means any script other than the detector: a
 * reaction scaffolded there leaves its zone param blank and resolves the name at
 * runtime (zoneBus.zoneOf), so there is no string in the layout to match on —
 * being attached to the zone IS the link. Elsewhere in the scene a script has to
 * name the zone in a string param.
 *
 * `detectorPath` is required rather than optional: forgetting it would list the
 * zone's own detector as a reaction to itself.
 */
export function zoneListeners(
  snapshot: Snapshot,
  zoneId: string,
  zoneName: string,
  detectorPath: string | undefined
): ZoneListener[] {
  const wanted = nameKey(zoneName)
  if (wanted === '') return []
  const found: ZoneListener[] = []
  for (const id of Object.keys(snapshot)) {
    const here = id === zoneId
    for (const script of scriptsOn(snapshot, id)) {
      if (here) {
        if (script.path === detectorPath) continue
      } else if (!stringParams(script.layout).some((value) => nameKey(value) === wanted)) {
        continue
      }
      found.push({
        entityId: id,
        entity: entityName(snapshot, id) ?? `#${id}`,
        script: scriptLabel(script.path),
        here
      })
    }
  }
  return found
}

/** Where a reaction lives, for the inspector's list: "here" or "on Door". */
export function listenerWhere(listener: ZoneListener): string {
  return listener.here ? 'here' : `on ${listener.entity}`
}

// Short verbs, not sentences. The creator is reading the zone's own inspector, so
// naming the zone in the chip is noise that also wraps to three lines and quotes
// an auto-name like "Trigger Zone 2" back at them. The zone and the edge are added
// when the chip prefills the composer (zonePrompt).
//
// The last two exist to make LEAVING and WHILE-INSIDE discoverable: a zone that
// only ever advertises "when a player enters" teaches creators it can't do the rest.
export const ZONE_ASKS = [
  { label: 'Play a sound', sentence: 'Play a sound when a player enters' },
  { label: 'Show a message', sentence: 'Show a message when a player enters' },
  { label: 'Give points', sentence: 'Give the player points when they enter' },
  { label: 'Open while inside', sentence: 'Open the door while anyone is inside and close it when the last one leaves' },
  { label: 'Stop on leaving', sentence: 'Stop the sound when the player leaves' }
] as const

/** The sentence a chip actually sends: the ask, bound to this zone by name. */
export function zonePrompt(ask: (typeof ZONE_ASKS)[number], zoneName: string): string {
  return `${ask.sentence} "${zoneName.trim()}"`
}
