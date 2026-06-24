# Alignment with upstream (bevy-explorer) — the argument

> ✅ **RESOLVED (2026-06-24): the editor needs NO engine changes at all.** It now runs
> on stock, unmodified upstream `bevy-explorer` — no fork, no engine PR, not even the
> inert delta described below. Every engine hook was moved scene-side (see the
> [2026-06-24 entry](#2026-06-24--alignment-resolved-no-engine-changes) at the bottom).
> The analysis below is preserved as the historical "ships inert" argument that this
> pivot superseded.

This editor is built **on top of** rob's upstream editor support in
`bevy-explorer`, not as a fork or a parallel implementation. We reuse his
primitives and add product capabilities (gizmos, an editing-focused viewport, a
React host UI, a desktop app). Our engine footprint is deliberately tiny and
**ships inert** in the engine's single build (rob's pattern), so production runtime
is provably unchanged.

## What we use from upstream (rob's work — `origin/main`)

The engine already ships, unconditionally, the editor *backend* we depend on:

| Upstream PR | What it gives the editor |
|---|---|
| #812 | editor-scene engine support: generic `consoleCommand`, entity-delete threading, transform-edit timestamp fix |
| #813 | pointer-event highlight (the outline render path) |
| #819 | inspector/editor console commands: components, CRDT snapshot/initial, save-composite, entity allocation, asset catalog |
| #822 | component-schema curated overlay moved into the editor scene |
| #833 | `/new_entity` at caller-specified ids |
| #834 | treat an inspector-paused scene as ready |
| #836 / #837 / #839 | pointer/insert/concurrent-allocation fixes |
| `SuperUserRaycastScene` (raycast_result.rs) | super-user raycast pinned to the inspected scene — correct hit ids for the editor |

24 of the editor's ~28 engine console commands are rob's. We inherit his fixes
for free by tracking `origin/main`.

## Our engine delta (5 commits on `feat/editor-v2`)

One is a genuine, unconditional render fix (candidate to upstream on its own):

0. **Reversed-smoothstep fix** (`nishita_cloud.wgsl`) — two `smoothstep` calls had
   `edge0 > edge1`; newer Dawn (Electron 33) rejects this, invalidating the
   atmosphere pipeline and rendering the whole viewport black. Two-line fix.
   *(Caught by end-to-end validation: without it, the engine boots and the UI/bus
   work but nothing renders.)*

The other four are editor-only — they **ship in the single engine build but stay
inert in normal play** (rob's pattern). There is no separate editor build and no
`editor` cargo feature:

1. **Gizmo on-top overlay** — clone the editor scene's materials with depth-test-off
   + transparent-phase so transform gizmos/markers render over the model from any
   angle. (`scene_material` flag + `scene_runner` system gated
   `run_if(any_with_component::<SuperUserScene>)`)
2. **DoF-disable while editing** — a crisp, fully-in-focus editing viewport.
   (`scene_runner` system gated `run_if(any_with_component::<SuperUserScene>)`)
3. **Editor message bus** (`/editor_send`, `/editor_poll`) — the page↔scene
   transport the host UI uses. Editor-only console commands; not provided upstream.
4. **`/pointer_target`** (viewport click-select) — raycasts the actual render
   meshes via bevy's `MeshRayCast` (used **on-demand** inside the command — no
   picking backend plugin runs), so a creator can click *any visible* model, not
   just colliders. Enables bevy's `bevy_mesh_picking_backend` on `scene_inspector`;
   inert at runtime (only invoked by the editor). **`/register_content`** — asset
   import into the live content map.

Verified: in the single build (1)–(2) never run in normal play — their systems are
gated `run_if(SuperUserScene)`, a marker only inserted when the editor loads a
super-user scene — and (3)–(4) are inert console commands (no-ops until invoked),
consistent with upstream's own editor commands. Production runtime is provably
unchanged because the editor code, though present, never executes.

## What we add on top (all in this monorepo — ours to own)

- **`scene`** — the SDK7 in-engine agent: transform gizmos, selection markers,
  parent/child relation lines, the CRDT bridge, import, undo/redo, autosave.
- **`ui`** — a React panel UI (Hierarchy / Inspector / Toolbar) with one codebase
  and two hosts (in-world same-window, electron iframe).
- **`desktop`** — an Electron shell: project picker, dev-server lifecycle, crash
  recovery (corrupt-IndexedDB auto-heal), logs.
- **`contract`** — shared, typed protocol (bus + IPC).

## The argument, in one line

> We don't change the engine to make the editor; rob's upstream already exposes
> the editor API. We track his `main`, keep a 4-commit render/UX delta that ships
> inert in the single build, and build the actual product (gizmos, editing
> viewport, UI, desktop) in our own monorepo — so production runtime is untouched
> and our work composes with his instead of competing with it.

See `editor-scene/ARCHITECTURE.md` for the layered design and
`dcl-editor/MIGRATION.md` for monorepo status.

## 2026-06-24 — Alignment resolved: no engine changes

The premise of this whole document — keep an engine delta minimal and inert so it
can align with / merge into upstream — is **resolved by removing the delta entirely**.
The editor moved fully scene-side (robtfm/editor-scene pattern) and now runs on
**stock, unmodified upstream `bevy-explorer`**: no engine fork, no engine PR, no
editor-specific engine patches. Each engine hook above was replaced by an
upstream-only, scene-side mechanism:

- **page↔scene bus** — `/editor_send` + `/editor_poll` → same-origin
  **`BroadcastChannel`**.
- **click-to-select** — `/pointer_target` → SDK **`Raycast`** on an editor-only
  collider layer (`CL_RESERVED6 = 128`); the engine-only collider write is stripped
  on snapshot ingest.
- **gizmo on-top + crisp** — material-overlay + DoF-disable → a dedicated
  **`TextureCamera` / `CameraLayer` composite** (no depth-of-field). This also retires
  the `nishita_cloud.wgsl` reversed-smoothstep fix as an editor concern.
- **asset import** — `/register_content` → a **`/scene_content`** content-map refresh.
- **engine acquisition** — compile a sibling `bevy-explorer/deploy/web` → the
  **`@dcl-regenesislabs/bevy-explorer-web` npm package** (tarball includes the wasm;
  `BEVY_WEB_DIR` still overrides to a local build). **Electron 33 → 42** (Chromium 148)
  so the atmosphere pipeline builds.

Result: the bevy-explorer **engine PR is abandoned** (nothing editor-specific left to
merge); the "5 commits on `feat/editor-v2`" delta no longer exists. Validated
end-to-end against stock `main`. Shipped in dcl-editor PR #4 (scene-side migration) +
#5 (gizmo texture-resolution fix).
