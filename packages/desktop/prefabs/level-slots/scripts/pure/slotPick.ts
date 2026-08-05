// Slot-pick math for Level Slots. SDK-free and side-effect-free: the server
// draws with it and every client re-derives the same answer from the same
// (seed, round). Only the pick INDEX ever travels — arena geometry is rebuilt
// locally from a Spawnable prefab, which is why a multi-entity arena never
// collides with the single-entity limit on server-owned spawnables.

/**
 * A prefab reference as the inspector stores it — the prefab's UUID. Declared
 * here rather than imported from the generated src/scripts/spawnables.ts so the
 * prefab compiles in a scene that has not toggled Spawnable on anything yet.
 */
export type PrefabRef = string & { readonly __prefabRef: unique symbol }

export interface SlotDraw {
  /** One uniform [0,1) draw per slot, in slot order. */
  draws: number[]
  arenaCount: number
  /** What each slot is showing now — a slot never redraws its own arena. */
  previous?: number[]
}

/** One arena index per draw; -1 when there is nothing to pick from. */
export function pickSlots(input: SlotDraw): number[] {
  const { draws, arenaCount, previous } = input
  if (arenaCount <= 0) return draws.map(() => -1)
  if (arenaCount === 1) return draws.map(() => 0)
  return draws.map((draw, slot) => {
    const unit = draw >= 0 && draw < 1 ? draw : 0
    const last = previous?.[slot] ?? -1
    const excludeLast = last >= 0 && last < arenaCount
    const choices = excludeLast ? arenaCount - 1 : arenaCount
    const raw = Math.floor(unit * choices)
    const index = raw >= choices ? choices - 1 : raw
    if (!excludeLast) return index
    return index >= last ? index + 1 : index
  })
}

/**
 * The `arenas` param as a list of refs. A PrefabRef[] param can reach the script
 * as an array, or — until the inspector's array editor is the only writer — as a
 * comma-separated string, so both are accepted and duplicates are dropped.
 */
export function normalizeRefs(value: unknown): string[] {
  const list: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  const out: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const ref = item.trim()
    if (ref !== '' && !out.includes(ref)) out.push(ref)
  }
  return out
}

/** Requested slot count, clamped to the anchors that actually exist. */
export function slotCountFor(requested: number, anchors: number): number {
  if (anchors < 1) return 0
  const wanted = Number.isFinite(requested) ? Math.floor(requested) : 1
  const atLeastOne = wanted < 1 ? 1 : wanted
  return atLeastOne > anchors ? anchors : atLeastOne
}

/** Slots whose pick changed — the only ones a client tears down and rebuilds. */
export function changedSlots(previous: number[], next: number[]): number[] {
  const out: number[] = []
  const length = next.length > previous.length ? next.length : previous.length
  for (let slot = 0; slot < length; slot++) {
    if ((previous[slot] ?? -1) !== (next[slot] ?? -1)) out.push(slot)
  }
  return out
}

export function refAt(refs: string[], pick: number): string | null {
  return pick >= 0 && pick < refs.length ? refs[pick] : null
}
