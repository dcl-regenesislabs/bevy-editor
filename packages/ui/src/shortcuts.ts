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
// WASD-vs-tools (mirrors Creators Hub Pro / Unity / Unreal): WASD only ever moves
// while NAVIGATING (the fly/orbit camera) or PLAYING (the avatar walks) — never
// while editing with the static camera. So bare-letter tool shortcuts (Q/W/E/R/F)
// fire only in the static edit camera (camMode 'none' + frozen); in every other
// state they reach the engine for movement. That's why `W` no longer both walks
// and toggles the translate gizmo — the avatar's WASD input is off while editing
// (see free-cam reconcileAvatarInput). ⌘/Ctrl combos and control keys (Esc,
// Delete, F5, `, ?) always work. Viewport-focused keystrokes reach this handler
// because the host forwards engine-window keys (embed.ts forwardEngineKeys).
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

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Tools',
    items: [
      { combo: 'Q', label: 'Select tool', match: plain('q'), run: () => uiSetTool('select') },
      { combo: 'W', label: 'Move (translate)', match: plain('w'), run: () => uiSetTool('translate') },
      { combo: 'E', label: 'Rotate', match: plain('e'), run: () => uiSetTool('rotate') },
      { combo: 'R', label: 'Scale', match: plain('r'), run: () => uiSetTool('scale') }
    ]
  },
  {
    title: 'Edit',
    items: [
      { combo: `${mod} Z`, label: 'Undo' },
      { combo: `${mod} ⇧ Z`, label: 'Redo' },
      { combo: `${mod} D`, label: 'Duplicate' },
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
        combo: 'F',
        label: 'Focus selection',
        match: plain('f'),
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

// Keys this module owns that the engine should forward from the viewport iframe
// (see embed.ts). Letters are forwarded too but suppressed while the fly camera
// is active, so movement still works.
export const SHORTCUT_KEYS = new Set(['q', 'w', 'e', 'r', 'f', 'F5', '`', '?', 'Delete', 'Backspace', 'Escape'])

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
      // Bare-letter TOOL shortcuts (Q/W/E/R) belong to EDITING only. Whenever WASD
      // is movement instead — any navigation camera (fly/orbit), or while the scene
      // is playing (the avatar walks) — let the letters reach the engine. They fire
      // only in the static edit camera (camMode 'none' + frozen), which is exactly
      // when the avatar's WASD input is disabled (see free-cam reconcileAvatarInput),
      // so W never both moves and switches the gizmo. F (focus) is EXEMPT — it's a
      // discrete framing action, not movement, so it always fires (fly up/down moved
      // off E/F to Space/Shift so there's no clash). ⌘/Ctrl combos pass through.
      const key = e.key.toLowerCase()
      const letter = /^[a-z]$/.test(key)
      const editingStatic = state.camMode === 'none' && state.frozen
      if (!editingStatic && letter && key !== 'f' && !e.metaKey && !e.ctrlKey) return
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
