# Setup

A step-by-step runbook to go from a clean machine to a running editor. If you
only need the short version, it's in the [README Quick start](../README.md#quick-start);
this page fills in the prerequisites that are easy to miss.

> The single biggest gotcha: **the engine (`bevy-explorer`) is a separate repo
> you build yourself**, and it must sit next to this one. The editor will not run
> without it. (One build serves both normal play and the editor.)

---

## 1. System prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | current LTS (engines floor: 22) | the monorepo (npm workspaces). Node 18 is EOL — always use an active LTS. `.nvmrc` is `lts/*`; run `nvm install --lts && nvm use`. |
| npm | 10+ | workspaces (ships with the Node LTS) |
| Rust + Cargo | stable | building the engine (one-time) |
| `wasm-pack` | latest | building the engine to wasm |
| Platform | macOS / Linux | full support incl. `validate:e2e`. Windows runs the app + `npm run validate`, but the e2e harness is POSIX-only. |

Install Rust + wasm-pack (skip if you already have them):
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install wasm-pack
rustup target add wasm32-unknown-unknown
```

## 2. Lay out the repos as siblings

The editor resolves the engine at `../bevy-explorer/deploy/web` by default. Clone
both under one parent:

```
<parent>/
  bevy-explorer/     ← the engine (external)
  dcl-editor/        ← this repo
```

```bash
cd <parent>
git clone <bevy-explorer remote> bevy-explorer
git clone <dcl-editor remote> dcl-editor
```

If your layout differs, point the editor at the engine web build with the
`BEVY_WEB_DIR` env var (see [Configuration](#5-configuration-env-vars)).

## 3. Build the engine

This is the step newcomers miss. The editor needs engine-only hooks (super-user
raycast, gizmo overlay, the `/editor_*` bus commands, DoF-disable). These ship in
the **single** engine build but are dormant at runtime, so the same build serves
both normal play and the editor — there is nothing extra to enable.

```bash
cd bevy-explorer
wasm-pack build --target web --out-dir ./deploy/web/pkg \
  --no-default-features --features "livekit,social"
```

This produces `bevy-explorer/deploy/web/pkg/` (the wasm bundle) alongside the
engine's `deploy/web/index.html`. The editor serves this directory at runtime.

> The editor code in this build is inert in normal play (the overlay/DoF systems
> only run when a super-user scene is loaded; the console commands do nothing until
> invoked), so production behaviour is unchanged. See
> [`../UPSTREAM-ALIGNMENT.md`](../UPSTREAM-ALIGNMENT.md).

## 4. Build & run the editor

```bash
cd dcl-editor
npm install            # all workspaces
npm run validate       # typecheck + unit tests + build — confirms your setup is sound
npm start              # build + launch the desktop app
```

`npm run validate` is the fast, hermetic confidence check (no engine, no
Electron). If it passes, your toolchain and the monorepo are healthy. `npm start`
then launches the Electron app, which serves the engine you built in step 3.

For the day-to-day HMR loop, use `npm run dev` (see the
[README dev scripts](../README.md#build--dev-scripts-root)).

## 5. Configuration (env vars)

All optional — the defaults work for the sibling layout above.

| Var | Default | Purpose |
|---|---|---|
| `BEVY_WEB_DIR` | `../bevy-explorer/deploy/web` | engine web build location |
| `BEVY_WEB_PORT` | `3010` | the same-origin web server (UI + engine) |
| `SCENE_PORT` | `8004` | the edited scene's dev-server |
| `EDITOR_SCENE_PORT` | `8005` | the editor system scene's dev-server |
| `BEVY_EDITOR_PROJECT` | a sibling test scene | the scene the e2e harness opens |
| `BEVY_EDITOR_DEBUG` | unset | keeps the window composited for automation |

## 6. A test scene (for `validate:e2e`)

The e2e harness opens a real DCL scene. Point it at any local SDK7 project:

```bash
BEVY_EDITOR_PROJECT=/path/to/some-scene npm run validate:e2e
```

Any folder with a `scene.json` works. The harness needs a GPU (the engine is
WebGPU) and is macOS/Linux-only. See [`TESTING.md`](./TESTING.md).

## Troubleshooting setup

- **App launches but the viewport is blank / stuck at "logging-in".** The engine
  web build is missing or wasn't built. Re-run step 3 and confirm
  `bevy-explorer/deploy/web/pkg/` exists. If your layout differs, set
  `BEVY_WEB_DIR`.
- **"Electron failed to install correctly…"** Electron's ~230 MB binary download
  was blocked. Fix: `rm -rf node_modules/electron && npm install` (with network).
- **More runtime issues:** see [`DEBUGGING.md`](./DEBUGGING.md).
