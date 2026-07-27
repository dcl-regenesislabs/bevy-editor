// App auto-update store — module singleton + useSyncExternalStore, same idiom
// as auth.ts. Desktop-only: everything no-ops when window.editorShell is
// absent (plain browser tab) or predates the updater bridge.
import { useSyncExternalStore } from 'react'
import type { UpdateStatus } from '@dcl-editor/contract'
import { flushPendingSave } from '../../autosave'

let status: UpdateStatus = { state: 'idle' }
const listeners = new Set<() => void>()

// ---- "What's new" after an update ----
// Updates install silently, so this is the moment the creator learns one
// happened: on the first launch after a version change, Home shows a one-time
// toast linking to the release notes. localStorage keeps the last-run version;
// a fresh install (no stored version) announces nothing.
const LAST_RUN_KEY = 'eui:last-run-version'
let whatsNew: string | null = null

export const RELEASES_URL = 'https://github.com/dcl-regenesislabs/bevy-editor/releases'

// the hand-written notes for one version (badge pre-restart, toast post-update)
export function openReleaseNotes(version: string): void {
  void window.editorShell?.openExternal?.(`${RELEASES_URL}/tag/v${version}`)
}

function initWhatsNew(): void {
  const shell = window.editorShell
  if (shell?.appVersion === undefined) return
  void shell.appVersion().then((v) => {
    const prev = localStorage.getItem(LAST_RUN_KEY)
    localStorage.setItem(LAST_RUN_KEY, v)
    if (prev !== null && prev !== v) {
      whatsNew = v
      for (const l of listeners) l()
    }
  })
}

export function useWhatsNew(): string | null {
  return useSyncExternalStore(
    (l) => {
      wire()
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => whatsNew
  )
}

export function dismissWhatsNew(): void {
  whatsNew = null
  for (const l of listeners) l()
}

// main's native-menu restart path can't go through restartToUpdate(), so it
// awaits this hook via webContents.executeJavaScript to get the same
// pending-autosave guarantee before tearing the stack down
;(window as unknown as Record<string, unknown>).__euiFlushPendingSave = flushPendingSave

function set(s: UpdateStatus): void {
  status = s
  for (const l of listeners) l()
}

let wired = false
function wire(): void {
  const shell = window.editorShell
  if (wired || shell?.onUpdateEvent === undefined) return
  wired = true
  shell.onUpdateEvent(set)
  // seed from a pull — a Cmd+R reload misses pushes sent before it subscribed
  void shell.updateStatus?.().then(set)
  initWhatsNew()
}

export function useUpdateStatus(): UpdateStatus {
  return useSyncExternalStore(
    (l) => {
      wire()
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => status
  )
}

// user-initiated check (Account card); resolves with the outcome for explicit
// "you're up to date" / error feedback
export async function checkForUpdates(): Promise<UpdateStatus> {
  const res = await window.editorShell?.updateCheck?.()
  if (res !== undefined) set(res)
  return res ?? status
}

// Install the staged update and relaunch. Flushes the autosave debounce first:
// the restart kills the dev server that writes main.composite, so pending
// edits must land before we go (same guarantee as entering play mode).
export async function restartToUpdate(): Promise<{ ok: boolean; reason?: 'busy' }> {
  const shell = window.editorShell
  if (shell?.updateRestart === undefined) return { ok: false }
  await flushPendingSave()
  return shell.updateRestart()
}
