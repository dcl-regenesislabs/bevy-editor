// Shared state for the AI assistant surface, so any part of the editor (the
// topbar toggle, the Script inspector's "Edit code", a code selection inside the
// Studio editor) can drive one assistant instance. The chat/session state itself
// lives in the AiPanel component; this store only carries the *surface* controls
// (open/mode/file/selection) and a save hook back to the inspector. Reactive so
// `useStore(() => aiStore.x)` re-renders on change (see store.ts).
import { reactive } from '../store'

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
  file: string | null // script path open in the Studio editor
  files: string[] // sibling scripts on the entity → tab strip
  selection: CodeSelection | null // the code chip in the composer
  prefill: string | null // text to drop into the composer (quick actions / examples)
  // Called after the Studio saves/accepts an edit to `path`, so the inspector can
  // re-read that script's params. Set by whoever opens the Studio.
  onSaved: ((path: string, content: string) => void) | null
}

export const aiStore = reactive<AiStoreShape>({
  open: false,
  mode: 'dock',
  file: null,
  files: [],
  selection: null,
  prefill: null,
  onSaved: null
})

export function toggleAssistant(): void {
  aiStore.open = !aiStore.open
}
export function closeAssistant(): void {
  aiStore.open = false
}

// Open (or reveal) the Studio on a specific script. `files` populates the tab
// strip. The param-refresh hook is registered separately by the currently shown
// Script inspector (setOnSaved), so it tracks the selected entity, not the entity
// the Studio was first opened from.
export function openStudio(file: string, files: string[]): void {
  aiStore.file = file
  aiStore.files = files.length > 0 ? files : [file]
  aiStore.selection = null
  aiStore.mode = 'studio'
  aiStore.open = true
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
export function setStudioFile(file: string): void {
  if (aiStore.file === file) return
  aiStore.file = file
  aiStore.selection = null
}
export function setSelection(sel: CodeSelection | null): void {
  aiStore.selection = sel
}
export function setPrefill(text: string | null): void {
  aiStore.prefill = text
}
