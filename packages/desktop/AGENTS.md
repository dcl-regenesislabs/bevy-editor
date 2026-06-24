# Agent guide — bevy-editor-app

Desktop shell for the Decentraland bevy in-world editor. React + TypeScript
end to end. **No editor logic lives here** — read "Architecture" before adding
features, most belong in `../editor-scene`.

## Architecture

The engine is **stock, unmodified upstream bevy-explorer** — no fork, no engine
patches. Everything editor-specific is done scene-side with upstream-only APIs.

```
electron main (src/main.ts)            ← project picker, spawns local stack,
  serves the bevy-explorer web build on :3010 (COOP/COEP)
        │ loads
http://localhost:3010/editor-app.html  ← the renderer. Built from
  ../editor-scene/web-ui/src/main-embed.tsx — SAME React panels as the
  in-world editor (Toolbar/HierarchyPanel/InspectorPanel/...)
        │ embeds (same origin)
<iframe src="/?realm=…&systemScene=…&embed=true">   ← the bevy engine (wasm)
```

- **RPC seam**: `editor-scene/web-ui/src/console.ts` — `consoleCommand(cmd, args)`
  resolves to `iframe.contentWindow.engine_console_command_args` (host mode) or
  `window.engine_console_command_args` (in-page mode). The page↔scene message
  bus is a same-origin **`BroadcastChannel`**
  (`packages/scene/src/editor-channel.ts`; page side `packages/ui/src/bus.ts`,
  scene side `packages/scene/src/page-ui.ts`); message types live in
  `editor-scene/src/bridge-protocol.ts`. That contract is the whole interface —
  anything speaking it gets the full editor.
- **Click-to-select** is the SDK `Raycast` API on an editor-only pick layer
  (`CL_RESERVED6 = 128`, engine-only write, stripped on ingest); gizmos render
  on-top and crisp via a `TextureCamera`/`CameraLayer` composite. All
  upstream-only — no engine changes.
- **Input**: the iframe swallows viewport events, so the engine page (in
  `?embed` mode) forwards pointer/wheel/undo-keys to the parent, which
  re-dispatches them (`editor-scene/web-ui/src/embed.ts`) so the editor's
  normal DOM listeners work unchanged.
- **Where code goes**: panels, state, gizmos, scene logic → `editor-scene`
  (`web-ui/` for UI, `src/` for in-engine scene code). Stack management, native
  dialogs, packaging → this repo.

## Build & run

```
npm install
npm run build        # main+preload (esbuild) and the renderer bundle (build:ui)
npm start            # build + launch
npm run typecheck
```

`npm run build:ui` runs `../editor-scene/web-ui/build.mjs`, which emits BOTH
`editor-ui.js` (in-page editor) and `editor-app.js` + `editor-app.html` (this
app's renderer) into the bevy web dir. The engine itself ships as the
`@dcl-regenesislabs/bevy-explorer-web` npm package (the tarball bundles the
wasm), so there is **no engine compile step** — `npm install` yields a runnable
engine. The engine is plain upstream bevy-explorer; there are no editor-specific
engine changes to rebuild. To run against a local engine build, set
`BEVY_WEB_DIR` to its `deploy/web` dir.

## Validate (the agent loop)

After every change:

```
npm run typecheck && npm run validate
```

`validate/validate.mjs` launches the real app with CDP on :9433 and walks the
steps `boot → picker → engine → scene → select`, printing PASS/FAIL per step
and exiting non-zero on failure. Artifacts (screenshots at each stage,
`console.log`, `results.json`) land in `validate/artifacts/` — **read the
screenshots**, they are the ground truth for UI work. Subset runs:
`node validate/validate.mjs --steps=boot,picker`.

Environment knobs:

- `BEVY_EDITOR_PROJECT=<scene dir>` — project to auto-open (default
  `../towerofmadness`)
- `BEVY_EDITOR_DEBUG=1` — window visible-on-all-workspaces + always-on-top
  (REQUIRED for headless validation: Chromium suspends rAF — the engine's
  clock — for windows on hidden macOS Spaces). validate sets it automatically.
- The app reuses ports already serving (`/about` probe), so a dev's terminal
  stack on 8004/8005/3010 is picked up instead of respawned.

For ad-hoc driving beyond the harness, launch with
`npx electron . --remote-debugging-port=9433` and attach any CDP client; the
host page exposes `window.__eui` (editor state) and `window.__euiCmd`
(consoleCommand) for assertions.

## Known issues / gotchas

- WebGPU viewport renders black on older Electron (e.g. 33) when the engine
  page is loaded DIRECTLY in the window; the iframe host path is the supported
  one. The app runs on Electron 42 (Chromium 148). If the iframe also renders
  black on some Electron version, bump `electron` — newer Chromium fixes WebGPU
  presentation.
- Electron's postinstall sometimes half-extracts on this machine: if
  `npx electron` fails with "Electron failed to install correctly",
  `rm -rf node_modules/electron/dist` and unzip
  `~/Library/Caches/electron/<sha>/electron-v*-darwin-arm64.zip` into `dist/`,
  then write `path.txt` containing `Electron.app/Contents/MacOS/Electron`
  (no trailing newline).
