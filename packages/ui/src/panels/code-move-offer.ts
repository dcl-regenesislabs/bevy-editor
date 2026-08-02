// When the "move it in the code" offer should be showing, and what it should say.
//
// The offer is a diff from the value the SCENE'S CODE produced — never from the
// last edit. That distinction is the whole bug it exists to avoid: move an entity
// three times and undo once and it is still somewhere the code never put it, so
// the offer has to survive that undo and describe what is left. Clearing on any
// undo (and building the card from one history entry) got both halves wrong.
//
// The code's value is the `before` of the FIRST edit this session touches — while
// the scene is frozen, that is exactly what its code last set.
import { buildCodeMove, buildCodeEdit } from './code-move'
import { setPendingCodeMove, clearPendingCodeMove } from './ai-store'

const origins = new Map<string, unknown>()

function keyOf(entity: string, name: string): string {
  return `${entity}|${name}`
}

export function noteCodeOrigin(entity: string, name: string, before: unknown): void {
  const k = keyOf(entity, name)
  if (!origins.has(k)) origins.set(k, before)
}

// A restart re-runs the code, so every remembered origin is about a scene
// instance that no longer exists.
export function resetCodeOrigins(): void {
  origins.clear()
}

// Recompute the offer from where the entity started and where it is NOW. Null
// from the builders means "no difference left", which is the clear.
export function refreshCodeMove(
  entity: string,
  name: string,
  current: unknown,
  label: string | null
): void {
  const k = keyOf(entity, name)
  if (!origins.has(k)) return
  const origin = origins.get(k)
  const move =
    name === 'Transform'
      ? buildCodeMove(origin, current, label)
      : buildCodeEdit([{ name, before: origin, after: current }], label)
  if (move === null) clearPendingCodeMove()
  else setPendingCodeMove(entity, move)
}
