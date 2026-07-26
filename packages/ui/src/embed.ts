// Engine-iframe input bridge (host side).
//
// The bevy engine runs in a SAME-ORIGIN iframe. When the viewport has focus its
// keydowns go to the ENGINE window, not ours — so the host's shortcut listener
// (shortcuts.ts) and history keys never see them. (winit/Bevy "intercepting" the
// keys is really just: the focused document is the iframe's, not the host's.)
//
// Because it's same-origin we don't need the engine page to cooperate (it's the
// external bevy build and doesn't load our code): the host attaches a
// capture-phase listener directly to the engine window and RE-DISPATCHES the
// editor shortcut keys onto the host window, so shortcuts work whether the panels
// or the viewport hold focus. We preventDefault only for ⌘/Ctrl combos and F5
// (to kill browser defaults like Add-Bookmark / reload); bare keys are left
// uncancelled so WASD/QE keep driving the fly camera, and shortcuts.ts suppresses
// the tool letters while flying so they don't double up.
import { SHORTCUT_KEYS } from './shortcuts'

// The engine reads a key's physical code and ignores modifiers, so Alt+W would
// walk the avatar forward as well as switching the gizmo tool. Our shortcuts are
// the only Alt combos in play, so an Alt-held tool key is ours alone: stop it
// before winit sees it. Bare letters are never taken — W walks, E and F interact,
// Q points, exactly as they do outside the editor.
const ALT_TOOL_CODES = new Set(['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyF'])

function swallowedByEditor(e: KeyboardEvent): boolean {
  return e.altKey && !e.metaKey && !e.ctrlKey && ALT_TOOL_CODES.has(e.code)
}

// Keys the host treats as editor shortcuts: shortcuts.ts's owned set (single
// source of truth) plus the history keys z/d (⌘Z·⌘⇧Z·⌘D, owned by history.ts).
// Letters matched case-insensitively, named keys exactly. Forwarding only this
// set keeps movement keys (a, etc.) engine-only.
const FORWARDED_KEYS = new Set([...SHORTCUT_KEYS, 'z', 'd'])
const isForwardedKey = (e: KeyboardEvent): boolean =>
  // Alt+letter yields an alternate character on many layouts (⌥E is "´" on a Mac),
  // so the physical code decides for our Alt combos; everything else goes by key.
  ALT_TOOL_CODES.has(e.code) ||
  FORWARDED_KEYS.has(e.key) ||
  FORWARDED_KEYS.has(e.key.toLowerCase())

// Attach to the engine iframe's window so its keystrokes reach the host's editor
// shortcuts. Idempotent per window (guarded), and safe to call again after the
// boot watchdog swaps in a fresh iframe.
const wired = new WeakSet<Window>()
export function forwardEngineKeys(engineWindow: Window): void {
  if (wired.has(engineWindow)) return
  wired.add(engineWindow)
  for (const type of ['keydown', 'keyup'] as const) {
    engineWindow.addEventListener(
      type,
      (e: KeyboardEvent) => {
        if (!isForwardedKey(e)) return
        // Cancel the BROWSER default for ⌘/Ctrl combos (⌘D=Add-Bookmark, ⌘Z) and
        // F5 (reload) — the re-dispatched host event can't cancel the real engine
        // event, so we must do it here. Bare movement keys (no modifier) are left
        // alone so WASD/QE keep driving the fly camera.
        if (e.metaKey || e.ctrlKey || e.key === 'F5') e.preventDefault()
        // Q is our Select-tool shortcut AND the engine's avatar "point at" gesture
        // (SystemAction::PointAt), so tool-switching made the avatar point. The
        // engine listens further down the tree, so stopping propagation here — in
        // the capture phase, on the iframe's window — keeps the key from reaching
        // it. Only while editing: with the fly camera on, Q must still reach winit
        // as a movement key. keyup matters too, since the gesture latches on down.
        if (swallowedByEditor(e)) {
          e.preventDefault()
          e.stopPropagation()
        }
        // Re-dispatch on the host window so shortcuts.ts / history keys fire as if
        // the host had focus. Not cancelled on the engine — it still gets the key.
        window.dispatchEvent(
          new KeyboardEvent(type, {
            key: e.key,
            code: e.code,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            altKey: e.altKey,
            bubbles: false,
            cancelable: true
          })
        )
      },
      { capture: true }
    )
  }
}
