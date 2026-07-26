// Keyboard shortcuts for the in-world editor — the same set the Creators Hub Pro
// desktop editor uses, mapped onto our actions. One source of truth: SHORTCUT_GROUPS
// carries each shortcut's display combo + label (for the `?` cheatsheet overlay)
// and, when this module owns the key, a matcher + action.
//
// `useEditorShortcuts(setOpen)` installs the keydown handler from a React effect
// (so the `?` overlay is plain useState in App). Undo/redo/duplicate (⌘Z / ⌘⇧Z /
// ⌘D) are owned by history.ts — listed here display-only so the cheatsheet is
// complete, but not re-dispatched here (avoids double-firing).
//
// Tool shortcuts carry Alt (⌥Q/⌥W/⌥E/⌥R, ⌥F) because the bare letters belong to
// the engine: W/A/S/D walk the avatar, E and F are the primary/secondary interact
// buttons, and Q is the point-at gesture. Alt is bound to nothing there, so the
// tools work in every mode and the avatar keeps walking while you edit.
// Viewport-focused keystrokes are handled by embed.ts, which calls runShortcutFor
// directly — those events belong to the iframe's window and never reach this one.
import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { state } from '../../scene/src/state'
import { uiSetTool, uiFocusEntity, uiDeleteEntity, uiPlay, uiSetCamera, uiClearSelection } from './actions'

const isMac = navigator.platform.toLowerCase().includes('mac')
const mod = isMac ? '⌘' : 'Ctrl'

export type Shortcut = {
  combo: string
  label: string
  // present when this module dispatches the key; absent = handled elsewhere
  // (history.ts, or the overlay toggle in the hook) and shown for completeness.
  match?: (e: KeyboardEvent) => boolean
  run?: () => void
}

export type ShortcutGroup = { title: string; items: Shortcut[] }

const plain = (key: string) => (e: KeyboardEvent) =>
  !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === key

// Tool keys carry Alt because the bare letters belong to the engine: W/A/S/D walk
// the avatar, E and F are the primary/secondary interact buttons a creator tests
// their own scene with, and Q is the point-at gesture. Alt is bound to nothing in
// the engine, so these can fire in every mode without taking anything away.
// `e.key` is unreliable here — Alt+letter produces an alternate character on many
// layouts (⌥E is "´" on a Mac) — so match the physical key via e.code.
// The ⌘/Ctrl chords are claimed in the MAIN process (before-input-event), which
// sees every keystroke whatever frame holds focus — a listener in this window
// only ever saw them when the host had focus, which is the "click the toolbar
// first" bug. Listed here so the `?` cheatsheet still documents them.
const mainOwned = () => (_e: KeyboardEvent) => false

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Tools',
    items: [
      { combo: `${mod} Q`, label: 'Select tool', match: mainOwned(), run: () => uiSetTool('select') },
      { combo: `${mod} W`, label: 'Move (translate)', match: mainOwned(), run: () => uiSetTool('translate') },
      { combo: `${mod} E`, label: 'Rotate', match: mainOwned(), run: () => uiSetTool('rotate') },
      { combo: `${mod} R`, label: 'Scale', match: mainOwned(), run: () => uiSetTool('scale') }
    ]
  },
  {
    title: 'Edit',
    items: [
      { combo: `${mod} Z`, label: 'Undo' },
      { combo: `${mod} ⇧ Z`, label: 'Redo' },
      { combo: `${mod} D`, label: 'Duplicate' },
      { combo: '⇧ (drag)', label: 'Invert snap while dragging' },
      { combo: `${mod} C`, label: 'Copy entity' },
      { combo: `${mod} V`, label: 'Paste entity' },
      {
        combo: 'Del',
        label: 'Delete selected',
        match: (e) => !e.metaKey && !e.ctrlKey && (e.key === 'Delete' || e.key === 'Backspace'),
        run: () => {
          // serialize: each delete does its own optimistic write + snapshot reload;
          // firing them concurrently lets a late reload resurrect an already-deleted entity
          void (async () => {
            for (const id of [...state.selected]) await uiDeleteEntity(id)
          })()
        }
      }
    ]
  },
  {
    title: 'Camera',
    items: [
      {
        combo: `${mod} F`,
        label: 'Focus selection',
        match: mainOwned(),
        run: () => {
          if (state.activeEntity !== null) uiFocusEntity(state.activeEntity)
        }
      },
      {
        combo: '`',
        label: 'Toggle fly camera',
        match: (e) => !e.metaKey && !e.ctrlKey && e.key === '`',
        run: () => uiSetCamera(state.camMode === 'free' ? 'off' : 'free')
      },
      // Fly-mode movement is handled by the engine, not this module — display-only
      // so the cheatsheet documents it. WASD only moves while flying (or playing),
      // which is why the bare keys are free for tools while editing.
      { combo: 'W A S D', label: 'Fly move (while fly camera on)' },
      { combo: 'Space / ⇧', label: 'Fly up / down' },
      { combo: 'Scroll', label: 'Fly speed' }
    ]
  },
  {
    title: 'Playback',
    items: [
      { combo: 'F5', label: 'Play / preview', match: (e) => e.key === 'F5', run: () => void uiPlay() }
    ]
  },
  {
    title: 'General',
    items: [
      // Esc and ? toggle the overlay — handled in the hook (they need React state).
      { combo: 'Esc', label: 'Clear selection / close overlay' },
      { combo: '?', label: 'Show / hide this list' }
    ]
  }
]

const DISPATCH: Shortcut[] = SHORTCUT_GROUPS.flatMap((g) => g.items).filter((s) => s.match && s.run)

// Run the shortcut this event matches, if any; true when one fired.
//
// Exported because keys pressed with the engine viewport focused belong to the
// IFRAME's window, not ours. Re-dispatching a synthetic copy onto this window
// looked like it worked, but only while focus happened to be on the host — with
// the viewport genuinely focused the copy never triggered the listener, so the
// tool shortcuts appeared to need the toolbar clicked first. embed.ts calls this
// directly instead, which doesn't depend on focus at all.
export function runShortcutFor(e: KeyboardEvent): boolean {
  if (isTyping(e)) return false
  for (const s of DISPATCH) {
    if (s.match!(e)) {
      s.run!()
      return true
    }
  }
  return false
}

// Keys this module owns that the engine should forward from the viewport iframe
// (see embed.ts). Letters are forwarded too but suppressed while the fly camera
// is active, so movement still works.
export const SHORTCUT_KEYS = new Set(['q', 'w', 'e', 'r', 'f', 'F5', '`', '?', 'Delete', 'Backspace', 'Escape', 'c', 'v'])

function isTyping(e: KeyboardEvent): boolean {
  const el = e.composedPath()[0] as HTMLElement | undefined
  const tag = el?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable === true
}

// Install the editor keydown handler. `setOpen` is App's overlay useState setter,
// so the cheatsheet is idiomatic React state — no external store flag.
export function useEditorShortcuts(open: boolean, setOpen: Dispatch<SetStateAction<boolean>>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e)) return
      // overlay toggle / dismiss — control keys, always available (even in fly)
      if (e.key === '?') {
        e.preventDefault()
        setOpen((o) => !o)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        // side effect kept OUT of the state updater (it would double-fire under
        // StrictMode/concurrent). Escape closes the overlay if open, else clears
        // the selection (uiClearSelection also syncs the in-viewport gizmo/outline).
        if (open) setOpen(false)
        else uiClearSelection()
        return
      }
      // No mode gating on the tool keys any more: they carry Alt, which the engine
      // binds to nothing, so they can't collide with walking or interacting and
      // fire the same way whether the scene is paused or running.
      for (const s of DISPATCH) {
        if (s.match!(e)) {
          e.preventDefault()
          s.run!()
          return
        }
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open, setOpen])
}
