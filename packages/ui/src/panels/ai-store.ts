// Shared state for the AI assistant surface, so any part of the editor (the
// topbar toggle, the Script inspector's "Edit code", a code selection inside the
// Studio editor) can drive one assistant instance. The chat/session state itself
// lives in the AiPanel component; this store only carries the *surface* controls
// (open/mode/file/selection) and a save hook back to the inspector. Reactive so
// `useStore(() => aiStore.x)` re-renders on change (see store.ts).
import { reactive } from '../store'
import { ENTRY_FILE } from '../script/project-files'
import type { CodeMove } from './code-move'

// A range of code the creator asked the assistant about, lifted from the editor.
export interface CodeSelection {
  path: string
  startLine: number
  endLine: number
  text: string
}

interface AiStoreShape {
  open: boolean // assistant visible at all
  mode: 'dock' | 'studio' // narrow chat drawer, or wide editor+chat
  file: string | null // path open in the Studio editor
  tabs: string[] // open documents → tab strip. Opening never closes what's there.
  selection: CodeSelection | null // the code chip in the composer
  prefill: string | null // text to drop into the composer (quick actions / examples)
  railVersion: number // bumped when the project's files change → rail re-lists
  // jump target for the editor; nonce lets the same line be re-revealed
  revealLine: { file: string; line: number; nonce: number } | null
  // The last drag of a code-spawned entity: the pose the creator wanted, which
  // the scene will discard on restart. Offered in the inspector as a code change.
  codeMove: { entityId: string; move: CodeMove } | null
  // Called after the Studio saves/accepts an edit to `path`, so the inspector can
  // re-read that script's params. Set by whoever opens the Studio.
  onSaved: ((path: string, content: string) => void) | null
}

export const aiStore = reactive<AiStoreShape>({
  open: false,
  mode: 'dock',
  file: null,
  tabs: [],
  selection: null,
  prefill: null,
  railVersion: 0,
  revealLine: null,
  codeMove: null,
  onSaved: null
})

export function setPendingCodeMove(entityId: string, move: CodeMove): void {
  aiStore.codeMove = { entityId, move }
}

// The captured pose is only meaningful while the scene still holds it: a restart
// or Stop puts every entity back where the code says. NOT called on undo — see
// code-move-offer.ts, which clears only once no difference is left.
export function clearPendingCodeMove(): void {
  if (aiStore.codeMove !== null) aiStore.codeMove = null
}

// Drop a prompt into the composer and show it — deliberately WITHOUT sending.
// The creator reads it, edits it, and decides; a drag is not a request.
export function askAboutCodeEntity(text: string): void {
  aiStore.prefill = text
  aiStore.mode = 'dock'
  aiStore.open = true
}

// Call after anything creates or deletes a project file (script scaffold, delete,
// an assistant Write) so the Studio's file rail stops showing a stale listing.
export function refreshFileRail(): void {
  aiStore.railVersion++
}

export function toggleAssistant(): void {
  aiStore.open = !aiStore.open
}
export function closeAssistant(): void {
  aiStore.open = false
}

// Open (or reveal) the Studio on a file. `also` seeds sibling tabs (an entity's
// other scripts). Tabs MERGE rather than replace: a creator who opened
// src/index.ts doesn't lose it by clicking a scripted entity. The param-refresh
// hook is registered separately by the currently shown Script inspector
// (setOnSaved), so it tracks the selected entity, not the one the Studio opened from.
export function openStudio(file: string, also: string[] = []): void {
  openDoc(file, also)
  showStudio()
}

// Open the code workspace straight from the topbar — no entity selected, no tab
// history, no assistant needed. Always lands on the scene's entry point, the one
// file every SDK7 scene has; existing tabs stay open alongside it.
export function openCodeEditor(): void {
  openStudio(ENTRY_FILE)
}

// Open a file in the Studio scrolled to a specific line — the "show me where"
// jump from a build/runtime error banner. The target is set BEFORE the panel is
// shown, so the editor mounts already knowing where to go.
export function openCodeAt(file: string, line: number): void {
  openDoc(file)
  aiStore.revealLine = { file, line, nonce: aiStore.revealLine === null ? 1 : aiStore.revealLine.nonce + 1 }
  showStudio()
}

function showStudio(): void {
  aiStore.mode = 'studio'
  aiStore.open = true
}

export function clearRevealLine(): void {
  if (aiStore.revealLine !== null) aiStore.revealLine = null
}

export function openDoc(file: string, also: string[] = []): void {
  const next = [...aiStore.tabs]
  for (const p of [file, ...also]) if (!next.includes(p)) next.push(p)
  aiStore.tabs = next
  aiStore.file = file
  aiStore.selection = null
}

// Close a tab, falling back to its neighbour so the editor is never left on a
// file that isn't open. Closing the last tab leaves the Studio empty, not stale.
export function closeDoc(file: string): void {
  const i = aiStore.tabs.indexOf(file)
  if (i === -1) return
  const next = aiStore.tabs.filter((p) => p !== file)
  aiStore.tabs = next
  if (aiStore.file === file) {
    aiStore.file = next[Math.min(i, next.length - 1)] ?? null
    aiStore.selection = null
  }
}

// The Script inspector for the *currently selected* entity registers its
// param-refresh here (cleared on unmount), so a Studio edit refreshes the right
// entity even after the selection changed.
export function setOnSaved(fn: ((path: string, content: string) => void) | null): void {
  aiStore.onSaved = fn
}

export function setMode(mode: 'dock' | 'studio'): void {
  aiStore.mode = mode
}

// While the Studio is open it claims chords the MAIN process intercepts for the
// scene editor (see boot.ts): ⌘W closes the active tab instead of switching to
// the Move tool, ⌘F finds in the file instead of framing the selection, ⌘Z/⌘⇧Z
// undo TYPING when the code editor has focus. The panel registers a handler on
// mount; boot.ts asks here first and falls through to the scene action only
// when the chord isn't claimed (returns false).
export type StudioChord = 'close-tab' | 'find' | 'undo' | 'redo'
let studioChordHandler: ((c: StudioChord) => boolean) | null = null

export function setStudioChordHandler(fn: ((c: StudioChord) => boolean) | null): void {
  studioChordHandler = fn
}

export function runStudioChord(c: StudioChord): boolean {
  if (!aiStore.open || aiStore.mode !== 'studio') return false
  return studioChordHandler?.(c) ?? false
}

export function setStudioFile(file: string): void {
  if (aiStore.file === file) return
  aiStore.file = file
  aiStore.selection = null
}
export function setSelection(sel: CodeSelection | null): void {
  aiStore.selection = sel
}
