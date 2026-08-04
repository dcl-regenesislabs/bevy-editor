// "Show me that one in the tree" — the page's own reveal signal, plus the
// expansion a reveal needs before there is a row to scroll to.
//
// The shared selectEntityInTree (state.ts) schedules its jump through
// engine.addSystem, which only ticks inside the SDK7 scene. Nothing in the page
// runs that loop, so state.jumpTarget was never set here and the panel's scroll
// effect could not fire for ANY page-side caller — a viewport pick, a dropped
// asset, a placed prefab. This is the producer that works in the page.
//
// The counter matters: picking the same entity twice must scroll again, and a
// target that only changed identity would look unchanged to a selector.
import { state, parentOf, type Snapshot } from '../../../scene/src/state'
import { type HierarchyModel } from './hierarchy-model'
import { notify } from '../../../scene/src/reactive'

let target: string | null = null
let seq = 0
let renameOnReveal = false

export function revealInTree(id: string): void {
  target = id
  renameOnReveal = false
  seq++
  notify()
}

// Reveal a row AND open its inline rename with the text preselected — the OS
// new-folder gesture, for a creation flow where the name is load-bearing enough
// that naming should be the same motion as creating. Currently no caller: trigger
// zones stopped forcing a rename once a reaction could resolve the zone off the
// entity at runtime (zoneBus.zoneOf), so the default name works.
export function revealAndRename(id: string): void {
  target = id
  renameOnReveal = true
  seq++
  notify()
}

// Peek, for the shell: a pending rename is worthless while the hierarchy is
// closed or the Assets tab is up, so App brings the tree back before the panel
// (the consumer) mounts. Child effects run before parent ones, so a panel that
// is already showing has consumed the request by the time App looks.
export function renameRequested(): boolean {
  return renameOnReveal
}

// One-shot: the panel takes the request on the reveal it was raised with, so a
// later reveal of any row can never inherit a stale one.
export function consumeRenameRequest(): boolean {
  const wanted = renameOnReveal
  renameOnReveal = false
  return wanted
}

export function revealTarget(): string | null {
  return target
}

export function revealSeq(): number {
  return seq
}

// Shelf ids double as their own default: a `shelf-open:` id is present in
// state.expandedEntities when that shelf is OPEN (it defaults closed), a
// `shelf-closed:` id when it is CLOSED (it defaults open). One empty set,
// two defaults — so revealing into a shelf adds one kind and removes the other.
export const SHELF_STATIC = 'shelf-closed:static'
export const SHELF_CODE = 'shelf-closed:code'
export const SHELF_ENGINE = 'shelf-open:engine'
export const SHELF_UNKNOWN = 'shelf-open:unknown'

const SHELVES = [
  { roots: (m: HierarchyModel) => m.unknownRoots, id: SHELF_UNKNOWN, startClosed: true },
  { roots: (m: HierarchyModel) => m.engineRoots, id: SHELF_ENGINE, startClosed: true },
  { roots: (m: HierarchyModel) => m.codeRoots, id: SHELF_CODE, startClosed: false },
  { roots: (m: HierarchyModel) => m.staticRoots, id: SHELF_STATIC, startClosed: false }
]

// Guards against a parent cycle in a malformed snapshot — the walk must not hang
// the panel's render.
const MAX_HOPS = 64

// Expand every ancestor of `id` (and the shelf it sits under) so its row is in
// the DOM. The row may be collapsed under a parent or inside a shelf that starts
// closed; either way nothing can scroll to it until this has run.
export function expandToReveal(model: HierarchyModel, snapshot: Snapshot, id: string): void {
  const next = new Set(state.expandedEntities)
  next.add(id)
  // One walk up: every step is an ancestor to expand, and the step that lands on
  // a shelf root is the top of the chain — shelf roots are top-level by
  // construction, so there is nothing above it to expand.
  let cur = id
  for (let hops = 0; hops < MAX_HOPS; hops++) {
    const shelf = SHELVES.find((s) => s.roots(model).includes(cur))
    if (shelf !== undefined) {
      if (shelf.startClosed) next.add(shelf.id)
      else next.delete(shelf.id)
      break
    }
    const parent = parentOf(snapshot, cur)
    if (parent === null || !(parent in snapshot)) break
    next.add(parent)
    cur = parent
  }
  state.expandedEntities = next
}
