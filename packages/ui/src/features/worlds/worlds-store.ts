// Worlds store (module singleton, like the account feature's auth.ts).
import { useSyncExternalStore } from 'react'
import { getAccount, hasValidIdentity } from '../account/auth'
import {
  fetchContributable,
  fetchOwnedNames,
  fetchPlacesMeta,
  fetchWorldScenes,
  mapLimited,
  type SceneCount,
  type WorldEntry
} from './inventory'
import { fetchWorldSettings, type WorldSettings } from './settings'

export interface WorldsState {
  worlds: WorldEntry[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
}
let worldsStore: WorldsState = { worlds: [], status: 'idle', error: null }
const worldsListeners = new Set<() => void>()
function setWorldsStore(patch: Partial<WorldsState>): void {
  worldsStore = { ...worldsStore, ...patch }
  for (const l of worldsListeners) l()
}

let refreshing = false
let worldsWallet: string | null = null // whose worlds the store holds

// A world we could not read is not an empty world: the entry keeps an unknown
// count so no surface can print "0 scenes" for a world the server never answered
// for. A factory, because `scenes` is mutable and one shared array would alias
// across every world that failed.
const unread = (): Awaited<ReturnType<typeof fetchWorldScenes>> => ({
  deployment: null,
  scenes: [],
  sceneCount: { known: false }
})

// Call on mount / wallet change: resets on sign-out or account switch, fetches
// when the store is empty or belongs to another wallet. refreshWorlds() is the
// explicit "Refresh" action; this one is idempotent.
export function ensureWorlds(): void {
  const wallet = hasValidIdentity() ? getAccount() : null
  if (wallet === null) {
    if (worldsWallet !== null || worldsStore.status !== 'idle') {
      worldsWallet = null
      setWorldsStore({ worlds: [], status: 'idle', error: null })
    }
    return
  }
  if (wallet !== worldsWallet || worldsStore.status === 'idle') refreshWorlds()
}

export function refreshWorlds(): void {
  const wallet = getAccount()
  if (wallet === null || !hasValidIdentity()) {
    worldsWallet = null
    setWorldsStore({ worlds: [], status: 'idle', error: null })
    return
  }
  if (refreshing) return
  if (wallet !== worldsWallet) setWorldsStore({ worlds: [] }) // never show another wallet's worlds
  worldsWallet = wallet
  refreshing = true
  setWorldsStore({ status: 'loading', error: null })
  void (async () => {
    try {
      const [owned, contributable] = await Promise.all([
        fetchOwnedNames(wallet),
        fetchContributable().catch(() => [])
      ])
      const byName = new Map<string, WorldEntry>()
      // A factory, not a shared literal: `scenes` is the one mutable field, and
      // spreading a single object would alias one array across every world.
      const blank = (): Omit<WorldEntry, 'name' | 'role'> => ({
        size: null,
        deployment: null,
        scenes: [],
        sceneCount: { known: false },
        settings: null,
        image: null,
        userCount: null
      })
      for (const c of contributable) {
        byName.set(c.name, { ...blank(), name: c.name, role: 'collaborator', size: c.size })
      }
      for (const n of owned) {
        const prev = byName.get(n)
        byName.set(n, { ...blank(), name: n, role: 'owner', size: prev?.size ?? null })
      }
      const entries = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
      const [published, settings, places] = await Promise.all([
        mapLimited(entries, (e) => fetchWorldScenes(e.name).catch(unread)),
        mapLimited(entries, (e) => fetchWorldSettings(e.name).catch(() => null)),
        fetchPlacesMeta(entries.map((e) => e.name))
      ])
      entries.forEach((e, i) => {
        e.deployment = published[i].deployment
        e.scenes = published[i].scenes
        e.sceneCount = published[i].sceneCount
        e.settings = settings[i]
        const p = places.get(e.name)
        e.image = p?.image ?? e.deployment?.thumbnail ?? null
        e.userCount = p?.users ?? null
      })
      setWorldsStore({ worlds: entries, status: 'ready', error: null })
    } catch (err) {
      setWorldsStore({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    } finally {
      refreshing = false
    }
  })()
}

// How many scenes the inventory says a world holds, for callers outside React.
// A world the store has never heard of is unknown, not empty.
export function worldSceneCount(name: string): SceneCount {
  return worldsStore.worlds.find((w) => w.name === name.toLowerCase())?.sceneCount ?? { known: false }
}

// A save returns the world's new settings, so the card and detail update
// without re-fetching the whole inventory.
export function patchWorldSettings(name: string, settings: WorldSettings): void {
  setWorldsStore({ worlds: worldsStore.worlds.map((w) => (w.name === name ? { ...w, settings } : w)) })
}

export function useWorlds(): WorldsState {
  return useSyncExternalStore(
    (l) => {
      worldsListeners.add(l)
      return () => worldsListeners.delete(l)
    },
    () => worldsStore
  )
}
