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
        │                               via SDK7 / CRDT             selection, overlays  │
        └─────────────────────────────────────────────── ▲ ─────────────────────────────┘
                                                          │ editor bus
                              (same-origin BroadcastChannel — editor-channel.ts)
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
   over a same-origin `BroadcastChannel` (the super-user scene can open one; works
   on stock upstream — no custom engine commands).
2. **Host IPC shell** — `window.editorShell`, the Electron main↔renderer surface
   (project management, scene-server lifecycle).

For the full rationale (why the scene is kept, why the editor runs on
**unmodified upstream** bevy-explorer with everything done scene-side), see
[`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`MIGRATION.md`](./MIGRATION.md).

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
- **Platform:** macOS / Linux are fully supported. `npm run validate:e2e` is
  macOS/Linux-only by convenience (it shells out to a few POSIX tools); plain
  `npm run validate` (typecheck + tests + build) and the app itself run anywhere
  Electron does — Windows process management is handled, but less exercised.
- **The engine** — comes from the **`@dcl-regenesislabs/bevy-explorer-web` npm
  package** (a normal dependency). Its tarball **includes the wasm**, so a plain
  `npm install` gives a runnable engine — **no Rust toolchain, no engine compile**.
  The editor runs on **unmodified upstream** bevy-explorer (all editor behaviour is
  scene-side), so any recent build works.

  Engine source resolution (first that applies wins):
  1. **`BEVY_WEB_DIR`** env var — explicit override; point it at a local engine
     build (e.g. `../bevy-explorer/deploy/web`) when developing or linking a new
     **engine** feature. *(This is the path-based workflow for engine devs.)*
  2. the installed **npm package** (`node_modules/@dcl-regenesislabs/bevy-explorer-web`) — the default; no compile.
  3. a sibling **`../bevy-explorer/deploy/web`** build — fallback if the package isn't installed.

  Bump the engine by changing the `@dcl-regenesislabs/bevy-explorer-web` version in
  the root `package.json` (it tracks the `next` dist-tag).
  - **Rust toolchain + `wasm-pack`** are needed *only* if you build the engine
    locally yourself (the `BEVY_WEB_DIR` path workflow).

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
serves that dir **same-origin alongside** the engine web build (the engine runs in
an iframe; same-origin is required for the host↔iframe wiring and the
`BroadcastChannel` editor bus). See `packages/desktop/src/servers.ts`.

New here? Start with **[`docs/SETUP.md`](./docs/SETUP.md)** — the full
environment runbook (the engine comes prebuilt from npm; building it locally is
only for engine development).

### Troubleshooting

- **"Electron failed to install correctly, please delete node_modules/electron…"**
  Electron downloads a ~230 MB binary in a postinstall step; if that download was
  blocked/interrupted, you get a stub with no `node_modules/electron/path.txt`.
  Fix: with network access, `rm -rf node_modules/electron && npm install`. If you
  have another working Electron 42 checkout, you can also copy its
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
- **Engine**: comes prebuilt from the `@dcl-regenesislabs/bevy-explorer-web` npm
  package — never rebuilt for editor work (the editor needs zero engine changes).
  Only if you're developing the **engine** itself do you build it in a local
  `bevy-explorer` checkout and point `BEVY_WEB_DIR` at it (slow wasm build).

> How it works: `npm run dev` runs one node server (Vite middleware for the UI +
> static engine assets) on the web port — same origin, so the host↔iframe RPC works
> — then launches the app, which reuses that server. Vite never enters the
> production app. Production (`npm start`) is a plain static build, no Vite at runtime.

---

## AI assistant (in-app)

A ✨ button in the scene topbar opens a chat panel that edits your **Script
components** by prompt. It drives a local AI **CLI** — Claude Code (`claude`) or
Codex (`codex`) — as a child process of the Electron main, with the open project
as its working directory, so it edits `src/scripts/*.ts` on disk and
`sdk-commands` hot-reloads them live.

- **Runs on your own subscription, not an API key.** The child process inherits
  your CLI's OAuth session; metered API-key env vars (`ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, custom base-URLs) are stripped so it can't fall back to
  paid-per-token billing. Sign in once from a terminal (`claude` / `codex login`).
- **Scoped + safe.** File tools only (`Read/Edit/Write/Glob/Grep`), auto-applied
  within the project dir (`--permission-mode acceptEdits`); no shell, no network.
- **Provider switcher.** Claude and Codex both wired; a backend whose CLI isn't
  installed/runnable shows as unavailable. Conversations resume across turns
  (`--resume`) and are per-provider.
- **Script Studio.** The Script inspector's "Edit code" opens a full mode — the
  CodeMirror editor and the chat side by side, with the 3D scene still live in
  the left gutter. Select code and press ⌘K to ask about it (one-tap Explain /
  Fix / Comment / Improve). AI edits arrive as an **accept/reject diff**
  (`@codemirror/merge`) — nothing runs in the scene until you Accept; Discard
  reverts. The editor is frozen while the AI writes so buffer and disk can't
  diverge. The narrow chat drawer and the Studio are one component
  (`panels/AiPanel.tsx` + `panels/ai-store.ts` + `script/code-editor.tsx`), so
  the conversation follows you between them.

Wiring: `packages/desktop/src/ai.ts` (spawn + stream parsing) → IPC in
`main.ts`/`preload.ts` (`@dcl-editor/contract` `Ai*` types) → the
`packages/ui/src/panels/AiPanel.tsx` chat UI. The panel only appears in the
Electron shell (the renderer can't spawn processes).

---

## Sign in with Decentraland

The Home's **Account** section signs you in via the Decentraland auth deep-link
flow (as in decentraland/creator-hub): the app `POST`s a `dcl_personal_sign`
request to the auth server (→ a `requestId`), opens
`decentraland.org/auth/requests/<requestId>?targetConfigId=creator-hub&flow=deeplink&authRequestId=<nonce>`
in your **browser**, you log in there, and the auth dapp bounces back into the
app through a custom protocol (`<scheme>://open?signin=<identityId>`, echoing the
nonce). The app accepts only a callback echoing the nonce it generated (anti
session-fixation), then fetches the resulting self-contained **AuthIdentity**
(DCL AuthChain — no tokens) and stores it locally
(`@dcl/single-sign-on-client`); publishing will sign with it.

- Wiring: `packages/desktop/src/deeplink.ts` + protocol/single-instance
  handling in `main.ts` → `AUTH_SIGNIN_CHANNEL` push → `packages/ui/src/auth.ts`
  (request/fetch/store + `useAuth`) → the Account UI in `packages/ui/src/account.tsx`.
- The app reuses the Creator Hub's `targetConfigId=creator-hub`, whose
  bounce-back scheme is `dcl-creator-hub://` (registered by the desktop shell),
  so sign-in needs no change to the auth dapp. Caveat: if the standalone Creator
  Hub is installed, the OS may route that scheme to it instead; giving the editor
  its own `dcl-editor` targetConfig + scheme (a one-line PR to `decentraland/auth`)
  is the fix if that ever matters. See `TARGET_CONFIG_ID` in `packages/ui/src/auth.ts`.
- **Dev caveat (macOS):** an unpackaged `electron .` process has no bundle
  `Info.plist`, so macOS can't route `dcl-creator-hub://` to it — the browser
  lands on a bare Electron window instead, and the callback URL is never shown
  anywhere you could copy it. In dev the "Waiting for your browser" panel shows
  a **paste-the-link** box (gated by `isDev`); to actually capture the link, run
  `node scripts/dev-signin-shim.mjs` once — it registers a tiny applet that
  claims the scheme and copies the incoming URL to your clipboard. Approve in
  the browser → paste from clipboard into the DEV box. Undo with
  `node scripts/dev-signin-shim.mjs remove` (do remove it before testing a
  packaged build or the real Creator Hub — it steals their scheme).
- Packaged builds must declare the scheme in the app bundle (`CFBundleURLTypes`
  via the installer manifest / electron-builder `protocols`) so the OS delivers
  the callback natively — runtime `setAsDefaultProtocolClient` is not enough on
  macOS. There is no packaging setup in the repo yet.

---

## Worlds: publish & manage

Home has a **Worlds** tab, separate from Scenes on purpose: a world's content
is whatever was deployed to it last — from this editor, the CLI, or another
machine — so the tab is fetched **live** from the servers, never from local
state. Scenes link to worlds via `scene.json`'s `worldConfiguration.name`
(set automatically on publish): linked worlds show as a badge on scene cards,
and each world's detail lists the local scenes that publish to it.

- **Inventory**: your NAMEs (marketplace subgraph) + worlds you can deploy to
  as a collaborator (signed `GET /wallet/contribute`), enriched with the live
  deployment (`GET /world/{name}/scenes`), thumbnails/user counts (places API).
- **Management** (world detail, tabbed): deployment facts + jump-in, then
  **Permissions** (deployment/access/streaming allow-lists,
  `PUT`/`DELETE /world/{name}/permissions/...`, owner-only), **Streaming**
  (generate/reset/revoke the OBS key, comms-gatekeeper `/scene-stream-access`),
  **Moderation** (scene admins + bans, `/scene-admin` + `/scene-bans`, add by
  address or DCL name) and **Server storage** (env keys / shared data /
  per-player data, gated on the scene's `authoritativeMultiplayer` flag).
  Gatekeeper calls are scoped to the live deployment (sceneId + base parcel).
  The storage API's CORS allowlist rejects localhost origins, so only those
  calls relay through a host-pinned main-process forwarder (`storageFetch`) —
  the signing still happens in the renderer.
- **Publish** (scene card menu, in-editor topbar button, or world detail):
  main spawns the scene's own `sdk-commands deploy --no-browser --port N
  --target-content <worlds-content-server>` (`packages/desktop/src/publish.ts`);
  when its local linker server is up, the **renderer** acts as the linker dapp —
  it signs the entity id with the stored AuthIdentity and POSTs the auth chain
  to `localhost:N/api/deploy`, which uploads. Credentials never reach the main
  process or disk. Progress streams over `PUBLISH_EVENT_CHANNEL` into the modal
  (choose world → build → upload → jump in), with a raw-log drawer.
- Authenticated management calls are signed-fetch (ADR-44 `x-identity-*`
  headers), renderer-side, in `packages/ui/src/worlds.ts`.

---

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/SETUP.md`](./docs/SETUP.md) | New-engineer runbook: prerequisites, prebuilt engine from npm, first run. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | The four layers, the two seams, the unmodified-upstream-engine rule. |
| [`docs/STATE-ARCHITECTURE.md`](./docs/STATE-ARCHITECTURE.md) | The reactive store: `reactive()` + `useStore(selector)`, replace-on-write helpers, why it's hand-rolled (SDK7-safe). |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | Why it's built this way + operational gotchas (the "why" log). |
| [`docs/DEBUGGING.md`](./docs/DEBUGGING.md) | Bus tracing, logs, the boot watchdog, common failures. |
| [`docs/AI-AGENT.md`](./docs/AI-AGENT.md) | Driving/testing the editor with an AI agent + the e2e/CDP harness. |
| [`docs/TESTING.md`](./docs/TESTING.md) | `validate` vs `validate:e2e` vs unit tests; running subsets; writing tests. |
| [`docs/PRODUCTION-READINESS.md`](./docs/PRODUCTION-READINESS.md) | Handoff backlog: what's hardened, what remains (packaging, distribution). |
| [`docs/PREFABS-RESEARCH.md`](./docs/PREFABS-RESEARCH.md) | Prefabs & the **Script component**: research, toolchain revalidation, and the in-editor script authoring design (scripts are written/edited in-app; `@dcl/sdk-commands` runs them). |
| [`AGENTS.md`](./AGENTS.md) | The modify → build → validate loop and conventions (for agents + humans). |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) · [`MIGRATION.md`](./MIGRATION.md) · [`UPSTREAM-ALIGNMENT.md`](./UPSTREAM-ALIGNMENT.md) | Contribution flow · how we got here · upstream-engine positioning. |

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
