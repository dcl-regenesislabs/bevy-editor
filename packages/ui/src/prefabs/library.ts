// Renderer half of the cross-scene prefab library. The folders themselves live
// outside the project (app resources for builtins, the Electron userData dir for
// the user's own), so every filesystem operation is an IPC call into main — see
// packages/desktop/src/prefab-library.ts. This module only names entries by
// `ref`, parses their data.json with the shared prefab parser, and copies a
// library prefab into the open project before anything is instantiated.
//
// Web build: `window.editorShell` is absent, so `libraryAvailable()` is false and
// the Prefabs tab shows this project's prefabs only.
import type {
  PrefabCopyResult,
  PrefabImportInspect,
  PrefabLibraryEntry,
  PrefabLibraryScope
} from '@dcl-editor/contract'
import { snapshotComponentName } from '../../../scene/src/composite'
import { log } from '../log'
import { readPrefabData } from './storage'
import type { PrefabData } from './format'

export interface LibraryEntry {
  ref: string
  scope: PrefabLibraryScope
  data: PrefabData
}

export function libraryAvailable(): boolean {
  return window.editorShell?.prefabLibraryList !== undefined
}

// The scene folder the shell opened us with — main needs it to copy folders in
// and out (the data-layer only ever speaks project-relative paths).
export function projectDir(): string | null {
  return new URLSearchParams(window.location.search).get('project')
}

function requireProject(): string {
  const dir = projectDir()
  if (dir === null) throw new Error('no project is open')
  return dir
}

function toLibraryEntry(raw: PrefabLibraryEntry): LibraryEntry {
  return { ref: raw.ref, scope: raw.scope, data: readPrefabData(raw.data, raw.ref) }
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const list = window.editorShell?.prefabLibraryList
  if (list === undefined) return []
  const entries: LibraryEntry[] = []
  for (const raw of await list()) {
    try {
      entries.push(toLibraryEntry(raw))
    } catch (e) {
      log.warn('library prefab unreadable', raw.ref, e)
    }
  }
  return entries
}

// Copy a library prefab into `custom/` so the scene stays self-contained. Main
// answers with the project's existing copy when it already has this prefab.
export async function copyLibraryPrefabIntoProject(ref: string): Promise<PrefabCopyResult> {
  const copyIn = window.editorShell?.prefabLibraryCopyIn
  if (copyIn === undefined) throw new Error('the prefab library needs the desktop app')
  const result = await copyIn(ref, requireProject())
  if (result === null) throw new Error('that prefab is no longer in the library')
  return result
}

export async function savePrefabToLibrary(folder: string): Promise<LibraryEntry> {
  const copyOut = window.editorShell?.prefabLibraryCopyOut
  if (copyOut === undefined) throw new Error('the prefab library needs the desktop app')
  return toLibraryEntry(await copyOut(requireProject(), folder))
}

export async function deleteLibraryPrefab(ref: string): Promise<void> {
  const remove = window.editorShell?.prefabLibraryDelete
  if (remove === undefined) throw new Error('the prefab library needs the desktop app')
  if (!(await remove(ref))) throw new Error('built-in prefabs cannot be removed')
}

export async function pickPrefabImport(kind: 'folder' | 'zip'): Promise<PrefabImportInspect | null> {
  const pick = window.editorShell?.prefabImportPick
  if (pick === undefined) throw new Error('importing prefabs needs the desktop app')
  return pick(kind)
}

export async function importPrefabFromGithub(url: string): Promise<PrefabImportInspect> {
  const fromGithub = window.editorShell?.prefabImportGithub
  if (fromGithub === undefined) throw new Error('importing prefabs needs the desktop app')
  return fromGithub(url)
}

export async function commitPrefabImport(token: string): Promise<LibraryEntry> {
  const commit = window.editorShell?.prefabImportCommit
  if (commit === undefined) throw new Error('importing prefabs needs the desktop app')
  return toLibraryEntry(await commit(token))
}

export function cancelPrefabImport(token: string): void {
  void window.editorShell?.prefabImportCancel?.(token)
}

// Composite component names this editor cannot write. Main reports the names an
// import carries; only the renderer holds the registry that knows them, and an
// unknown one means those components are dropped when the prefab is placed.
export function unknownComponents(names: string[]): string[] {
  return names.filter((name) => snapshotComponentName(name) === undefined)
}
