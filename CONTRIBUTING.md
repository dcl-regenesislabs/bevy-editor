# Contributing to the Decentraland Scene Editor

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first — it explains the four layers
and the rules. This file is the practical how-to.

## Layout (engine is an external sibling)

```
…/Decentraland/
  ├─ bevy-explorer/    engine (Rust/WebGPU). NOT ours — edit only behind the `editor` feature.
  └─ dcl-editor/       this monorepo
       packages/{contract,scene,ui,desktop}
```

## Build & run

```bash
# 1. Engine wasm (EDITOR build — note the `editor` feature), in the external checkout:
cd bevy-explorer
wasm-pack build --target web --out-dir ./deploy/web/pkg \
  --no-default-features --features "livekit,social,editor"

# 2. The whole editor, from the monorepo root:
cd dcl-editor
npm install
npm run build      # scene → ui → desktop (writes the UI bundles into bevy-explorer/deploy/web)
npm start          # build + launch the desktop app

# Inner loops:
npm run build:ui   # just the UI bundles (reload the running editor after)
npm run watch -w @dcl-editor/ui   # rebuild UI on change
```

Production engine build (NO editor code) — what ships to normal users:
```bash
wasm-pack build --target web --out-dir ./deploy/web/pkg \
  --no-default-features --features "livekit,social"   # <- no `editor`
```

## Test / validate

The desktop app has a CDP-driven E2E harness (macOS/Linux):
```bash
cd packages/desktop
node validate/validate.mjs                 # full boot→engine→scene→select→…
node validate/gizmo-test.mjs               # gizmo-on-top across camera angles
node validate/recovery-test.mjs            # corrupt-IndexedDB auto-recovery
```
Always verify the engine compiles **both** ways after touching `bevy-explorer`:
```bash
cargo check --target wasm32-unknown-unknown --no-default-features --features "livekit,social"          # prod
cargo check --target wasm32-unknown-unknown --no-default-features --features "livekit,social,editor"   # editor
```

## The golden rule for engine changes

The engine is shared with production and **we don't own it**. Any change to
`bevy-explorer` must be one of:

1. A **genuine bug fix** that is correct regardless of the editor (document it as
   such in the commit; it can be upstreamed independently), **or**
2. **Editor-only**, gated behind `#[cfg(feature = "editor")]` and proven inert
   when the feature is off.

Never gate editor behaviour on the `SuperUserScene` marker alone — the production
system UI is also a super-user scene. Use the cargo feature.

To add a new editor-only engine primitive:
- Put it in the `scene_inspector` crate (console commands, CRDT ops) when possible
  — the whole crate is already feature-gated.
- If it must live in a shared crate (e.g. a render system in `scene_runner`),
  add `#[cfg(feature = "editor")]` to both the system fn and its `add_systems`
  registration, and add `editor = []` to that crate's `[features]`, wired up from
  the root `editor` feature (`bevy-explorer/Cargo.toml`).

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
1. Add the literal to `EditorTool` (`src/bridge-protocol.ts`) and bump
   `SCENE_BRIDGE_VERSION`.
2. Add a `TOOLS` entry (`packages/ui/src/panels/Toolbar.tsx`).
3. Add the handles + drag logic in `src/gizmo.ts` (`HandleKind`, `hoverId`,
   `handleColors`, construction, `updateDrag`).

### A new bus message
1. Add it to `PageToSceneMessage` or `SceneToPageMessage`
   (`src/bridge-protocol.ts`); bump `SCENE_BRIDGE_VERSION`.
2. Handle it scene-side in `page-ui.ts` `handle()` (page→scene) or send it via
   `send()` and handle it in `packages/ui/src/boot.ts` `handleSceneMessage` (scene→page).
3. Send it with `sendToScene({ type: … })` from the host UI.

### A new desktop (Electron) capability
1. Add an `ipcMain.handle('my-thing', …)` in `packages/desktop/src/main.ts`.
2. Expose it on `window.editorShell` in `src/preload.ts`.
3. Declare it on the `EditorShell` interface in
   `packages/ui/src/main-embed.tsx` and call it from the renderer.
   (Keep the preload surface and that interface in sync — they are the IPC
   contract.)

## Conventions

- Commits: imperative mood, focus on **why**; one logical change per commit; no
  AI-attribution trailers.
- TypeScript: no `as any` (use `unknown` + narrow); static imports only
  (`React.lazy` excepted); comments explain non-obvious *why*, not *what*.
- After a change that affects behaviour/config/structure, update
  `ARCHITECTURE.md` / this file / `README.md` as needed.
