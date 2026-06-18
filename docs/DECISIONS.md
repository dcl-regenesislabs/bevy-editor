# Decisions & learnings

A distilled record of the architecture decisions, non-obvious gotchas, and open
items for the dcl-editor monorepo — the "why", not just the "what". Pairs with
[`../README.md`](../README.md) (overview), [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
(layers), [`../AGENTS.md`](../AGENTS.md) (the dev/validate loop), and
[`../MIGRATION.md`](../MIGRATION.md) (how we got here).

> Status: the monorepo cutover is complete and is the **source of truth**. The
> original repos `../editor-scene` and `../bevy-editor-app` are **legacy** (kept
> for git history only). The engine `../bevy-explorer` is **external**.

---

## Architecture

- **Three running pieces, two seams.** The editor is *a privileged SDK7 scene
  editing other scenes*, with a React DOM UI bolted on. The engine
  (`bevy-explorer`) renders; `packages/scene` is the in-engine agent (gizmos,
  picking, overlays, CRDT bridge); `packages/ui` is the React DOM panels. They
  talk over two seams, both typed in `@dcl-editor/contract`:
  1. **Editor bus** — JSON messages between UI and scene via the engine's
     `/editor_send` + `/editor_poll` console commands.
  2. **Host IPC shell** — `window.editorShell` (Electron main ↔ renderer).

- **`@dcl-editor/contract` is the single source of truth for both seams**, used by
  scene + ui + desktop. The scene's `bridge-protocol.ts` is just
  `export * from '@dcl-editor/contract'`. (We initially duplicated it in the scene
  fearing `sdk-commands` couldn't bundle a workspace import — **tested false**:
  contract is pure types, it bundles fine. No duplication.)

- **The scene is the agent, not a UI host.** The old in-scene SDK7 panel UI
  (`ui.tsx`, ~2500 lines) is gone — the DOM host UI (`packages/ui`) is the only
  panel UI in *both* electron and electron-less/browser modes. The scene's
  `ReactEcsRenderer` now renders only the viewport layers it must own because they
  need engine camera projection: the parent/child **relations overlay** and the
  **select-tool drag-box** (`viewport/overlay.tsx`). Everything else is DOM React.

- **Engine stays external; editor code ships inert in the single build.** There is
  one engine build; the editor-only engine code (super-user raycast, gizmo overlay,
  the `/editor_*` bus commands, DoF-disable) ships in it but is dormant in normal
  play — console commands no-op until invoked, and the per-frame overlay/DoF systems
  are gated `run_if(SuperUserScene)`. Production runtime is unchanged (rob's pattern).

- **Picking is engine-input-driven, NOT bus-driven.** A DOM "tap" on the viewport
  never reaches the host page (it's an iframe in electron), so picking is done
  scene-side from the engine's own pointer input: `overlay.tsx`'s box-select for
  the select tool, `viewport/click-select.ts`'s `startGizmoPick` for gizmo modes.
  There is no `pointer-tap` bus message (we removed it). `pointer-up` IS still a
  bus message — it forwards a release that lands on a DOM panel mid gizmo-drag.

- **Edit vs play save model (Unity-style).** Edits while the scene is *paused*
  (`state.frozen`, the default) autosave to `main.composite`; edits while *playing*
  are runtime-only and revert on Stop (the scene reloads fresh). `autosave.ts`
  gates on `frozen`; `uiPlay` flushes pending saves before unfreezing. A play-mode
  tint + a first-edit warning make it non-surprising.

- **Reactivity is a hand-rolled store, on purpose.** `state` is wrapped in a tiny
  auto-notifying `Proxy` (`reactive()`, ~30 lines in `scene/src/reactive.ts`) and
  components read slices via `useStore(() => state.x)` — fine-grained re-renders,
  no manual signal. This replaced the old `bump()` + `setInterval` "version
  counter" (easy to forget a bump; the 500 ms tick hid the misses). **We tried
  valtio first and it can't be used here:** `state.ts` is bundled into the SDK7
  scene, whose V8 sandbox has no browser globals — valtio's `proxy` core works,
  but `proxySet`/`proxyMap` (from `valtio/utils`) crash the scene at init
  (`reading 'bind' of undefined`; the utils barrel assumes `window`/`process.env`),
  so the scene never reaches `scene-ready` and boot hangs. Plain `proxy()` → e2e
  10/10; add the collection utils → boot timeout. Since the codebase reads state
  through helpers (which valtio's `useSnapshot` auto-tracking can't follow), we
  only needed `proxy` + `subscribe` + selectors anyway — ~30 lines we own, with no
  way to drag a browser-only dep into the scene. **Gotcha that falls out of this:**
  the proxy is shallow, so Sets/Maps and nested snapshot writes go through
  replace-on-write helpers in `state.ts` (`setSelected`, `setFieldEdit`,
  `setSnapshotComponent`, …); an in-place `state.selected.add(x)` won't re-render.
  Full rules: [`STATE-ARCHITECTURE.md`](./STATE-ARCHITECTURE.md).

---

## Build & dev

- **Monorepo build pipeline:** `npm run build` = scene (`sdk-commands` →
  `bin/index.js`) → ui (Vite → `packages/ui/dist`) → desktop (esbuild →
  `dist/main.cjs`). `npm run validate` = typecheck-all + unit tests (vitest) +
  build (the deterministic gate; run after every change). `npm run validate:e2e`
  = the CDP harness.

- **UI builds into `packages/ui/dist`, NOT into the engine checkout.** The desktop
  web server serves the UI dir **and** the engine's `deploy/web` under **one
  origin** (engine in an iframe). Same-origin is mandatory — the host page reaches
  into `iframe.contentWindow` for the console-RPC. (`servers.ts` `isUiAsset` routes
  `/editor-app.html` + `/assets/*` to the UI dir, everything else to the engine.)

- **Vite for the UI, with HMR dev mode.** `npm run dev` runs ONE node server
  (`scripts/dev.mjs`) = Vite middleware (React Fast Refresh) + static engine assets
  on the web port; the Electron app then **reuses that server** (port busy → its
  own `serveBevyWeb` no-ops). So **Vite never enters the production app** and the
  Electron main stays clean. Component/style edits hot-swap; logic-module edits
  full-reload.

- **Scene edits can't hot-swap** (scene code runs in the engine sandbox, not the
  page). `dev.mjs` watches `packages/scene/bin/index.js`; on rebuild it pushes a
  custom HMR event and the page reloads **only the editor scene in place** via the
  engine's `/reload <hash>` (found via `liveSceneInfo().isSuper`) — no engine
  reboot, no "Connecting" overlay. Falls back to a full page reload if the scene
  doesn't re-announce in 4s. (`packages/ui/src/dev-hmr.ts`.)

- **The scene-runtime module redirect (important!).** The scene imports engine-only
  modules (`./bevy-api`, `./utils`, `./login`, `./current-scene`, `~system/*`).
  When the UI bundles the scene for the browser, a Vite/esbuild plugin redirects
  those to browser replacements (`src/*-web.ts`) and stubs `~system/*`
  (`src/system-stub.ts`, which exports the SDK's named `~system` symbols as
  no-ops). The redirect matches relative imports from files **under the scene src**
  — it survives one-level subfolders (`../bevy-api` → strips one `../` → matches).
  If you add a scene-runtime module with a web replacement, register it in the
  redirect map (`packages/ui/vite.config.ts`).

- **Type-safe console commands.** `packages/scene/src/commands.ts` `makeCommands(raw)`
  is a transport-agnostic factory: one typed method per command (typed args, parsed
  typed returns). Two bound singletons: `scene/cmd.ts` (BevyApi) and `ui/cmd.ts`
  (engine console). Call `cmd.crdtSnapshot()`, `cmd.highlight(ids)`, etc. — never
  raw `consoleCommand('…')`. (`componentSchema`/`componentDefault` return raw JSON
  strings the schema decoder parses; everything else is fully typed.)

---

## Operational gotchas

- **Electron binary install** ("Electron failed to install correctly…"): Electron
  downloads a ~230 MB binary in a postinstall step; if blocked, you get a stub with
  no `node_modules/electron/path.txt`. Fix: with network, `rm -rf
  node_modules/electron && npm install`; or copy a working same-version
  `node_modules/electron/{dist,path.txt}`.

- **IndexedDB boot wedge:** a corrupt IndexedDB makes the engine hang at
  "logging-in" forever (it never registers its console command). The renderer has a
  40s watchdog that asks the main process to clear storage and reloads. The e2e
  harness clears it pre-launch.

- **EPIPE crash:** the desktop main `log()` writes to stdout; when a harness/parent
  closes the pipe, an unguarded write throws `EPIPE` and crashes the process —
  `main.ts` now guards stdout/stderr + wraps `console.log` in try/catch.

- **Cmd+R reload froze on "Starting…":** `servers-ready` is a one-shot push from
  `openProject`, not re-fired on reload. Fixed with a pull: the renderer calls
  `requestReady()` on mount (in `EditorShell`); the main process returns the cached
  ready payload.

- **Camera "flew up" dragging after import:** import auto-focused into orbit (target)
  mode, and dragging the gizmo moved the entity → the orbit camera chased it → a
  feedback loop. Fixed: import frames *once in free mode* (`focus` message gained
  `orbit?: boolean`); orbit also freezes while a gizmo drag is live.

- **Gizmo ungrabbable up close:** the gizmo is constant-screen-size, so its colliders
  shrank in world space as you approached, below the physics collider margin. Fixed
  by flooring `GIZMO_MIN_SCALE` (0.05 → 0.15) + fattening `HANDLE_RADIUS`.

- **crossOriginIsolation:** the engine uses wasm threads/SharedArrayBuffer → the
  host page AND the engine doc need `COOP: same-origin` + `COEP: require-corp`. The
  desktop server (and the Vite dev server) set these on everything.

---

## Open items / deliberately-not-done

- **`npm run start-editor`** (the lightweight browser/CLI launcher) is not built.
  The UI already supports a direct-attach route (`editor-app.html?realm=…` mounts
  `<Editor>` against terminal-run servers, no Electron). The launcher = a headless
  front-end on the extracted server stack (spawn scene `--data-layer` + editor
  scene + serve UI/engine same-origin + open a tab). The hard part is distributing
  the engine wasm to arbitrary scenes.

- **`overlay.tsx` elimination:** the scene could render *zero* SDK7 UI if the
  relations-links overlay is dropped (or redone as DOM SVG) and the drag-box visual
  moves to DOM. Currently kept because the links overlay is an engine render-texture
  (DOM can't display it) and the box-select needs engine projection.

- **Minor remaining dup:** the scene's `bevy-api/interface.ts` `LiveSceneInfo` (uses
  `@dcl/sdk` `Vector2`) vs contract's `LiveSceneInfo` (uses dependency-free
  `ParcelCoord`). Structurally identical; left separate so `contract` doesn't pull
  in `@dcl/sdk`.

- **Subfolder reorg is partial:** `camera/` + `viewport/` are grouped; the
  data/save/bridge files stay at root (several are the host-UI-shared API or
  bundler redirect targets, so moving them is cross-cutting churn).

- **e2e harness is flaky:** `validate:e2e` needs a real GPU + a test scene
  (`BEVY_EDITOR_PROJECT`) and is timing-sensitive. Treat green as strong evidence,
  red as "investigate". The `validate` gate (typecheck + unit tests + build) is the hard
  requirement.

---

## Verbatim transcript

The full session transcripts (raw JSONL, ~67 MB) are archived under
`docs/transcripts/` (gitignored — too large/noisy to commit). They're the complete
record if this distilled log ever misses something.
