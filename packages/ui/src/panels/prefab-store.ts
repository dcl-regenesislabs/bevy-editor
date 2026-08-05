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
import { reactive } from '../core/store'
import { log } from '../log'
import { prefabFoldersIn, readPrefabFolder } from '../prefabs/storage'
import { dataLayerListFiles, dataLayerReadFileBytes } from '../engine/datalayer'
import { libraryAvailable, listLibrary, type LibraryEntry } from '../prefabs/library'
import { computeOutdated, type OutdatedPrefab } from '../prefabs/outdated'
import type { PrefabData } from '../prefabs/format'

export interface PrefabEntry {
  folder: string
  data: PrefabData
  // object URL for the folder's thumbnail.png; filled in async after listing
  thumbnail?: string
  // the copy ships an ai.md — the AI assistant's guide to this exact folder.
  // Feeds the [Prefab guides] index in the assistant's turn context.
  hasGuide: boolean
}

// Where a card in the Prefabs tab comes from — the tab's section headers and its
// filter speak in these.
export type PrefabSource = 'project' | 'user' | 'builtin'

// Prefabs sharing a `group` (the 23 built-in seats) collapse into one browsable
// card per section, drilled into rather than spread flat across the grid. A text
// filter searches every prefab, so while one is typed nothing groups — matches
// show individually, wherever they live.
export function groupPrefabCards<T extends { data: PrefabData }>(
  cards: T[],
  grouping: boolean
): { groups: Map<string, T[]>; singles: T[] } {
  const groups = new Map<string, T[]>()
  const singles: T[] = []
  for (const card of cards) {
    const name = card.data.group
    if (!grouping || name === undefined || name === '') {
      singles.push(card)
      continue
    }
    const members = groups.get(name)
    if (members === undefined) groups.set(name, [card])
    else members.push(card)
  }
  return { groups, singles }
}

// A card being dragged over the viewport. `id` is a project folder for
// 'project', a library ref otherwise — the drop layer hands both to the same
// placement action.
export interface PrefabDrag {
  source: PrefabSource
  id: string
  name: string
}

// What a just-finished create wants to say. The toast and the card flash both
// expire before a creator's eyes finish crossing a tab switch, so the Prefabs
// tab keeps this until it is dismissed and explains the prefab there.
export interface PrefabCreated {
  folder: string
  name: string
  placement: 'unplaced' | 'editorAndPlay' | 'editingOnly'
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
  // project folder whose property sheet should open — a scene check's fix and
  // the just-created Notice both point the creator at the same control
  sheetFor: string | null
  // the prefab a create gesture just made, until the creator dismisses it
  created: PrefabCreated | null
  // project copies older than their built-in master, keyed by prefab id —
  // recomputed whenever either list refreshes
  outdated: Map<string, OutdatedPrefab>
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
  revealLibrary: null,
  sheetFor: null,
  created: null,
  outdated: new Map()
})

function recomputeOutdated(): void {
  const masters = prefabStore.library.filter((e) => e.scope === 'builtin').map((e) => e.data)
  prefabStore.outdated = computeOutdated(prefabStore.items, masters)
}

export async function refreshPrefabs(): Promise<PrefabEntry[]> {
  prefabStore.loading = true
  try {
    // one listing for the whole refresh: the folders, their guides and (async)
    // their thumbnails all come out of it
    const files = await dataLayerListFiles()
    const present = new Set(files)
    const items: PrefabEntry[] = []
    for (const folder of prefabFoldersIn(files)) {
      try {
        const { data } = await readPrefabFolder(folder)
        items.push({ folder, data, hasGuide: present.has(`${folder}/ai.md`) })
      } catch (e) {
        log.warn('prefab folder unreadable', folder, e)
      }
    }
    prefabStore.items = items
    prefabStore.error = null
    prefabStore.loaded = true
    recomputeOutdated()
    void loadProjectThumbnails(items.map((i) => i.folder), present)
    return items
  } catch (e) {
    prefabStore.error = e instanceof Error ? e.message : String(e)
    return prefabStore.items
  } finally {
    prefabStore.loading = false
  }
}

// Project thumbnails come through the data-layer as bytes; the object URLs are
// cached per folder so a refresh doesn't refetch them, and revoked when their
// folder disappears so deleted prefabs don't leak their blobs. `null` marks a
// folder already looked at. When the loads finish, the entries are republished
// with `thumbnail` set — the store assignment is what re-renders the cards.
const thumbCache = new Map<string, string | null>()

// `present` is the caller's file listing — only thumbnails that exist are
// fetched, because a read of a missing file is answered client-side but the dev
// server still logs the failed RPC as an error, and a scene with a few
// thumbnail-less prefabs would spam its log on every refresh.
async function loadProjectThumbnails(folders: string[], present: Set<string>): Promise<void> {
  const live = new Set(folders)
  for (const [folder, url] of [...thumbCache]) {
    if (live.has(folder)) continue
    if (url !== null) URL.revokeObjectURL(url)
    thumbCache.delete(folder)
  }
  for (const folder of folders) {
    if (thumbCache.has(folder) || !present.has(`${folder}/thumbnail.png`)) continue
    thumbCache.set(folder, null)
    try {
      const bytes = await dataLayerReadFileBytes(`${folder}/thumbnail.png`)
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      thumbCache.set(folder, url)
    } catch {
      /* vanished between listing and read — the card keeps its glyph */
    }
  }
  prefabStore.items = prefabStore.items.map((item) => {
    const thumbnail = thumbCache.get(item.folder)
    return typeof thumbnail === 'string' ? { ...item, thumbnail } : item
  })
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
    recomputeOutdated()
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

// The one create gesture that just landed. A second create replaces the first —
// only the newest prefab is the one the creator is still looking for.
export function announceCreated(c: PrefabCreated): void {
  prefabStore.created = c
}

export function clearCreated(): void {
  if (prefabStore.created !== null) prefabStore.created = null
}

// Asks the Prefabs tab to open one card's property sheet. Reveals as well, so
// the dock switches to the tab that owns the sheet before it opens.
export function openPrefabSheet(folder: string): void {
  prefabStore.sheetFor = folder
  revealPrefab(folder)
}

export function clearSheetRequest(): void {
  if (prefabStore.sheetFor !== null) prefabStore.sheetFor = null
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
