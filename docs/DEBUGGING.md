# Debugging

How to see what the editor is doing and diagnose the common failures. The editor
spans three processes (engine, scene, page) plus the Electron shell, so most
debugging is about *which seam* is misbehaving.

---

## Quick toggles

| Tool | How | What you get |
|---|---|---|
| **Bus + scene tracing** | open with `?editorDebug` in the URL | every editor-bus message logged to the page console (timestamped, `page→scene` / `scene→page`), **and** the scene's own debug logs (per-frame picking, highlight, bus poll) |
| **Live state** | `window.__eui` in the page console | the shared editor `state` object (selection, snapshot, tool, frozen, …) — read it live |
| **Direct engine command** | `window.__euiCmd('<cmd>', [args])` | run any engine console command from the page console and see the raw reply |
| **Build id** | `window.__editorAppBuild` | which UI bundle is loaded (sanity-check you're not on a stale cache) |
| **Logs drawer** (desktop) | the Logs panel in the app | two streams: the scene **dev-server / build output** (stack-log) and the **engine scene console** (`cmd.sceneLogs`) |

## The namespaced loggers

Both the scene and the UI log through a small namespaced logger
(`packages/scene/src/log.ts`, `packages/ui/src/log.ts`) instead of swallowing
errors:

- `log.error` / `log.warn` — always printed, prefixed `[editor-scene]` /
  `[editor-ui]`. A failed gizmo write, a failed schema fetch, etc. surface here
  instead of vanishing.
- `log.debug` — opt-in. UI: only with `?editorDebug`. Scene: only when opened
  with `?editorDebug` (wired through `setSceneDebug`). Use it for high-frequency
  call sites you don't want in normal runs.

**Prefer logging a failure over an empty `.catch(() => {})`.** A logged error is
debuggable; a silent one looks like success.

---

## The three seams, and how to tell which is broken

```
 page (DOM, React)  ──console-RPC──▶  engine  ◀──editor bus──  scene (in engine)
        │                              ▲
        └────────── Electron IPC (window.editorShell) ──────────┘  (desktop only)
```

1. **Console-RPC (page ↔ engine).** The page calls
   `window.engine_console_command_args(cmd, args)` (in the iframe's
   contentWindow). If `window.__euiCmd('scene_stats')` returns nothing or throws
   "engine console API not available", the engine isn't ready or the iframe isn't
   same-origin. Check the engine booted (viewport renders) and COOP/COEP headers
   are present.
2. **Editor bus (page ↔ scene).** JSON over `/editor_send` + `/editor_poll`. Turn
   on `?editorDebug` and watch the message trace. If `page→scene` messages send
   but you never see `scene→page` replies (e.g. no `scene-ready`), the editor
   scene isn't running or didn't pin — check the Logs drawer scene console.
3. **Electron IPC (page ↔ main).** `window.editorShell.*`. If project open /
   servers-ready never fires, check the main-process stdout (the `[stack]` lines)
   or the Logs drawer server stream.

---

## Common failures

| Symptom | Likely cause | What to check / do |
|---|---|---|
| **Asset catalog shows "0 models"** | the `/opendcl` CORS proxy isn't serving on the port you're on | hit `http://localhost:<port>/opendcl/ping` — should be `ok`. In dev, this lives in `scripts/dev.mjs`; in the packaged app, in `servers.ts`. Direct CDN fetches are CORS-blocked by design. |
| **Stuck at "logging-in" forever** | corrupt engine IndexedDB, or the engine web build is missing/lacks `--features editor` | the boot watchdog (`ENGINE_BOOT_WATCHDOG_MS`, 40s) auto-clears storage once and reloads. If it persists, confirm `bevy-explorer/deploy/web/pkg/` exists and was built with the editor feature. |
| **Save button disabled / autosave off** | the scene's data-layer isn't reachable | autosave needs the scene dev-server running with `--data-layer` and a local scene. Check `dataLayerAvailable()` and the server log. |
| **Edits don't persist after Stop** | you edited while the scene was *playing* | by design — play-mode edits are runtime-only and revert on Stop. Pause (freeze) to make authored edits. |
| **Gizmo drag looks like it works but nothing moves** | the world origin (entity 5) is missing, or the write failed | with `?editorDebug`, watch for `[editor-scene] WARN gizmo transform write failed`. World math needs entity 5. |
| **Stale UI after a change** | old cached bundle, or a missed re-render | check `window.__editorAppBuild`; the `SCENE_BRIDGE_VERSION` mismatch warning in the console flags a stale cached *scene* bundle. |
| **RPC times out** | the scene didn't reply within `RPC_TIMEOUT_MS` (10s) | the scene is wedged or not pinned — check the scene console in the Logs drawer. |
| **Cmd+R "Starting…" hang** | (fixed) the renderer pulls the cached ready payload via `requestReady()` on remount | if it recurs, check the `request-ready` IPC handler. |

## Tuning the timing knobs

Operational timings (RPC timeout, content-poll retries, restart/autopause
attempts, boot watchdog) are centralized in **`packages/ui/src/config.ts`** —
raise them when debugging on a slow machine or network. Scene-side timing/feel
constants live in their owning modules (`inspector.ts` `SETTLE_MS`,
`page-ui.ts` poll interval, `camera/free-cam.ts` fly/orbit constants).

## Browser-extension / CDP

For scripted inspection you can attach the Chrome extension or drive the desktop
app over CDP (`BEVY_EDITOR_DEBUG=1` keeps the window composited so the frame
clock doesn't suspend). The e2e harness uses exactly this — see
[`AI-AGENT.md`](./AI-AGENT.md).
