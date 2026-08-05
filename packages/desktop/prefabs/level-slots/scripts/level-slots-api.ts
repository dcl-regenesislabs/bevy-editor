// The Level Slots surface other scripts talk to. Anchored on globalThis rather
// than in module scope because every prefab folder carries its own copy of the
// modules it uses (the zoneBus convention) — two copies would otherwise be two
// disconnected hubs. Probed by SHAPE: the copies are different class-free
// objects, so `instanceof` would reject a perfectly good hub.

const HUB_KEY = '__dclLevelSlots_v1'

interface LevelSlotsHub {
  rotate: (seed: number) => void
  arenas: string[]
  listeners: Array<(arenas: string[]) => void>
}

function isHub(value: unknown): value is LevelSlotsHub {
  return (
    typeof value === 'object' &&
    value !== null &&
    'rotate' in value &&
    typeof value.rotate === 'function' &&
    'listeners' in value &&
    Array.isArray(value.listeners)
  )
}

function hub(): LevelSlotsHub {
  const globals = globalThis as unknown as Record<string, unknown>
  const current = globals[HUB_KEY]
  if (isHub(current)) return current
  const created: LevelSlotsHub = { rotate: () => {}, arenas: [], listeners: [] }
  globals[HUB_KEY] = created
  return created
}

/**
 * Draw a fresh arena for every slot. SERVER side only — on a client it is a
 * no-op, because the pick is the one thing clients are not allowed to invent.
 * Call it at a phase boundary (an intermission), not every frame.
 */
export function rotateLevels(seed: number): void {
  hub().rotate(seed)
}

/** The prefab ref showing in `slot` (0-based), or null when nothing is picked. */
export function currentArena(slot: number = 0): string | null {
  const ref = hub().arenas[slot]
  return ref === undefined || ref === '' ? null : ref
}

/** Fires whenever the picks change, and once immediately if picks already exist. */
export function onLevelChange(fn: (arenas: string[]) => void): () => void {
  const current = hub()
  current.listeners.push(fn)
  if (current.arenas.length > 0) fn(current.arenas)
  return () => {
    const at = current.listeners.indexOf(fn)
    if (at >= 0) current.listeners.splice(at, 1)
  }
}

/** Controller-only: the server half installs the real draw here. */
export function installRotator(rotate: (seed: number) => void): void {
  hub().rotate = rotate
}

/** Controller-only: publish the refs now on screen and wake the listeners. */
export function publishArenas(arenas: string[]): void {
  const current = hub()
  current.arenas = arenas
  for (const listener of current.listeners.slice()) listener(arenas)
}
