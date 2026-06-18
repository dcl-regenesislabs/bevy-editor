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

For the full rationale (why the scene is kept, why the engine stays external with
its editor code shipping inert), see [`ARCHITECTURE.md`](./ARCHITECTURE.md) and
[`MIGRATION.md`](./MIGRATION.md).

---

## Packages

| Package | Name | What it is | Built by |
|---|---|---|---|
| `packages/contract` | `@dcl-editor/contract` | Shared cross-process types: the bus protocol + the Electron IPC shell. Zero runtime deps. **Source of truth for both seams.** | tsc (types only) |
| `packages/scene` | `@dcl-editor/scene` | The super-user SDK7 scene — the editor's in-engine agent (gizmos, markers, overlays, CRDT bridge). | `sdk-commands` → `bin/index.js` |
| `packages/ui` | `@dcl-editor/ui` | React host-page UI (panels + orchestration). Bundles itself **and** the scene's logic modules. One entry (`main-embed.tsx`) serves both the Electron host and the no-Electron direct-attach route. | Vite → `packages/ui/dist/` (`editor-app.html` + hashed `assets/*`) |
| `packages/desktop` | `@dcl-editor/desktop` | Electron shell: project picker, scene dev-servers, serves the UI dir + engine dir same-origin, hosts the UI with the engine in an iframe. | esbuild → `dist/main.cjs` |

---

## Prerequisites

- **Node.js — the current LTS** (Node 18 is EOL — always use an active LTS).
  npm 10+ (workspaces). `.nvmrc` tracks the latest LTS (`lts/*`) — run `nvm use`.
- **Rust toolchain + `wasm-pack`** — only to *build the engine* (a one-time step,
  done in the `bevy-explorer` checkout). Not needed once `deploy/web/` exists.
- **Platform:** macOS / Linux are fully supported. `npm run validate:e2e` is
  macOS/Linux-only by convenience (it shells out to a few POSIX tools); plain
  `npm run validate` (typecheck + tests + build) and the app itself run anywhere
  Electron 33 does — Windows process management is handled, but less exercised.
- **The `bevy-explorer` engine checkout**, as a *sibling directory of this repo*:
  ```
  <parent>/
    bevy-explorer/        ← the engine (external; not in this repo)
    dcl-editor/           ← this repo
  ```
  The editor needs the engine's web build at `bevy-explorer/deploy/web/` (the
  wasm bundle + `pkg/`). There is a **single** engine build — the editor-only
  engine hooks (super-user raycast, gizmo overlay, the editor bus commands,
  DoF-disable) ship in it but stay inert in normal play (commands no-op until
  invoked; the per-frame systems run only when a super-user scene is loaded), so
  production behaviour is unchanged. Override the location with `BEVY_WEB_DIR` if
  your layout differs.

---

## Quick start

```bash
npm install            # installs all workspaces
npm run build          # builds scene → ui (packages/ui/dist) → desktop
npm start              # builds, then launches the desktop app
```

The UI bundles build into **`packages/ui/dist`** (`editor-app.html` + hashed
`assets/editor-app-*.js`, emitted by Vite) — self-contained in the monorepo,
nothing is written into the engine checkout. At runtime the desktop's web server
serves that dir **same-origin alongside** the engine's `deploy/web` (the engine
runs in an iframe; same-origin is required for the host↔iframe console-RPC). See
`packages/desktop/src/servers.ts`.

New here? Start with **[`docs/SETUP.md`](./docs/SETUP.md)** — the full
environment runbook (including building the engine).

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
| `npm test` | Unit tests (Vitest) for the pure scene logic (transform math, save diff, predicates). |
| `npm start` | Build, then launch the Electron app (one-shot; no watch). |
| `npm run dev` | **Dev mode (HMR).** Serves the UI through Vite with React Fast Refresh + launches the app. Edit a panel/style → it **hot-swaps in place** (no reload, engine stays alive). The scene is watched by its own dev-server. |
| `npm run validate` | **The gate.** Type-check + build everything. Fast, hermetic, no engine/Electron. Run this after any change. |
| `npm run validate:e2e` | Deeper end-to-end check: launches the app under CDP and drives it like a user (see [AGENTS.md](./AGENTS.md)). Slower, needs a test scene + GPU. |

### Inner loop while developing

- **`npm run dev`** is the everyday loop: edit a panel/style (`packages/ui`) → save →
  the change appears instantly via HMR, **no page reload and no engine reboot**
  (selection/camera preserved).
- **Logic/singleton modules** (`state.ts`, `console.ts`, `boot.ts`, `actions.ts`)
  can't be hot-swapped safely (they re-init and would desync from the live engine),
  so editing those triggers a **full reload** (engine reboots — same as a Cmd+R).
- **Scene** (`packages/scene`) edits can't hot-swap (scene code runs in the engine
  sandbox, not the page), but `npm run dev` reloads **only the editor scene in place**
  via the engine's `/reload <hash>` when its `bin/index.js` rebuilds — no engine reboot,
  no "Connecting" overlay, project/camera preserved. (Falls back to a full page reload
  if the in-place reload doesn't take.)
- **Desktop main process** changes need a relaunch (`Ctrl+C` then `npm run dev`).
- **Engine**: rebuilt separately in the `bevy-explorer` checkout
  (single build, `--features "livekit,social"`); slow (wasm), rarely needed for editor work.

> How it works: `npm run dev` runs one node server (Vite middleware for the UI +
> static engine assets) on the web port — same origin, so the host↔iframe RPC works
> — then launches the app, which reuses that server. Vite never enters the
> production app. Production (`npm start`) is a plain static build, no Vite at runtime.

---

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/SETUP.md`](./docs/SETUP.md) | New-engineer runbook: prerequisites, building the engine, first run. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | The four layers, the two seams, the ships-inert engine rule. |
| [`docs/STATE-ARCHITECTURE.md`](./docs/STATE-ARCHITECTURE.md) | The reactive store: `reactive()` + `useStore(selector)`, replace-on-write helpers, why it's hand-rolled (SDK7-safe). |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | Why it's built this way + operational gotchas (the "why" log). |
| [`docs/DEBUGGING.md`](./docs/DEBUGGING.md) | Bus tracing, console-RPC, logs, the boot watchdog, common failures. |
| [`docs/AI-AGENT.md`](./docs/AI-AGENT.md) | Driving/testing the editor with an AI agent + the e2e/CDP harness. |
| [`docs/TESTING.md`](./docs/TESTING.md) | `validate` vs `validate:e2e` vs unit tests; running subsets; writing tests. |
| [`docs/PRODUCTION-READINESS.md`](./docs/PRODUCTION-READINESS.md) | Handoff backlog: what's hardened, what remains (packaging, distribution). |
| [`AGENTS.md`](./AGENTS.md) | The modify → build → validate loop and conventions (for agents + humans). |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) · [`MIGRATION.md`](./MIGRATION.md) · [`UPSTREAM-ALIGNMENT.md`](./UPSTREAM-ALIGNMENT.md) | Contribution flow · how we got here · engine-fork positioning. |

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
