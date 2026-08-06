// The editor eye: engine-only hiding, applied per frame from inspector::Hide.
//
// Its own module because the pull path (inspector/writes.ts) needs the map too
// — a re-pulled snapshot carries the {visible:false} our own hide wrote, and
// importing click-select from there would drag its const-enum raycast types
// into compilation contexts that forbid them.
//
// Hiding never touches the logical snapshot or main.composite: the write goes
// to the ENGINE, the authored value is remembered here, and clearing the flag
// puts it back. Reversible by construction.
import { cmd } from '../cmd'
import { inertSubtree } from '../inert'
import { log } from '../log'
import { parentOf, state, type Snapshot } from '../state'

const HIDE = 'inspector::Hide'
const VISIBILITY = 'VisibilityComponent'

// exactly the value our own hide writes — if the snapshot still carries it
// (an echo that slipped past the strip), restoring it would re-hide forever
function isOurHide(value: unknown): boolean {
  const v = value as { visible?: unknown } | undefined
  return v !== undefined && typeof v === 'object' && v !== null && Object.keys(v).length === 1 && v.visible === false
}

function flaggedHidden(id: string): boolean {
  return (state.snapshot[id]?.[HIDE] as { value?: boolean } | undefined)?.value === true
}

// id -> the visibility the scene authored, captured BEFORE we overwrote it.
// Used ONLY to strip our own echo out of a freshly pulled snapshot — never to
// restore. Restoring from a captured note broke the moment the note was stale
// or lost (a reload empties it): "show" would put back garbage, and once a bad
// value was captured it was wrong forever. The snapshot is the source of truth
// for what an entity looks like; restore reads it directly.
const hidden = new Map<string, unknown>()

// A reloaded scene lost our engine-only visibility writes — forget them so the
// per-frame sync re-applies rather than believing they're still in place.
export function resetHidden(): void {
  hidden.clear()
}

// Hide applies down the tree, like Lock: hiding a group hides what's inside it.
// Flat reads left a hidden GLB's child (a healthbar quad) floating on its own.
export function hiddenInTree(id: string): boolean {
  let cur: string | null = id
  while (cur !== null && cur !== '0') {
    if (flaggedHidden(cur)) return true
    cur = parentOf(state.snapshot, cur)
  }
  return false
}

// Swap the authored visibility back into a freshly pulled snapshot before
// anyone reads it as truth — otherwise the echo gets captured, saved, and baked
// into the composite as if the creator authored it.
export function stripHidden(snapshot: Record<string, Record<string, unknown>>): void {
  for (const [id, authored] of hidden) {
    const comps = snapshot[id]
    if (comps === undefined) continue
    if (authored === undefined) delete comps[VISIBILITY]
    else comps[VISIBILITY] = authored
  }
}

// The play rule: an inspector::Inert subtree is absent from the BUILT scene, so
// an unfrozen (playing) editor session must not show it either — whatever the
// eye says. The eye keeps ruling edit visibility; this set only exists while
// playing. Runtime spawn copies carry no inspector:: components and parent to
// the scene root, so they never land in it.
const NONE: ReadonlySet<string> = new Set()
export function playHiddenIds(snapshot: Snapshot, frozen: boolean): ReadonlySet<string> {
  return frozen ? NONE : inertSubtree(snapshot)
}

export function syncHidden(): void {
  const playHidden = playHiddenIds(state.snapshot, state.frozen)
  for (const [id, comps] of Object.entries(state.snapshot)) {
    const shouldHide = hiddenInTree(id) || playHidden.has(id)
    if (shouldHide === hidden.has(id)) continue
    if (shouldHide) {
      hidden.set(id, comps[VISIBILITY])
      void cmd
        .setComponent(id, VISIBILITY, JSON.stringify({ visible: false }))
        .catch((e) => log.debug('hide failed', e))
    } else {
      hidden.delete(id)
      // restore what the SNAPSHOT says, not what we once captured: the snapshot
      // has been through restoreInert and the artifact heal, so it is the one
      // place guaranteed to hold the authored value
      const authored = comps[VISIBILITY]
      const restore =
        authored === undefined || isOurHide(authored)
          ? cmd.deleteComponent(id, VISIBILITY)
          : cmd.setComponent(id, VISIBILITY, JSON.stringify(authored))
      void restore.catch((e) => log.debug('unhide failed', e))
    }
  }
}
