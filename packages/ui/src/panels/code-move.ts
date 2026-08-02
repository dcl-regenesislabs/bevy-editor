// Dragging a code-spawned entity is a measurement, not an edit.
//
// The entity was created by the scene's own code (engine.addEntity()), so it
// isn't in main.composite and nothing the editor saves can change it — on the
// next run the code puts it back exactly where the code says. The drag still
// moves it in the live scene, which makes it a genuinely useful way to find the
// pose you want. This module turns that before→after into a request the
// assistant can act on by changing the code.
//
// Deliberately NOT included in the prompt: the entity id. Runtime ids depend on
// creation order and shift whenever anyone edits a script, so naming one would
// point the assistant at something that won't exist next run.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface CodeFieldEdit {
  component: string
  changes: Array<{ path: string; before: string; after: string }>
}

export interface CodeMove {
  position: { before: Vec3; after: Vec3 } | null
  rotation: { before: Vec3; after: Vec3 } | null
  scale: { before: Vec3; after: Vec3 } | null
  /** non-Transform edits, with the actual before→after values */
  fields: CodeFieldEdit[]
  /** the entity's display label, when it has one worth quoting */
  label: string | null
}

interface TransformLike {
  position?: Partial<Vec3>
  rotation?: Partial<Vec3>
  scale?: Partial<Vec3>
}

const EPS = 0.005

function vec(v: Partial<Vec3> | undefined): Vec3 | null {
  if (v === undefined) return null
  const { x, y, z } = v
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
  return { x, y, z }
}

function changed(a: Vec3 | null, b: Vec3 | null): boolean {
  if (a === null || b === null) return false
  return Math.abs(a.x - b.x) > EPS || Math.abs(a.y - b.y) > EPS || Math.abs(a.z - b.z) > EPS
}

// 2dp, with trailing zeros (and a bare trailing dot) trimmed off: 8.00 → 8.
function r2(n: number): string {
  return n.toFixed(2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

export function fmt(v: Vec3): string {
  return `(${r2(v.x)}, ${r2(v.y)}, ${r2(v.z)})`
}

/** Build a move from the drag's before/after transforms, or null if nothing moved. */
export function buildCodeMove(before: unknown, after: unknown, label: string | null): CodeMove | null {
  const b = (before ?? {}) as TransformLike
  const a = (after ?? {}) as TransformLike
  const move: CodeMove = {
    position: null,
    rotation: null,
    scale: null,
    fields: [],
    label: label !== null && label.trim() !== '' ? label.trim() : null
  }
  const pairs = [
    ['position', vec(b.position), vec(a.position)],
    ['rotation', vec(b.rotation), vec(a.rotation)],
    ['scale', vec(b.scale), vec(a.scale)]
  ] as const
  for (const [key, bv, av] of pairs) {
    if (changed(bv, av) && bv !== null && av !== null) move[key] = { before: bv, after: av }
  }
  return move.position === null && move.rotation === null && move.scale === null ? null : move
}

// A scalar as it should read in the prompt: strings quoted, numbers trimmed to a
// sane precision, everything else compact JSON.
function scalar(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number') return String(Number(v.toFixed(4)))
  if (v === undefined) return '(unset)'
  try {
    const j = JSON.stringify(v) ?? String(v)
    return j.length > 80 ? `${j.slice(0, 79)}…` : j
  } catch {
    return String(v)
  }
}

const MAX_CHANGES = 12

// Walk before/after together and report every leaf that differs, as a dotted path.
// The values are already in hand from the history entry — telling the assistant to
// "see the editor" when we know both sides is just making it guess.
function diffLeaves(
  before: unknown,
  after: unknown,
  prefix: string,
  out: Array<{ path: string; before: string; after: string }>
): void {
  if (out.length >= MAX_CHANGES) return
  const bothObjects =
    typeof after === 'object' && after !== null && !Array.isArray(after) &&
    typeof before === 'object' && before !== null && !Array.isArray(before)
  if (bothObjects) {
    const a = after as Record<string, unknown>
    const b = before as Record<string, unknown>
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      diffLeaves(b[k], a[k], prefix === '' ? k : `${prefix}.${k}`, out)
    }
    return
  }
  if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return
  out.push({ path: prefix, before: scalar(before), after: scalar(after) })
}

/** Any edit to a code-spawned entity, not just a drag: the warning has to be the
    same whichever way the value was changed, and in play mode as well as stopped. */
export function buildCodeEdit(
  edits: Array<{ name: string; before?: unknown; after?: unknown }>,
  label: string | null
): CodeMove | null {
  const byComponent = new Map<string, CodeFieldEdit>()
  for (const e of edits) {
    if (e.name === '') continue
    const changes: Array<{ path: string; before: string; after: string }> = []
    diffLeaves(e.before, e.after, '', changes)
    const existing = byComponent.get(e.name)
    if (existing === undefined) byComponent.set(e.name, { component: e.name, changes })
    else existing.changes.push(...changes)
  }
  // A component whose values all match again contributes nothing — dropping it
  // is what lets "back to the value the code sets" resolve to no offer at all.
  const fields = [...byComponent.values()].filter((f) => f.changes.length > 0)
  if (fields.length === 0) return null
  return {
    position: null,
    rotation: null,
    scale: null,
    fields,
    label: label !== null && label.trim() !== '' ? label.trim() : null
  }
}

/** One-line summary for the inspector card. */
export function formatDelta(move: CodeMove): string {
  if (move.position !== null) return `Moved ${fmt(move.position.before)} → ${fmt(move.position.after)}`
  if (move.rotation !== null) return `Rotated ${fmt(move.rotation.before)} → ${fmt(move.rotation.after)}`
  if (move.scale !== null) return `Scaled ${fmt(move.scale.before)} → ${fmt(move.scale.after)}`
  if (move.fields.length > 0) {
    const [first, ...rest] = move.fields
    const head = first.changes.length === 1 ? `${first.component}.${first.changes[0].path}` : first.component
    return rest.length === 0 ? `Changed ${head}` : `Changed ${head} +${rest.length} more`
  }
  return 'Changed'
}

/**
 * The request dropped into the composer. Position-first, only the channels that
 * actually changed, no entity id, and it always closes by asking for a change
 * the creator can keep tweaking rather than a magic number buried in a call.
 */
export function codeMovePrompt(move: CodeMove): string {
  const what = move.label !== null ? `the "${move.label}" entity` : 'the entity your code spawns'
  const verb = move.fields.length > 0 ? 'changed' : 'dragged'
  const lines: string[] = [
    `I ${verb} ${what} in the editor, but it's created by code so the change won't stick. Please update the code to match:`
  ]
  for (const f of move.fields) {
    if (f.changes.length === 0) {
      lines.push(`- its ${f.component} component`)
      continue
    }
    for (const c of f.changes) {
      const where = c.path === '' ? f.component : `${f.component}.${c.path}`
      lines.push(`- ${where}: ${c.before} → ${c.after}`)
    }
  }
  if (move.position !== null) lines.push(`- position: ${fmt(move.position.before)} → ${fmt(move.position.after)}`)
  if (move.rotation !== null) lines.push(`- rotation (euler degrees): ${fmt(move.rotation.before)} → ${fmt(move.rotation.after)}`)
  if (move.scale !== null) lines.push(`- scale: ${fmt(move.scale.before)} → ${fmt(move.scale.after)}`)
  lines.push(
    `Find where this entity is created and change it there. If the value is used more than once or the entity is spawned in a loop, prefer editing a named constant or exposing a Script param over hardcoding it at the call site.`
  )
  return lines.join('\n')
}
