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
// or the viewport hold focus. We do NOT preventDefault on the engine, so the
// engine still receives the key — WASD/QE keep driving the fly camera, and
// shortcuts.ts suppresses the tool letters while flying so they don't double up.

// Keys the host treats as editor shortcuts (superset of shortcuts.ts + the
// history keys z/d for ⌘Z/⌘⇧Z/⌘D). Letters matched case-insensitively, named keys
// exactly. Forwarding only this set keeps movement keys (a, etc.) engine-only.
const FORWARDED_KEYS = new Set([
  'q', 'w', 'e', 'r', 'f', 'z', 'd', // z/d carry ⌘Z·⌘⇧Z·⌘D (history.ts)
  'Delete', 'Backspace', 'Escape', 'F5', '`', '?'
])
const isForwardedKey = (key: string): boolean =>
  FORWARDED_KEYS.has(key) || FORWARDED_KEYS.has(key.toLowerCase())

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
        if (!isForwardedKey(e.key)) return
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
