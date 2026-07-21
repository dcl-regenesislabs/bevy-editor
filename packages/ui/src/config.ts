// Operational timings for the editor UI, centralized so they're discoverable and
// tunable in one place (the audit flagged these as scattered magic numbers tied
// to flakiness on slow machines/networks). These are *coupling/latency* knobs —
// not UI feel — so they live here rather than inline at each call site.
//
// Note: per-frame "feel" constants (camera fly speed, mouse sensitivity, gizmo
// scale) deliberately stay in the scene modules that own them.

// RPC over the editor bus: how long sceneRpc waits for the scene's reply before
// rejecting. Generous because a busy engine frame can delay the poll.
export const RPC_TIMEOUT_MS = 10_000

// After registering imported content, the dev server may briefly 404 the file
// before serving it; we HEAD-poll until it's available. attempts × interval is
// the max wait before giving up (and surfacing an import error).
export const CONTENT_POLL_ATTEMPTS = 40
export const CONTENT_POLL_INTERVAL_MS = 250

// After a scene restart, wait for the editor scene to re-announce (re-pin) over
// the bus before resuming.
export const RESTART_PIN_ATTEMPTS = 20
export const RESTART_PIN_INTERVAL_MS = 500

// On attach we auto-pause (freeze) the scene; retry until the freeze takes.
export const AUTOPAUSE_ATTEMPTS = 12
export const AUTOPAUSE_INTERVAL_MS = 300

// Engine boot watchdog: a corrupt IndexedDB can wedge the engine at "logging-in"
// forever. If it isn't ready within this window, ask the shell to clear storage
// and reload. Raise it on slow machines where first-load wasm compile is slow.
export const ENGINE_BOOT_WATCHDOG_MS = 40_000

// Last-resort fallback: the editor scene retries resolve+snapshot for ~90s
// (SCENE_BOOT_TIMEOUT_MS in packages/scene/src/inspector.ts) before giving up. If
// it still never reaches ready past that, stop blocking the whole viewport with
// the loading overlay and reveal the live engine view with a notice — the scene
// is rendering, only the entity tools are unavailable. Must sit past the boot
// retry window so it doesn't flash while a slow scene is still resolving.
export const INSPECTOR_STALL_MS = 100_000
