# Contributing to the Decentraland Scene Editor

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first — it explains the four layers
and the rules. This file is the practical how-to.

## Layout (engine is a prebuilt npm dependency)

```
…/Decentraland/
  └─ dcl-editor/       this monorepo
       packages/{contract,scene,ui,desktop}
       node_modules/@dcl-regenesislabs/bevy-explorer-web   ← stock upstream engine (prebuilt wasm)

  (../bevy-explorer/   optional: a local engine checkout, only for engine devs — see BEVY_WEB_DIR)
```

The engine is **stock, unmodified upstream `bevy-explorer`** — we do **not** fork
or patch it. It arrives as the `@dcl-regenesislabs/bevy-explorer-web` npm package
(the tarball includes the wasm), so `npm install` gives a runnable engine.

## Build & run

```bash
# From the monorepo root — no engine compile needed:
npm install        # also installs the prebuilt engine (@dcl-regenesislabs/bevy-explorer-web)
npm run build      # scene → ui (packages/ui/dist) → desktop; served same-origin with the engine
npm start          # build + launch the desktop app

# Inner loops:
npm run dev        # HMR: edit a panel/style -> hot-swaps in place (see README)
npm run build:ui   # one-off rebuild of just the UI bundles (reload the editor after)
```

There is **no engine build step** for editor work: the prebuilt npm package serves
both normal play and the editor, and all editor behaviour lives in the scene layer.
Engine resolution order: `BEVY_WEB_DIR` env → installed npm package →
`../bevy-explorer/deploy/web` sibling fallback. Bump the engine by changing the
package version in the root `package.json`.

> **Engine devs only:** if you're building bevy-explorer itself, you need the Rust
> toolchain + `wasm-pack`, then point the editor at your local build with
> `BEVY_WEB_DIR=/path/to/bevy-explorer/deploy/web`. This is not part of editor
> development.

## Test / validate

Two tiers (full guide in [`docs/TESTING.md`](./docs/TESTING.md)):
```bash
npm run validate          # the gate: typecheck + unit tests (vitest) + build. Fast, hermetic.
npm test                  # just the unit tests (pure scene logic)
npm run validate:e2e      # CDP-driven end-to-end harness (macOS/Linux, needs a GPU + test scene)
```
The e2e harness can run a subset of steps or target a specific scene:
```bash
cd packages/desktop
node validate/validate.mjs --steps=boot,picker,engine,scene
BEVY_EDITOR_PROJECT=/path/to/scene node validate/validate.mjs
```
You never need to compile the engine for editor work — it's a prebuilt npm
dependency. (Engine devs verifying a local engine build do so in their own
`bevy-explorer` checkout; that's outside this repo.)

## The golden rule: don't touch the engine

The engine is shared with production and **we don't own it**. The editor runs on
**stock, unmodified upstream `bevy-explorer`** (the `@dcl-regenesislabs/bevy-explorer-web`
npm package): **no fork, no engine PR, no editor-specific patches.**

So the rule is simple: **don't modify `bevy-explorer` for the editor.** Anything the
editor needs is built **scene-side** in `packages/scene` using upstream-only SDK7
APIs. The patterns the editor already uses (all on stock upstream):

- **Page↔scene bus** — a same-origin `BroadcastChannel`
  (`packages/scene/src/editor-channel.ts`).
- **Click-to-select** — an SDK `Raycast` on an editor-only collider layer
  (`CL_RESERVED6 = 128`), written engine-only and stripped from the logical
  snapshot on ingest (`viewport/click-select.ts` + `pick-layer.ts`).
- **Gizmo on-top + crisp** — a dedicated `TextureCamera` / `CameraLayer` composite
  (no depth-of-field) built in `gizmo.ts`, composited in `overlay.tsx`.
- **Asset import** — the upstream `/scene_content` mechanism.

If you ever hit something genuinely impossible via upstream APIs, the answer is to
upstream a **general** capability to bevy-explorer `main` (not an editor-specific
patch) — but exhaust the scene-side options first; this is almost never necessary.

## How to add a feature (host UI + scene)

### A new inspector component editor
Most components need **no code** — the component schema drives `SchemaEditor`
automatically. Otherwise:
- New leaf widget (e.g. a curve editor): add a case in `SchemaLeaf`
  (`packages/ui/src/panels/properties.tsx`).
- Dedicated editor for a custom component: add a branch in `ComponentCard`
  (`packages/ui/src/panels/InspectorPanel.tsx`) before the generic `ShapeEditor`
  fallback.
- Hide a read-only/result component: add it to `isResultComponent`
  (`InspectorPanel.tsx`).

### A new tool / gizmo mode
1. Add the literal to `EditorTool` in `packages/contract/src/bus-protocol.ts`
   (the source of truth — the scene re-exports it) and bump `SCENE_BRIDGE_VERSION`
   there.
2. Add a `TOOLS` entry (`packages/ui/src/panels/Toolbar.tsx`).
3. Add the handles + drag logic in `src/viewport/gizmo.ts` (`HandleKind`,
   `hoverId`, `handleColors`, construction, `updateDrag`).

### A new bus message
1. Add it to `PageToSceneMessage` or `SceneToPageMessage` in
   `packages/contract/src/bus-protocol.ts` (the scene re-exports it via
   `bridge-protocol.ts`); bump `SCENE_BRIDGE_VERSION`.
2. Handle it scene-side in `page-ui.ts` `handle()` (page→scene) or send it via
   `send()` and handle it in `packages/ui/src/boot.ts` `handleSceneMessage` (scene→page).
3. Send it with `sendToScene({ type: … })` from the host UI.

### A new desktop (Electron) capability
1. Add an `ipcMain.handle('my-thing', …)` in `packages/desktop/src/main.ts`.
2. Expose it on `window.editorShell` in `src/preload.ts`.
3. Declare it on the `EditorShell` interface in
   `packages/contract/src/shell.ts` (the single source of truth) and call it from
   the renderer. (Keep the preload implementation and that interface in sync —
   together they are the IPC contract.)

## Conventions

- Commits: imperative mood, focus on **why**; one logical change per commit; no
  AI-attribution trailers.
- TypeScript: no `as any` (use `unknown` + narrow); static imports only
  (`React.lazy` excepted); comments explain non-obvious *why*, not *what*.
- After a change that affects behaviour/config/structure, update
  `ARCHITECTURE.md` / this file / `README.md` as needed.
