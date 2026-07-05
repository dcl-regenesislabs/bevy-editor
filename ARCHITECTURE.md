# Decentraland Scene Editor — Architecture

This is the architecture reference for the Decentraland scene editor: an editor
that runs **both** in-world (in a browser, alongside a running explorer) **and**
as a standalone **Electron desktop app**, sharing one editor implementation. It is
intended as a replacement for the official Creator Hub editing flow, built on top
of the `bevy-explorer` engine.

> **North star:** all editor logic lives in the editor scene + host UI (which we
> own and can iterate on freely). The editor runs on **stock, unmodified upstream
> `bevy-explorer`** (its `main` branch / published web builds) — **no engine fork,
> no engine PR, no editor-specific engine patches**. Everything the editor needs is
> done **scene-side** with upstream-only SDK7 APIs. (Same approach as
> robtfm/editor-scene.)

---

## 1. The four layers

```
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Electron shell  (packages/desktop)                                  │
│    Desktop window, project picker, spawns scene dev-servers, serves   │
│    the bevy web build, IPC lifecycle. NON-terminal users.             │
│      └ renders ─┐                                                     │
├─────────────────┼─────────────────────────────────────────────────────┤
│ 3. Host UI  (packages/ui)   ◄── also runs in-world in-browser │
│    React + TS panels (Hierarchy, Inspector, Toolbar, gizmo overlay).  │
│    Talks to the editor scene over the editor bus (BroadcastChannel).  │
│      └ editor bus (BroadcastChannel) ─┐                               │
├────────────────────────────────────────┼──────────────────────────────┤
│ 2. Editor scene  (packages/scene/src)   ▼  SDK7 scene, super-user       │
│    Runs INSIDE the engine as a system scene. Selection, gizmos, the   │
│    CRDT data layer, import, undo/redo, autosave, world overlays.      │
│    All editor behaviour lives here, using upstream-only SDK7 APIs.    │
│      └ SDK7 / CRDT ─┐                                                 │
├──────────────────────┼──────────────────────────────────────────────────┤
│ 1. Engine  (bevy-explorer, Rust/WebGPU)   ▼  STOCK UPSTREAM, unmodified│
│    Published web build / `@dcl-regenesislabs/bevy-explorer-web` npm    │
│    package. No fork, no editor patches. Provides the SDK7 super-user   │
│    scene runtime, Raycast, TextureCamera/CameraLayer, /scene_content.  │
└───────────────────────────────────────────────────────────────────────┘
```

The engine is an external dependency (a prebuilt npm package); the rest is this monorepo:

| Package | Layer | Owns |
|---|---|---|
| `bevy-explorer` | 1 (engine) | Rust engine. **Not ours / external — stock upstream, unmodified.** Consumed as the `@dcl-regenesislabs/bevy-explorer-web` npm package; no editor changes. |
| `packages/scene` | 2 | The editor's in-engine SDK7 scene (`src/`) — gizmos, picking, overlays, CRDT bridge. |
| `packages/ui` | 3 | The React host-page UI — panels + orchestration; also bundles the scene's logic modules. |
| `packages/desktop` | 4 | Electron desktop shell. Hosts the UI with the engine in an iframe. |
| `packages/contract` | seams | Shared types for the editor bus + the Electron IPC shell (single source of truth). |

---

## 2. Key decision: the editor runs on stock upstream — everything is scene-side

The engine is shared with production Decentraland and **we don't own it.** The
editor therefore runs on **stock, unmodified upstream `bevy-explorer`** — its
`main` branch / published web builds, consumed as the
`@dcl-regenesislabs/bevy-explorer-web` npm package. **No engine fork, no engine PR,
no editor-specific engine patches.** Everything the editor needs is built
**scene-side** (the super-user SDK7 scene in `packages/scene`) using upstream-only
APIs. The rule:

- **Zero engine changes.** If the editor needs a capability, it gets implemented
  in the scene with existing upstream APIs — never by patching the engine. Any new
  build of upstream bevy-explorer should work.
- How each editor capability is done **scene-side** on upstream APIs:
  - **Page↔scene bus** — a same-origin **`BroadcastChannel`**
    (`packages/scene/src/editor-channel.ts`), opened by the super-user scene and
    the host page (both same origin). No engine console commands.
  - **Click-to-select** — an SDK **`Raycast`** on an editor-only collider layer
    (`CL_RESERVED6 = 128`), written engine-only and stripped from the logical
    snapshot on ingest (`viewport/click-select.ts` + `pick-layer.ts`).
  - **Gizmo on-top + crisp** — a dedicated **`TextureCamera` / `CameraLayer`**
    composite (no depth-of-field), built in `gizmo.ts` and composited in
    `overlay.tsx`.
  - **Asset import** — the upstream **`/scene_content`** mechanism.
  - **CRDT read/write, component schema, save-composite, selection** — driven
    through the super-user scene's SDK7 access to other scenes' entities.

### Why this works without engine changes

The super-user SDK7 scene runtime already exists in upstream bevy-explorer (the
system UI scene uses it). A scene loaded super-user can read/write other scenes'
CRDT and use the full SDK7 surface — Raycast, TextureCamera/CameraLayer,
`/scene_content`, etc. That is enough to build the entire editor in the scene
layer, so production engine behaviour is untouched by construction: there is no
editor code in the engine at all.

> **Contributor rule:** do **not** modify `bevy-explorer` for the editor. If the
> editor needs something the engine can't yet do via upstream APIs, the fix is to
> implement it scene-side, or (if genuinely impossible) to upstream the capability
> to bevy-explorer `main` as a general feature — never as an editor-specific patch.

---

## 3. The contract: how the host UI talks to the scene

The host UI talks to the editor scene over a single transport — a same-origin
**`BroadcastChannel`** editor bus. (The engine runs in a same-origin iframe, so the
page and the in-engine scene share an origin and can open the same channel.)

### The editor message bus (`packages/scene/src/editor-channel.ts`)
A `BroadcastChannel` carrying JSON messages between the React host page and the
in-engine super-user scene. The host listens for `page`-targeted messages; the
scene listens for `scene`-targeted messages. No engine console commands, no
polling — this is plain same-origin DOM messaging that works on stock upstream.

- **`PageToSceneMessage`** — `init`, `set-tool`, `set-flags`, `set-selection`,
  `set-camera`, `focus`, `refresh`, `resync`, `pointer-up`, `pointer-tap`,
  `fly-speed`, `component-written`, `entity-deleted`, `rpc`.
- **`SceneToPageMessage`** — `scene-ready`, `selection`, `drag-start`, `drag-end`,
  `tool`, `rpc-reply`.
- **RPC trampoline** (`rpc`/`rpc-reply`): lets the page call engine *system* APIs
  it can't reach directly (e.g. `liveSceneInfo`, login) by asking the scene to
  call them and reply.

`SCENE_BRIDGE_VERSION` (`bridge-protocol.ts`) is bumped on contract changes; the
host warns when it loads a stale (cached) scene bundle.

### Inspector component views
The Inspector renders a **curated view** per SDK7 component
(`packages/ui/src/panels/views/`): a config-driven renderer (`curated.tsx` —
groups, labels, sliders, collision-layer masks, structured texture editing)
layered over the engine's `/component_schema`, falling back to the generic
`SchemaEditor` for anything unconfigured so schema drift never hides data.
The Add Component picker is limited to the engine-renderable SDK set + `Name`
(`packages/scene/src/allowed-components.ts`). The UI's look is the
bevy-explorer react-web design system (Explorer 2.0 tokens + primitives),
ported into the shadow-root stylesheet (`styles.ts`, `ds/`); browse it via
`design-system.html` (served by the desktop web server too).

### State sync
`src/state.ts` is a single mutable object that is bundled into **both** the scene
and the host UI builds (they are separate JS contexts holding separate copies).
The bus keeps the two copies aligned: selection/tool/flags/camera and gizmo
drag-end transforms flow scene→page; tool/selection/component writes flow
page→scene. The React host stays in sync via a small hand-rolled reactive store:
`state` is wrapped in an auto-notifying `Proxy` (`reactive()` in
`packages/scene/src/reactive.ts`) and components subscribe to slices with
`useStore(() => state.x)` (`packages/ui/src/store.ts`) — fine-grained re-renders,
no manual signal. Sets/Maps and the snapshot are written through replace-on-write
helpers in `state.ts`. See [`docs/STATE-ARCHITECTURE.md`](./docs/STATE-ARCHITECTURE.md).

---

## 4. Lifecycle (Electron app)

1. **Picker** → `editorShell.openProject(dir)` (IPC).
2. Main validates `scene.json`, navigates the window to the **loading screen**
   (`?project=…`), then starts two dev servers (`sdk-commands start`): the editor
   system scene (`:8005`, reused across projects) and the project scene
   (`:8004`, fresh per open, streams build logs).
3. Main emits `servers-ready { realm, systemScene, position }`.
4. The host mounts the engine **iframe** in the background; `boot()` waits for the
   engine console, then handshakes `init` → `scene-ready` over the bus, pulls the
   CRDT snapshot, and flips `status = 'ready'`; the loading overlay lifts.
5. **Recovery:** if the engine never becomes ready within 40 s (corrupt
   IndexedDB), the host calls `recoverEngineStorage()` (IPC) to clear the bad
   browser storage, reloads the iframe, and re-points the console — the running
   `boot()` loop then completes. (Recovery is implemented in `main-embed.tsx`; the
   `validate:e2e` harness clears storage pre-launch.)

---

## 5. Build topology

```
root: npm run build   (scene → ui → desktop)
  ├─ packages/scene   sdk-commands build  → bin/index.js                          (in-engine scene)
  ├─ packages/ui      vite build          → dist/editor-app.html + dist/assets/editor-app-<hash>.js
  │     entries: editor-app.html → src/main-embed.tsx, which serves BOTH the
  │     Electron host and the no-Electron direct-attach route
  │     (editor-app.html?realm=… ; window.editorShell is optional), and
  │     engine.html → src/engine-host.ts, the iframe page that boots the
  │     upstream engine via its boot contract (/engine/boot.js + __bevyLaunch).
  └─ packages/desktop esbuild.mjs         → dist/{main,preload}.cjs               (Electron)

bevy-explorer (engine wasm — external, prebuilt, NOT built here):
  comes from the @dcl-regenesislabs/bevy-explorer-web npm package (tarball
  includes the wasm). `npm install` yields a runnable engine — no Rust, no
  wasm-pack. Resolution order at serve time: BEVY_WEB_DIR env → installed npm
  package → ../bevy-explorer/deploy/web sibling fallback.
```

The UI builds into **`packages/ui/dist`** (self-contained — nothing is written
into the engine package). At runtime the desktop's web server (`servers.ts`)
serves the UI dir **and** the resolved engine web dir under **one origin** with
COOP/COEP headers (required for wasm threads + the same-origin host↔iframe wiring
and the `BroadcastChannel` bus). The engine is a prebuilt npm dependency, not a
sibling build (a local `../bevy-explorer/deploy/web` is only used when an engine
dev sets `BEVY_WEB_DIR`).

---

## 6. Known weaknesses & refactor roadmap

Captured from an architecture audit; ordered by priority. None block the editor
working today, but they are the path to "easy to add features".

**Engine (layer 1)**
- Nothing to do — the editor runs on **stock upstream** bevy-explorer with no
  editor code in the engine. The only "engine work" is bumping the
  `@dcl-regenesislabs/bevy-explorer-web` package version when a newer build is
  desired; the editor must keep working on any recent upstream build.

**Editor scene + host UI (layers 2–3)**
- `src/state.ts` is a ~380-line god-object shared across both bundles. Split into
  domain slices (selection / gizmo / inspector / dialogs / save / assets).
- `src/inspector.ts` (~800 lines) is the one module for boot, snapshot, CRUD,
  save, reparent, gizmo-commit. Split (`transport`/`entities`/`save`/`snapshot`).
- `packages/ui/` imports `../../scene/src/*` directly; the effective API is the whole
  scene `src/` module graph. Introduce an explicit `src/api.ts` barrel and lint
  against deep imports.
- Dedupe `parentOf` (state.ts vs schema.ts) and `CHANNELS` (schema.ts vs
  properties.tsx).
- No unit tests; the pure functions (`buildFromSchema`, `computeSaveDiff`,
  `buildComposite`) are the obvious first targets.

**Electron shell (layer 4)**
- `main.ts` mixes window/menu/IPC/project-metadata; split into modules.
- The preload `onStackLog`/`onServersReady`/`onServersError` use `ipcRenderer.on`
  and are never removed — listeners accumulate per `openProject`. Switch to
  `once` or return a disposer the renderer calls.
- `ProjectInfo` and the `EditorShell` interface are duplicated across repos with
  no shared type; a shared `@editor/contract` package would remove the drift.
- `lsof`/`sips` make servers + the gizmo test macOS/Linux-only.
- The validate scripts each reimplement the CDP boilerplate; extract `cdp.mjs`.

See `CONTRIBUTING.md` for how to extend each layer.
