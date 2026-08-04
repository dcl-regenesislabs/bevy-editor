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
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { state, topLevelSelected } from '../../scene/src/state'
import {
  uiSetTool,
  uiFocusEntity,
  uiDeleteSelected,
  uiPlay,
  uiSetCamera,
  uiClearSelection
} from './actions'
import { deleteConfirmSkipped } from './panels/delete-confirm'
import { aiStore } from './panels/ai-store'
import { ALT, MOD, SHIFT, isMod, keyCombo } from './lib/keys'

export type Shortcut = {
  combo: string
  label: string
  // present when this module dispatches the key; absent = handled elsewhere
  // (history.ts, or the overlay toggle in the hook) and shown for completeness.
  match?: (e: KeyboardEvent) => boolean
  run?: () => void
}

export type ShortcutGroup = { title: string; items: Shortcut[] }

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

// The left dock is App's own state, so a key can only ask for it: App hands its
// opener to useEditorShortcuts and the shortcut dispatches through here.
let openPrefabsTab: (() => void) | null = null

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Tools',
    items: [
      { combo: keyCombo(MOD, 'Q'), label: 'Select tool', match: mainOwned(), run: () => uiSetTool('select') },
      { combo: keyCombo(MOD, 'W'), label: 'Move (translate)', match: mainOwned(), run: () => uiSetTool('translate') },
      { combo: keyCombo(MOD, 'E'), label: 'Rotate', match: mainOwned(), run: () => uiSetTool('rotate') },
      { combo: keyCombo(MOD, 'R'), label: 'Scale', match: mainOwned(), run: () => uiSetTool('scale') }
    ]
  },
  {
    title: 'Edit',
    items: [
      { combo: keyCombo(MOD, 'Z'), label: 'Undo' },
      { combo: keyCombo(MOD, SHIFT, 'Z'), label: 'Redo' },
      { combo: keyCombo(MOD, 'D'), label: 'Duplicate' },
      { combo: `${SHIFT} (drag)`, label: 'Invert snap while dragging' },
      { combo: keyCombo(MOD, 'C'), label: 'Copy entity' },
      { combo: keyCombo(MOD, 'V'), label: 'Paste entity' },
      {
        combo: 'Del',
        label: 'Delete selected',
        match: (e) => !isMod(e) && (e.key === 'Delete' || e.key === 'Backspace'),
        run: () => {
          // The key takes the whole entity, which is rarely what someone reaching
          // for it after clicking a component in the inspector meant — so it asks
          // first (App renders the dialog off state.deleteConfirm).
          const ids = topLevelSelected(state.snapshot)
          if (ids.length === 0) return
          if (deleteConfirmSkipped()) void uiDeleteSelected(ids)
          else state.deleteConfirm = ids
        }
      }
    ]
  },
  {
    title: 'Camera',
    items: [
      {
        combo: keyCombo(MOD, 'F'),
        label: 'Focus selection',
        match: mainOwned(),
        run: () => {
          if (state.activeEntity !== null) uiFocusEntity(state.activeEntity)
        }
      },
      {
        combo: '`',
        label: 'Toggle fly camera',
        match: (e) => !isMod(e) && e.key === '`',
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
    // Display-only: ⌘P/⌘⇧[/] live in AiPanel (they need the Studio's state),
    // ⌘S/⌘K in the CodeMirror keymap, ⌘W/⌘F re-routed from the main-process
    // chords while the Studio is open (see ai-store.runStudioChord).
    title: 'Script Studio',
    items: [
      { combo: keyCombo(MOD, 'P'), label: 'Go to file' },
      { combo: keyCombo(MOD, 'S'), label: 'Save file' },
      { combo: keyCombo(MOD, 'F'), label: 'Find in file' },
      { combo: keyCombo(MOD, 'W'), label: 'Close tab' },
      { combo: `${keyCombo(MOD, SHIFT, '[')} / ${keyCombo(MOD, SHIFT, ']')}`, label: 'Previous / next tab' },
      { combo: keyCombo(MOD, 'K'), label: 'Ask AI about selected code' },
      { combo: 'Esc', label: 'Close the Studio' }
    ]
  },
  {
    title: 'Panels',
    items: [
      {
        // Alt, like the other editor keys: bare P belongs to the engine. Matched
        // on the physical code because ⌥P is "π" on a Mac layout.
        combo: keyCombo(ALT, 'P'),
        label: 'Prefabs — ready-made things to place',
        match: (e) => e.altKey && !isMod(e) && e.code === 'KeyP',
        run: () => openPrefabsTab?.()
      }
    ]
  },
  {
    title: 'General',
    items: [
      // Esc and ? toggle the overlay — handled in the hook (they need React state).
      { combo: 'Esc', label: 'Clear selection / close overlay' },
      { combo: '?', label: 'Show / hide this list' },
      // Handled in Editor.tsx, not here: this hook lives inside <App/>, which
      // unmounts while the chrome is hidden — the key that brings it back must
      // outlive it. Listed for the cheatsheet only.
      { combo: keyCombo(MOD, 'U'), label: 'Hide / show the editor UI' }
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
export const SHORTCUT_KEYS = new Set(['q', 'w', 'e', 'r', 'f', 'F5', '`', '?', 'Delete', 'Backspace', 'Escape', 'c', 'v', 'u'])

function isTyping(e: KeyboardEvent): boolean {
  const el = e.composedPath()[0] as HTMLElement | undefined
  const tag = el?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable === true
}

// Install the editor keydown handler. `setOpen` is App's overlay useState setter,
// so the cheatsheet is idiomatic React state — no external store flag.
// `onPrefabs` opens the left dock on the Prefabs tab: App owns that state, and the
// ref keeps the module-level dispatch pointing at the current render's closure.
export function useEditorShortcuts(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
  onPrefabs: () => void
): void {
  const prefabs = useRef(onPrefabs)
  prefabs.current = onPrefabs
  useEffect(() => {
    openPrefabsTab = () => prefabs.current()
    return () => {
      openPrefabsTab = null
    }
  }, [])
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
        // side effect kept OUT of the state updater (it would double-fire under
        // StrictMode/concurrent). Escape closes the overlay if open, else clears
        // the selection (uiClearSelection also syncs the in-viewport gizmo/outline).
        if (open) {
          e.preventDefault()
          setOpen(false)
          return
        }
        // The Studio owns Escape while it's up (AiPanel layers it: modal → confirm
        // → stop turn → back to the chat dock). Clearing the selection here too
        // would wipe the entity context the user curated for it, on the same
        // keypress. The docked chat does NOT claim it: it is always on screen, so
        // it would leave the editor with no way to deselect.
        if (aiStore.mode === 'studio') return
        // The delete confirm owns Escape too: cancelling it must not also throw
        // away the selection the dialog is asking about.
        if (state.deleteConfirm !== null) return
        e.preventDefault()
        uiClearSelection()
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
