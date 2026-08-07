// Editor shortcuts, intercepted before ANY frame sees them.
//
// The engine runs in an iframe and takes focus as soon as you click the
// viewport, so a renderer-side listener only sees these keys when the host
// happens to hold focus — which is why the tool chords appeared to need the
// toolbar clicked first. before-input-event fires on the window's webContents
// for every keystroke regardless of which frame is focused, so this is the one
// place that can reliably claim them. Alt is bound to nothing in the engine, so
// swallowing these takes nothing away from it.
import { type BrowserWindow } from 'electron'
import { EDITOR_CHORD_CHANNEL, type EditorChord } from '@dcl-editor/contract'

const CHORD_TOOLS: Record<string, string> = {
  KeyQ: 'select',
  KeyW: 'translate',
  KeyE: 'rotate',
  KeyR: 'scale'
}

// Undo/redo/duplicate ride the same interception. They can't be left to the
// renderer for the same focus reason, and Electron's stock Edit menu binds ⌘Z to
// the native text Undo, which swallowed the key before the page ever saw it —
// which is why undo did nothing. buildMenu() drops that menu, so this sees it.
const CHORD_HISTORY: Record<string, EditorChord> = {
  KeyZ: { action: 'undo' },
  KeyD: { action: 'duplicate' }
}

export function installEditorChords(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt) return
    // the platform's primary modifier: ⌘ on macOS, Ctrl elsewhere
    const primary = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
    if (!primary) return
    // input.code is the PHYSICAL key — input.key is unreliable under modifiers
    const tool = CHORD_TOOLS[input.code]
    if (tool !== undefined) {
      event.preventDefault()
      win.webContents.send(EDITOR_CHORD_CHANNEL, { action: 'tool', tool })
      return
    }
    if (input.code === 'KeyF') {
      event.preventDefault()
      win.webContents.send(EDITOR_CHORD_CHANNEL, { action: 'focus' })
      return
    }
    // Mute and play/pause are reached mid-playtest, with the viewport focused —
    // exactly the case a renderer listener misses, so they come through here too.
    // Bare chord only: ⌘⇧P is command-palette muscle memory in the Studio, and
    // swallowing shifted variants here would retire them for every surface.
    const direct =
      input.shift ? null : input.code === 'KeyM' ? 'mute' : input.code === 'KeyP' ? 'playpause' : null
    if (direct !== null) {
      event.preventDefault()
      win.webContents.send(EDITOR_CHORD_CHANNEL, { action: direct })
      return
    }
    const history = CHORD_HISTORY[input.code]
    if (history === undefined) return
    event.preventDefault()
    const chord: EditorChord = input.shift && input.code === 'KeyZ' ? { action: 'redo' } : history
    win.webContents.send(EDITOR_CHORD_CHANNEL, chord)
  })
}
