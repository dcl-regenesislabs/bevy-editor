# Contributing to the Decentraland Scene Editor

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first — it explains the four layers
and the rules. This file is the practical how-to.

## Layout (engine is an external sibling)

```
…/Decentraland/
  ├─ bevy-explorer/    engine (Rust/WebGPU). NOT ours — editor code ships in the single build but stays inert.
  └─ dcl-editor/       this monorepo
       packages/{contract,scene,ui,desktop}
```

## Build & run

```bash
# 1. Engine wasm (single build — serves both normal play and the editor), in the external checkout:
cd bevy-explorer
wasm-pack build --target web --out-dir ./deploy/web/pkg \
  --no-default-features --features "livekit,social"

# 2. The whole editor, from the monorepo root:
cd dcl-editor
npm install
npm run build      # scene → ui (packages/ui/dist) → desktop; served same-origin with the engine
npm start          # build + launch the desktop app

# Inner loops:
npm run dev        # HMR: edit a panel/style -> hot-swaps in place (see README)
npm run build:ui   # one-off rebuild of just the UI bundles (reload the editor after)
```

There is no separate editor build: the same `deploy/web` serves normal play and
the editor. The editor code ships in this one build but is dormant at runtime
(console commands do nothing until invoked; the gizmo/marker overlay + DoF-disable
systems are gated `run_if(any_with_component::<SuperUserScene>)`, so they never run
in normal play).

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
Always verify the engine still compiles after touching `bevy-explorer`:
```bash
cargo check --target wasm32-unknown-unknown --no-default-features --features "livekit,social"
```

## The golden rule for engine changes

The engine is shared with production and **we don't own it**. There is a **single
engine build**; editor code ships in it but must stay **inert in normal play**.
Any change to `bevy-explorer` must be one of:

1. A **genuine bug fix** that is correct regardless of the editor (document it as
   such in the commit; it can be upstreamed independently), **or**
2. **Editor-only and added inert** — present in the single build but doing nothing
   until the editor engages it. Production runtime is provably unchanged because
   the code never runs (rob/upstream's pattern).

To add a new editor-only engine primitive:
- Prefer the `scene_inspector` crate (console commands, CRDT ops): a command is
  registered but does nothing until invoked, so it's inert by construction.
- For a render/per-frame system in a shared crate (e.g. `scene_runner`), add it
  **unconditionally** but gate it at runtime with
  `.run_if(any_with_component::<SuperUserScene>)` — a `SuperUserScene` is only
  inserted when a scene loads super-user (i.e. by the editor), so it never runs in
  normal play and costs nothing per frame. Follow the existing gizmo-overlay +
  DoF-disable systems.

## How to add a feature (host UI + scene)

### A new inspector component editor
Most components need **no code** — the engine's `/component_schema` drives
`SchemaEditor` automatically. Otherwise:
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
