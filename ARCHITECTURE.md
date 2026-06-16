# Decentraland Scene Editor — Architecture

This is the architecture reference for the Decentraland scene editor: an editor
that runs **both** in-world (in a browser, alongside a running explorer) **and**
as a standalone **Electron desktop app**, sharing one editor implementation. It is
intended as a replacement for the official Creator Hub editing flow, built on top
of the `bevy-explorer` engine.

> **North star:** all editor *logic* lives in the editor scene + host UI (which
> we own and can iterate on freely). The engine (`bevy-explorer`) — which we do
> **not** own — gets only minimal, **feature-gated** primitives, so production
> engine behaviour is provably unchanged.

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
│    Talks to the engine over the console-RPC + editor bus.             │
│      └ console_command / editor bus ─┐                                │
├──────────────────────────────────────┼────────────────────────────────┤
│ 2. Editor scene  (packages/scene/src)   ▼  SDK7 scene, super-user       │
│    Runs INSIDE the engine as a system scene. Selection, gizmos, the   │
│    CRDT data layer, import, undo/redo, autosave, world overlays.      │
│      └ ~system console commands / CRDT ─┐                             │
├──────────────────────────────────────────┼──────────────────────────────┤
│ 1. Engine  (bevy-explorer, Rust/WebGPU)   ▼  feature = "editor" ONLY  │
│    `scene_inspector` crate: /editor_send /editor_poll, CRDT snapshot, │
│    component schema, asset import, save-composite, selection          │
│    highlight. Plus gizmo-overlay + DoF-disable systems. ALL gated.    │
└───────────────────────────────────────────────────────────────────────┘
```

Two repos sit as siblings on disk and one depends on them:

| Package | Layer | Owns |
|---|---|---|
| `bevy-explorer` | 1 (engine) | Rust engine. **Not ours / external.** Editor additions are feature-gated. |
| `packages/scene` | 2 | The editor's in-engine SDK7 scene (`src/`) — gizmos, picking, overlays, CRDT bridge. |
| `packages/ui` | 3 | The React host-page UI — panels + orchestration; also bundles the scene's logic modules. |
| `packages/desktop` | 4 | Electron desktop shell. Hosts the UI with the engine in an iframe. |
| `packages/contract` | seams | Shared types for the editor bus + the Electron IPC shell (single source of truth). |

---

## 2. Key decision: the engine is touched only behind `feature = "editor"`

The engine is shared with production Decentraland. **Nothing we add may change
production behaviour.** The rule:

- **Editor-only engine code is compiled in only under the Cargo `editor` feature.**
  Production builds omit the feature, so the editor code does not exist in the
  binary. Editor/web builds pass `--features "livekit,social,editor"`.
- Gated behind `editor`:
  - the entire `scene_inspector` crate + plugin (console commands `/editor_send`,
    `/editor_poll`, `/crdt_snapshot`, `/set_component`, `/save_composite`,
    `/asset_catalog`, selection `/highlight`, freeze/tick, component schema …),
  - `mark_super_scene_overlay` (renders editor gizmos/markers on top), and
  - `editor_disable_dof` (turns off depth-of-field while editing).
- **Genuine engine bug fixes stay unconditional** (they are correctness fixes that
  should be upstreamed independently of the editor):
  - `restricted_actions/src/teleport.rs` — spawn-point infinite-loop fix.
  - `assets/.../nishita_cloud.wgsl` — reversed `smoothstep` args rejected by newer
    Dawn WGSL validation.

### Why a Cargo feature, not a runtime flag

A runtime flag (e.g. keying off the `SuperUserScene` marker) is **not** safe here:
the production **system UI scene is itself loaded as a super-user scene**
(`bevy-explorer/src/lib.rs`, `super_user: true`). Gating editor behaviour on
"is there a super-user scene" therefore fires in production. A compile-time
feature is the only way to *prove* production is unchanged — when it is off, the
code isn't there. (This was a real regression caught in review: `editor_disable_dof`
gated on `SuperUserScene` would have stripped depth-of-field for every normal
explorer user.)

> **Contributor rule:** any new engine change must be either (a) a genuine,
> editor-independent bug fix, or (b) gated behind `#[cfg(feature = "editor")]`
> (and proven inert when the feature is off). No exceptions.

---

## 3. The contract: how the host UI talks to the engine + scene

There are **two transports**, both riding the engine's console-command RPC:

### Transport A — direct console RPC (`packages/ui/src/console.ts`)
`consoleCommand(cmd, args)` → `window.engine_console_command_args(cmd, args)`.
In the Electron app the engine runs in a same-origin **iframe**;
`setEngineWindow(iframe.contentWindow)` repoints all calls into it. This is the
single seam between "in-page engine" and "embedded engine". Used for all the
`scene_inspector` commands (snapshot, component CRUD, freeze/tick, save, etc.).

### Transport B — the editor message bus (`bridge-protocol.ts`)
A polled queue (100 ms) on top of two console commands:
`editor_send <target> <json>` enqueues, `editor_poll <target>` dequeues. The host
polls `editor_poll page`; the scene polls `editor_poll scene`.

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

### State sync
`src/state.ts` is a single mutable object that is bundled into **both** the scene
and the host UI builds (they are separate JS contexts holding separate copies).
The bus keeps the two copies aligned: selection/tool/flags/camera and gizmo
drag-end transforms flow scene→page; tool/selection/component writes flow
page→scene. The React host re-renders via a version counter (`packages/ui/src/store.ts`
`bump()` + `useSyncExternalStore`).

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
   `boot()` loop then completes. See `validate/recovery-test.mjs`.

---

## 5. Build topology

```
root: npm run build   (scene → ui → desktop)
  ├─ packages/scene   sdk-commands build      → bin/index.js          (in-engine scene)
  ├─ packages/ui/build.mjs
  │     ├─ main.tsx       → packages/ui/dist/editor-ui.js              (in-page)
  │     └─ main-embed.tsx → packages/ui/dist/editor-app.{js,html}      (electron host)
  └─ packages/desktop esbuild.mjs → dist/{main,preload}.cjs           (Electron)

bevy-explorer (engine wasm, EDITOR build — external):
  wasm-pack build --target web --out-dir ./deploy/web/pkg \
    --no-default-features --features "livekit,social,editor"
```

The UI builds into **`packages/ui/dist`** (self-contained — nothing is written
into the engine checkout). At runtime the desktop's web server (`servers.ts`)
serves the UI dir **and** the engine's `deploy/web` under **one origin** with
COOP/COEP headers (required for wasm threads + the same-origin host↔iframe RPC).
The engine checkout is an external sibling of the monorepo.

---

## 6. Known weaknesses & refactor roadmap

Captured from an architecture audit; ordered by priority. None block the editor
working today, but they are the path to "easy to add features".

**Engine (layer 1)**
- The `dcl` per-tick `FilteredCrdtStore` + `AllocatorContext` are still compiled
  and run unconditionally (perf overhead, no behaviour change in prod). Next step:
  gate them behind `dcl/editor` too for a zero-cost prod build.
- `scene_material` depth-test-off flag + `bound_material.wgsl` select-tag branch
  are inert in prod (flag never set without the gated overlay system) but not
  feature-gated. Low priority.

**Editor scene + host UI (layers 2–3)**
- `src/state.ts` is a ~400-line god-object shared across both bundles. Split into
  domain slices (selection / gizmo / inspector / dialogs / save / assets).
- `src/inspector.ts` (~860 lines) is the one module for boot, snapshot, CRUD,
  save, reparent, gizmo-commit. Split (`transport`/`entities`/`save`/`snapshot`).
- `packages/ui/` imports `../../src/*` directly; the effective API is the whole `src/`
  module graph. Introduce an explicit `src/api.ts` barrel and lint against deep
  imports.
- Dedupe `parentOf` (state.ts vs schema.ts) and `CHANNELS` (schema.ts vs
  properties.tsx).
- `bump()` is manual at every mutation site (500 ms safety net hides misses).
  A `mutate(fn)` wrapper would make reactivity structural.
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
