// Shared state for the prefab library, so the surfaces that care about it (the
// Assets panel's Prefabs tab, the hierarchy's instance markers and the
// inspector's "Instance of…" chip) read one list instead of each doing their own
// data-layer round trip. Reactive: `useStore(() => prefabStore.x)` re-renders on
// change (see store.ts).
//
// Two lists, deliberately separate: `items` are the prefabs THIS project owns
// (custom/<slug>/, read over the data-layer) and are the only ones the engine can
// place; `library` are the cross-scene ones (builtin + userData, read over IPC),
// which are copied into the project before they can be placed.
import { reactive } from '../store'
import { log } from '../log'
import { listPrefabFolders, readPrefabFolder } from '../prefabs/storage'
import { libraryAvailable, listLibrary, type LibraryEntry } from '../prefabs/library'
import type { PrefabData } from '../prefabs/format'

export interface PrefabEntry {
  folder: string
  data: PrefabData
}

// Where a card in the Prefabs tab comes from — the tab's section headers and its
// filter speak in these.
export type PrefabSource = 'project' | 'user' | 'builtin'

// A card being dragged over the viewport. `id` is a project folder for
// 'project', a library ref otherwise — the drop layer hands both to the same
// placement action.
export interface PrefabDrag {
  source: PrefabSource
  id: string
  name: string
}

interface PrefabStoreShape {
  items: PrefabEntry[]
  loading: boolean
  loaded: boolean
  error: string | null
  // folder the Prefabs tab should show and flash — the inspector chip's
  // "reveal" and the just-created prefab both set it
  reveal: string | null
  // card being dragged over the viewport; drives the drop layer
  dragging: PrefabDrag | null
  library: LibraryEntry[]
  libraryLoading: boolean
  libraryLoaded: boolean
  libraryError: string | null
  // ref of a library card to flash, same idea as `reveal`
  revealLibrary: string | null
}

export const prefabStore = reactive<PrefabStoreShape>({
  items: [],
  loading: false,
  loaded: false,
  error: null,
  reveal: null,
  dragging: null,
  library: [],
  libraryLoading: false,
  libraryLoaded: false,
  libraryError: null,
  revealLibrary: null
})

export async function refreshPrefabs(): Promise<PrefabEntry[]> {
  prefabStore.loading = true
  try {
    const items: PrefabEntry[] = []
    for (const folder of await listPrefabFolders()) {
      try {
        const { data } = await readPrefabFolder(folder)
        items.push({ folder, data })
      } catch (e) {
        log.warn('prefab folder unreadable', folder, e)
      }
    }
    prefabStore.items = items
    prefabStore.error = null
    prefabStore.loaded = true
    return items
  } catch (e) {
    prefabStore.error = e instanceof Error ? e.message : String(e)
    return prefabStore.items
  } finally {
    prefabStore.loading = false
  }
}

export async function refreshLibrary(): Promise<LibraryEntry[]> {
  if (!libraryAvailable()) {
    prefabStore.libraryLoaded = true
    return []
  }
  prefabStore.libraryLoading = true
  try {
    prefabStore.library = await listLibrary()
    prefabStore.libraryError = null
    prefabStore.libraryLoaded = true
    return prefabStore.library
  } catch (e) {
    prefabStore.libraryError = e instanceof Error ? e.message : String(e)
    return prefabStore.library
  } finally {
    prefabStore.libraryLoading = false
  }
}

// Load once, lazily — the inspector chip needs the list to resolve an assetId
// even when the Prefabs tab has never been opened.
export function ensurePrefabsLoaded(): void {
  if (!prefabStore.loaded && !prefabStore.loading) void refreshPrefabs()
  if (!prefabStore.libraryLoaded && !prefabStore.libraryLoading) void refreshLibrary()
}

export function revealPrefab(folder: string): void {
  prefabStore.reveal = folder
}

export function clearPrefabReveal(): void {
  if (prefabStore.reveal !== null) prefabStore.reveal = null
}

export function revealLibraryPrefab(ref: string): void {
  prefabStore.revealLibrary = ref
}

export function clearLibraryReveal(): void {
  if (prefabStore.revealLibrary !== null) prefabStore.revealLibrary = null
}

export function beginPrefabDrag(drag: PrefabDrag): void {
  prefabStore.dragging = drag
}

export function endPrefabDrag(): void {
  if (prefabStore.dragging !== null) prefabStore.dragging = null
}
