// The sources the guarantee chips are derived from: every script the project
// could open a pool in, plus the Script layout params that say which prefab a
// `this.<param>` reference actually points at.
//
// Impure half of guarantees.ts. It lives apart so the derivation stays a pure
// function of text, and so the panel pays for one listing instead of one read
// per card.
import { state } from '@scene/state'
import { reactive } from '../core/store'
import { dataLayerAvailable, dataLayerListFiles, dataLayerReadFile } from '../engine/datalayer'
import { log } from '../log'
import { scriptLayouts } from './guarantees'

// A consumer is a hand-written script: `src/` for the scene's own code, the
// prefab folders for kit controllers. A carried runtime module is excluded by
// guarantees.ts itself, and `.d.ts` files declare, never call.
const MAX_SCRIPTS = 400

function isConsumerPath(path: string): boolean {
  if (!path.endsWith('.ts') || path.endsWith('.d.ts')) return false
  if (path.includes('/runtime/')) return false
  return path.startsWith('src/') || path.startsWith('custom/')
}

interface ConsumerStoreShape {
  /** script text by project-relative path */
  scripts: Record<string, string>
  loading: boolean
  loaded: boolean
}

export const consumerStore = reactive<ConsumerStoreShape>({
  scripts: {},
  loading: false,
  loaded: false
})

export async function refreshConsumers(): Promise<Record<string, string>> {
  if (dataLayerAvailable() !== true) return consumerStore.scripts
  consumerStore.loading = true
  try {
    const paths = (await dataLayerListFiles()).filter(isConsumerPath).sort().slice(0, MAX_SCRIPTS)
    const scripts: Record<string, string> = {}
    for (const path of paths) {
      try {
        scripts[path] = await dataLayerReadFile(path)
      } catch {
        /* deleted between the listing and the read — it has no call sites either */
      }
    }
    consumerStore.scripts = scripts
    consumerStore.loaded = true
    return scripts
  } catch (e) {
    log.warn('guarantee sources unreadable', e)
    return consumerStore.scripts
  } finally {
    consumerStore.loading = false
  }
}

export function ensureConsumersLoaded(): void {
  if (consumerStore.loaded || consumerStore.loading) return
  void refreshConsumers()
}

/** The layouts of the scene as it stands — the panel's read of `state.snapshot`. */
export function sceneLayouts(): Record<string, Record<string, unknown>> {
  return scriptLayouts(state.snapshot)
}
