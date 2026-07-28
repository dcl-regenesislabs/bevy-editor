# Contributing to the Decentraland Scene Editor

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first — it explains the four layers
and the rules. This file is the practical how-to.

## Layout (engine is a prebuilt npm dependency)

```
…/Decentraland/
  └─ dcl-editor/       this monorepo
       packages/{contract,scene,ui,desktop}
       node_modules/@dcl-regenesislabs/bevy-explorer-web   ← stock upstream engine (prebuilt wasm)

  (../bevy-explorer/   optional: a local engine checkout, only for engine devs — see BEVY_WEB_DIR)
```

The engine is **stock, unmodified upstream `bevy-explorer`** — we do **not** fork
or patch it. It arrives as the `@dcl-regenesislabs/bevy-explorer-web` npm package
(the tarball includes the wasm), so `npm install` gives a runnable engine.

### Packages

| Package | Name | What it is | Built by |
|---|---|---|---|
| `packages/contract` | `@dcl-editor/contract` | Shared cross-process types: the bus protocol + the Electron IPC shell. Zero runtime deps. **Source of truth for both seams.** | tsc (types only) |
| `packages/scene` | `@dcl-editor/scene` | The super-user SDK7 scene — the editor's in-engine agent (gizmos, markers, overlays, CRDT bridge). | `sdk-commands` → `bin/index.js` |
| `packages/ui` | `@dcl-editor/ui` | React host-page UI (panels + orchestration). Bundles itself **and** the scene's logic modules. One entry (`main-embed.tsx`) serves both the Electron host and the no-Electron direct-attach route. | Vite → `packages/ui/dist/` (`editor-app.html` + hashed `assets/*`) |
| `packages/desktop` | `@dcl-editor/desktop` | Electron shell: project picker, scene dev-servers, serves the UI dir + engine dir same-origin, hosts the UI with the engine in an iframe. | esbuild → `dist/main.cjs` |

## Build & run

```bash
# From the monorepo root — no engine compile needed:
npm install        # also installs the prebuilt engine (@dcl-regenesislabs/bevy-explorer-web)
npm run build      # scene → ui (packages/ui/dist) → desktop; served same-origin with the engine
npm start          # build + launch the desktop app

# Inner loops:
npm run dev        # HMR: edit a panel/style -> hot-swaps in place (see docs/DECISIONS.md)
npm run build:ui   # one-off rebuild of just the UI bundles (reload the editor after)
npm run build:scene # one-off rebuild of just the editor scene (sdk-commands build)
```

There is **no engine build step** for editor work: the prebuilt npm package serves
both normal play and the editor, and all editor behaviour lives in the scene layer.
Engine resolution order: `BEVY_WEB_DIR` env → installed npm package →
`../bevy-explorer/deploy/web` sibling fallback. Bump the engine by changing the
package version in the root `package.json`.

> **Engine devs only:** if you're building bevy-explorer itself, you need the Rust
> toolchain + `wasm-pack`, then point the editor at your local build with
> `BEVY_WEB_DIR=/path/to/bevy-explorer/deploy/web`. This is not part of editor
> development.

## Test / validate

Two tiers (full guide in [`docs/TESTING.md`](./docs/TESTING.md)):
```bash
npm run validate          # the gate: typecheck + unit tests (vitest) + build. Fast, hermetic.
npm run typecheck         # just the type-check, every package (no build)
npm test                  # just the unit tests (pure scene logic)
npm run validate:e2e      # CDP-driven end-to-end harness (macOS/Linux, needs a GPU + test scene)
```
The e2e harness can run a subset of steps or target a specific scene:
```bash
cd packages/desktop
node validate/validate.mjs --steps=boot,picker,engine,scene
BEVY_EDITOR_PROJECT=/path/to/scene node validate/validate.mjs
```
You never need to compile the engine for editor work — it's a prebuilt npm
dependency. (Engine devs verifying a local engine build do so in their own
`bevy-explorer` checkout; that's outside this repo.)

## The golden rule: don't touch the engine

The engine is shared with production and **we don't own it**. The editor runs on
**stock, unmodified upstream `bevy-explorer`** (the `@dcl-regenesislabs/bevy-explorer-web`
npm package): **no fork, no engine PR, no editor-specific patches.**

So the rule is simple: **don't modify `bevy-explorer` for the editor.** Anything the
editor needs is built **scene-side** in `packages/scene` using upstream-only SDK7
APIs. The patterns the editor already uses (all on stock upstream):

- **Page↔scene bus** — a same-origin `BroadcastChannel`
  (`packages/scene/src/editor-channel.ts`).
- **Click-to-select** — an SDK `Raycast` on an editor-only collider layer
  (`CL_RESERVED6 = 128`), written engine-only and stripped from the logical
  snapshot on ingest (`viewport/click-select.ts` + `pick-layer.ts`).
- **Gizmo on-top + crisp** — a dedicated `TextureCamera` / `CameraLayer` composite
  (no depth-of-field) built in `gizmo.ts`, composited in `overlay.tsx`.
- **Asset import** — the upstream `/scene_content` mechanism.

If you ever hit something genuinely impossible via upstream APIs, the answer is to
upstream a **general** capability to bevy-explorer `main` (not an editor-specific
patch) — but exhaust the scene-side options first; this is almost never necessary.

## How to add a feature (host UI + scene)

### A new inspector component editor
Most components need **no code** — the component schema drives `SchemaEditor`
automatically. Otherwise:
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

## App size (gated against main's last build)

Download size is part of the creator experience: the images are already ~205 MB
(mac arm64 `.dmg`, 526 MB installed) and ~165 MB (win x64 `.exe`, 581 MB installed),
so a careless dependency can quietly push them past what people will wait for.
The `app size` CI job measures the images a PR builds and compares them against
the size artifacts of the latest successful `main` build — nothing is committed,
so there are no numbers to keep fresh. `app-size.json` at the repo root holds
only the knobs:

- `budgets` — absolute per-image ceilings (~10–15% headroom over today's size)
- `maxGrowthMb` — the biggest installer/installed growth vs `main` a PR can
  merge without touching the file

The job **fails** when an image exceeds its budget or grows more than
`maxGrowthMb`. Raising either is allowed — but it has to be a deliberate line
in the diff. If `main` has no size artifacts to compare against (first run, or
retention expired), the growth gate is skipped with a warning and budgets still
apply.

It also comments a sticky table on the PR with the delta versus `main` and a
per-component breakdown (`engine-web`, `node`, `ui`, `editor-scene`,
`templates`, `app.asar`, and `runtime` = Electron + helpers), so a jump points
straight at what caused it.

Two scripts (run after `npm run dist`):

| Command | What it does |
|---|---|
| `npm run size` | Measure the packaged image in `packages/desktop/release/` (installer, installed, per-component breakdown). |
| `npm run size:check` | Same, then check against the `app-size.json` budgets. The vs-main comparison needs CI (the baseline lives in its artifacts). |

For packaging, CI images, and the release process, see
[`docs/RELEASING.md`](./docs/RELEASING.md).

## Documentation index

| Doc | What it covers |
|---|---|
| [`docs/SETUP.md`](./docs/SETUP.md) | New-engineer runbook: prerequisites, prebuilt engine from npm, first run. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | The four layers, the two seams, the unmodified-upstream-engine rule. |
| [`docs/STATE-ARCHITECTURE.md`](./docs/STATE-ARCHITECTURE.md) | The reactive store: `reactive()` + `useStore(selector)`, replace-on-write helpers, why it's hand-rolled (SDK7-safe). |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | Why it's built this way + operational gotchas (the "why" log). |
| [`docs/DEBUGGING.md`](./docs/DEBUGGING.md) | Bus tracing, logs, the boot watchdog, common failures. |
| [`docs/TESTING.md`](./docs/TESTING.md) | `validate` vs `validate:e2e` vs unit tests; running subsets; writing tests. |
| [`docs/AI-AGENT.md`](./docs/AI-AGENT.md) | Driving/testing the editor with an AI agent + the e2e/CDP harness. |
| [`docs/AI-ASSISTANT.md`](./docs/AI-ASSISTANT.md) | The in-app AI assistant: CLI providers (Claude/Codex), SDK7 skills, Script Studio. |
| [`docs/SIGN-IN.md`](./docs/SIGN-IN.md) | Sign in with Decentraland: auth deep-link flow, dev shim, packaged-scheme requirements. |
| [`docs/WORLDS.md`](./docs/WORLDS.md) | Worlds: publish & manage — inventory, permissions, streaming, storage, logs, the deploy/linker flow. |
| [`docs/RELEASING.md`](./docs/RELEASING.md) | Desktop images: packaging, CI builds, the release process, auto-update, signing. |
| [`docs/NETWORK.md`](./docs/NETWORK.md) | Network request audit: every request per section, hot paths, caching plan. |
| [`packages/ui/CONVENTIONS.md`](./packages/ui/CONVENTIONS.md) | UI architecture: design-system rules, shadow-root styling, where code goes. |
| [`docs/PRODUCTION-READINESS.md`](./docs/PRODUCTION-READINESS.md) | Handoff backlog: what's hardened, what remains (packaging, distribution). |
| [`docs/PREFABS-RESEARCH.md`](./docs/PREFABS-RESEARCH.md) | Prefabs & the **Script component**: research, toolchain revalidation, and the in-editor script authoring design (scripts are written/edited in-app; `@dcl/sdk-commands` runs them). |
| [`AGENTS.md`](./AGENTS.md) | The modify → build → validate loop and conventions (for agents + humans). |
| [`MIGRATION.md`](./MIGRATION.md) | How we got here (monorepo cutover) + remaining nice-to-haves. |
| [`UPSTREAM-ALIGNMENT.md`](./UPSTREAM-ALIGNMENT.md) | Upstream-engine positioning. |

## Conventions

- Commits: imperative mood, focus on **why**; one logical change per commit; no
  AI-attribution trailers.
- TypeScript: no `as any` (use `unknown` + narrow); static imports only
  (`React.lazy` excepted); comments explain non-obvious *why*, not *what*.
- After a change that affects behaviour/config/structure, update
  `ARCHITECTURE.md` / this file / `README.md` as needed.
