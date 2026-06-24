# Setup

A step-by-step runbook to go from a clean machine to a running editor. If you
only need the short version, it's in the [README Quick start](../README.md#quick-start);
this page fills in the prerequisites that are easy to miss.

> Good news: **the engine ships as an npm package**
> (`@dcl-regenesislabs/bevy-explorer-web`) — `npm install` pulls a runnable build
> (the tarball includes the wasm). There is **no Rust/wasm-pack/engine compile**
> to run the editor. The editor uses **stock, unmodified upstream bevy-explorer**;
> all editor behaviour is done scene-side. Only set up a local engine build if you
> are doing engine development (see `BEVY_WEB_DIR`).

---

## 1. System prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | current LTS (engines floor: 22) | the monorepo (npm workspaces). Node 18 is EOL — always use an active LTS. `.nvmrc` is `lts/*`; run `nvm install --lts && nvm use`. |
| npm | 10+ | workspaces (ships with the Node LTS) |
| Platform | macOS / Linux | full support incl. `validate:e2e`. Windows runs the app + `npm run validate`, but the e2e harness is POSIX-only. |

> No Rust toolchain is required. The engine arrives as a normal npm dependency,
> so `npm install` is all you need to get a runnable engine. (Rust + `wasm-pack`
> are only relevant if you choose to build the engine locally for engine
> development — see step 3.)

## 2. Clone the repo

```bash
git clone <dcl-editor remote> dcl-editor
cd dcl-editor
```

That's it — the engine is a dependency, not a sibling checkout. (A sibling
`../bevy-explorer` is only needed if you're doing engine development; see step 3
and the `BEVY_WEB_DIR` override.)

## 3. The engine (no build needed)

The editor runs on **stock, unmodified upstream bevy-explorer** — its published
web build, packaged as the **`@dcl-regenesislabs/bevy-explorer-web` npm package**.
There is **no engine fork and no engine-specific patches**: every editor behaviour
(selection raycast, gizmo composite, the page↔scene bus, asset import) is
implemented **scene-side** in `packages/scene` using upstream-only APIs. So
`npm install` (next step) already gives you a runnable engine — there is nothing
to compile.

The engine web build is resolved at runtime in this order:

1. `BEVY_WEB_DIR` (if set) — a local engine build, for **engine development**.
2. the installed `@dcl-regenesislabs/bevy-explorer-web` npm package (the default).
3. a local `../bevy-explorer/deploy/web` sibling, as a fallback.

Only if you are developing the engine itself do you need Rust + `wasm-pack`:

```bash
# OPTIONAL — engine development only
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install wasm-pack
rustup target add wasm32-unknown-unknown

cd ../bevy-explorer
wasm-pack build --target web --out-dir ./deploy/web/pkg \
  --no-default-features --features "livekit,social"
# then point the editor at it:
export BEVY_WEB_DIR=../bevy-explorer/deploy/web
```

## 4. Build & run the editor

```bash
cd dcl-editor
npm install            # all workspaces (also pulls the engine package)
npm run validate       # typecheck + unit tests + build — confirms your setup is sound
npm start              # build + launch the desktop app
```

`npm run validate` is the fast, hermetic confidence check (no engine, no
Electron). If it passes, your toolchain and the monorepo are healthy. `npm start`
then launches the Electron app, which serves the engine pulled by `npm install`.

For the day-to-day HMR loop, use `npm run dev` (see the
[README dev scripts](../README.md#build--dev-scripts-root)).

## 5. Configuration (env vars)

All optional — the defaults work for the sibling layout above.

| Var | Default | Purpose |
|---|---|---|
| `BEVY_WEB_DIR` | _(unset)_ | override the engine web build with a local one (engine dev). Unset → the installed `@dcl-regenesislabs/bevy-explorer-web` package, then a `../bevy-explorer/deploy/web` sibling fallback |
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
  web build wasn't resolved. Re-run `npm install` to ensure the
  `@dcl-regenesislabs/bevy-explorer-web` package is present. If you set
  `BEVY_WEB_DIR` for engine dev, confirm that path's `pkg/` exists.
- **"Electron failed to install correctly…"** Electron's ~230 MB binary download
  was blocked. Fix: `rm -rf node_modules/electron && npm install` (with network).
- **More runtime issues:** see [`DEBUGGING.md`](./DEBUGGING.md).
