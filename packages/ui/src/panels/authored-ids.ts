// The authored entity ids, read from the project's main.composite on disk.
//
// The hierarchy groups on this. Every signal derived from the RUNNING scene has
// failed on a real project: /crdt_initial returned empty and entity 0's
// inspector::Nodes never reached the snapshot, so all nine authored entities of
// towerofmadness read as code-spawned. The file cannot be wrong about itself.
//
// Module singleton + notify, the same idiom as auth.ts/worlds.ts.
import { log } from '../log'

let ids: Set<string> | null = null
let loadedDir: string | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

export function subscribeAuthored(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** null until the composite has been read (or when there is none). */
export function authoredFromComposite(): Set<string> | null {
  return ids
}

export function loadAuthoredIds(dir: string | null): void {
  if (dir === null || dir === loadedDir) return
  loadedDir = dir
  const read = window.editorShell?.compositeEntityIds
  if (read === undefined) return
  void read(dir)
    .then((list) => {
      // An empty composite is no signal — treating it as "nothing is authored" is
      // exactly the failure this module exists to prevent.
      ids = list.length > 0 ? new Set(list.map(String)) : null
      log.debug('authored ids from main.composite', ids === null ? 'none' : [...ids])
      notify()
    })
    .catch((e) => log.debug('could not read main.composite', e))
}

/** After a save the composite has new entities; re-read it. */
export function refreshAuthoredIds(): void {
  const dir = loadedDir
  loadedDir = null
  loadAuthoredIds(dir)
}
