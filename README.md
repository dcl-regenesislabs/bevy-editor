# dcl-editor

A scene editor for [Decentraland](https://decentraland.org) that runs **both
in-world (browser) and as an Electron desktop app**, sharing one codebase. It is
built on top of the **bevy-explorer** engine and is intended as a modern Creator
Hub replacement.

This is an npm-workspaces monorepo. The engine (`bevy-explorer`) is an **external
dependency**, consumed as a prebuilt WebAssembly bundle — it is not part of this
repo (see [Prerequisites](#prerequisites)).

---

## What it is, in one picture

The editor is **a privileged SDK7 scene that edits other scenes**, with a React
UI bolted on. Three things run at once, talking over two well-defined seams:

```
        ┌──────────────────── ENGINE (bevy-explorer, external wasm) ───────────────────┐
        │                                                                               │
        │   the scene you're editing            the EDITOR scene  (packages/scene)      │
        │   (any DCL project)        ◀── reads/writes entities ──  gizmos, picking,      │
        │                               via console commands       selection, overlays  │
        └─────────────────────────────────────────────── ▲ ─────────────────────────────┘
                                                          │ editor bus
                              (/editor_send + /editor_poll console commands)
                                                          │
        ┌─────────────────────────── THE PAGE (DOM) ───── ▼ ───────────────────────────┐
        │   React panels + orchestration  (packages/ui)                                 │
        │   hierarchy · inspector · toolbar · asset catalog · gizmo sync                 │
        └────────────────────────────────────────────────────────────────────────────────┘

   Desktop only: the engine runs in an <iframe>; packages/desktop (Electron) hosts the
   page, spawns the local scene dev-servers, and serves the engine web build.
```

Two seams, both typed in **`@dcl-editor/contract`** (the single source of truth):

1. **Editor bus** — JSON messages between the React UI and the in-engine scene,
   tunneled through the engine's `/editor_send` + `/editor_poll` console commands.
2. **Host IPC shell** — `window.editorShell`, the Electron main↔renderer surface
   (project management, scene-server lifecycle).

For the full rationale (why the scene is kept, why the engine stays external and
feature-gated), see [`ARCHITECTURE.md`](./ARCHITECTURE.md) and
[`MIGRATION.md`](./MIGRATION.md).

---

## Packages

| Package | Name | What it is | Built by |
|---|---|---|---|
| `packages/contract` | `@dcl-editor/contract` | Shared cross-process types: the bus protocol + the Electron IPC shell. Zero runtime deps. **Source of truth for both seams.** | tsc (types only) |
| `packages/scene` | `@dcl-editor/scene` | The super-user SDK7 scene — the editor's in-engine agent (gizmos, markers, overlays, CRDT bridge). | `sdk-commands` → `bin/index.js` |
| `packages/ui` | `@dcl-editor/ui` | React host-page UI (panels + orchestration). Bundles itself **and** the scene's logic modules. Two entries: in-page and electron-iframe. | esbuild → `packages/ui/dist/editor-{app,ui}.js` |
| `packages/desktop` | `@dcl-editor/desktop` | Electron shell: project picker, scene dev-servers, serves the UI dir + engine dir same-origin, hosts the UI with the engine in an iframe. | esbuild → `dist/main.cjs` |

---

## Prerequisites

- **Node 18+** and npm 9+ (workspaces).
- **The `bevy-explorer` engine checkout**, as a *sibling directory of this repo*:
  ```
  <parent>/
    bevy-explorer/        ← the engine (external; not in this repo)
    dcl-editor/           ← this repo
  ```
  The editor needs the engine's web build at `bevy-explorer/deploy/web/` (the
  wasm bundle + `pkg/`). The engine must be built **with the `editor` cargo
  feature** so the editor-only engine hooks (super-user raycast, gizmo overlay,
  the editor bus commands, DoF-disable) are compiled in. All editor engine code
  is behind `#[cfg(feature = "editor")]`, so a normal (non-editor) build is
  unaffected. Override the location with `BEVY_WEB_DIR` if your layout differs.

---

## Quick start

```bash
npm install            # installs all workspaces
npm run build          # builds scene → ui (packages/ui/dist) → desktop
npm start              # builds, then launches the desktop app
```

The UI bundles build into **`packages/ui/dist`** (`editor-app.js`,
`editor-app.html`, `editor-ui.js`) — self-contained in the monorepo, nothing is
written into the engine checkout. At runtime the desktop's web server serves
that dir **same-origin alongside** the engine's `deploy/web` (the engine runs in
an iframe; same-origin is required for the host↔iframe console-RPC). See
`packages/desktop/src/servers.ts`.

### Troubleshooting

- **"Electron failed to install correctly, please delete node_modules/electron…"**
  Electron downloads a ~230 MB binary in a postinstall step; if that download was
  blocked/interrupted, you get a stub with no `node_modules/electron/path.txt`.
  Fix: with network access, `rm -rf node_modules/electron && npm install`. If you
  have another working Electron 33 checkout, you can also copy its
  `node_modules/electron/{dist,path.txt}` over the stub (same version only).

---

## Build & dev scripts (root)

| Command | What it does |
|---|---|
| `npm run build` | Full pipeline: scene (`bin/index.js`) → ui (web bundles) → desktop (`dist/`). |
| `npm run build:ui` | Just rebuild the UI bundles (fast inner loop while iterating on panels/scene). |
| `npm run build:scene` | Just rebuild the scene (`sdk-commands build`). |
| `npm run typecheck` | Type-check every package. |
| `npm start` | Build, then launch the Electron app (one-shot; no watch). |
| `npm run dev` | **Dev mode.** Build, start the UI watcher, launch the app, and **auto-reload the window** when the UI bundle changes. The scene is already watched by its dev-server. |
| `npm run validate` | **The gate.** Type-check + build everything. Fast, hermetic, no engine/Electron. Run this after any change. |
| `npm run validate:e2e` | Deeper end-to-end check: launches the app under CDP and drives it like a user (see [AGENTS.md](./AGENTS.md)). Slower, needs a test scene + GPU. |

### Inner loop while developing

- **`npm run dev`** is the everyday loop: edit a panel or scene file → save → the
  app reloads itself. (A reload reboots the engine iframe — a few seconds of
  WebGPU re-init — since the UI bundle is a full-page script; that's the accepted
  tradeoff. There's no module-level hot-swap.)
- **Desktop main process** changes still need a relaunch (`Ctrl+C` then
  `npm run dev` again) — `dev`'s watcher only covers the UI bundle.
- **Engine**: rebuilt separately in the `bevy-explorer` checkout
  (`--features editor`); slow (wasm), rarely needed for editor work.

---

## Working in this repo (for agents and humans)

If you're an automated agent picking up a feature request, read
**[`AGENTS.md`](./AGENTS.md)** — it describes the modify → build → validate loop,
where each kind of change lives, and the project conventions.

---

## Status

The monorepo cutover is complete; the whole tree builds and type-checks from the
root. The original single-purpose repos (`editor-scene`, `bevy-editor-app`) are
legacy — all new work happens here. Remaining nice-to-haves are tracked in
[`MIGRATION.md`](./MIGRATION.md) (a `scene` public-API barrel, a formal
`EngineTransport` seam).
