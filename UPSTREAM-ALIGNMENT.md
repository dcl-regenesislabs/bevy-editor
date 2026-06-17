# Alignment with upstream (bevy-explorer) — the argument

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
