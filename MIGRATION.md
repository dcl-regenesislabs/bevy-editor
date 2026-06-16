# Monorepo migration — status & steps

> ✅ **CUTOVER COMPLETE (2026-06-15). This monorepo is now the SOURCE OF TRUTH.**
> The full editor (scene + ui + desktop) was synced from the originals at their
> latest state, wired to `@dcl-editor/contract`, and the whole tree builds and
> type-checks from the root (`npm install && npm run build`). The original repos
> `../editor-scene` and `../bevy-editor-app` are now LEGACY — keep them for git
> history if you like, but all new work happens here. The engine
> (`../bevy-explorer`) remains EXTERNAL (consumed as a prebuilt wasm web bundle).
>
> The bus protocol lives ONCE in `@dcl-editor/contract` and is consumed by all
> three packages — including the scene (`bridge-protocol.ts` just re-exports it;
> `sdk-commands` bundles the workspace import fine since contract is pure types).
> No duplication.

Consolidating the two repos we own (`editor-scene`, `bevy-editor-app`) into this
workspace. `bevy-explorer` (the engine) stays EXTERNAL — we don't own it — and is
consumed as a wasm build (built with `--features editor`).

Target layout:
```
dcl-editor/
  packages/
    contract/   shared types: bus protocol + Electron IPC shell      ✅ DONE
    scene/      SDK7 in-engine agent (from editor-scene/src)          ⬜ TODO
    ui/         React panels + orchestration (from editor-scene/web-ui) ⬜ TODO
    desktop/    Electron shell (from bevy-editor-app)                 ⬜ TODO
  engine → ../bevy-explorer (external)
```

## Steps (each must leave a building tree)

- [x] **0. Engine isolation** — `editor` cargo feature in `bevy-explorer` gates all
  editor-only engine code (`scene_inspector` plugin, `mark_super_scene_overlay`,
  `editor_disable_dof`). Prod compiles with no editor code. (in `bevy-explorer`)
- [x] **1. Scaffold + `contract`** — workspace root, `@dcl-editor/contract` with
  `bus-protocol.ts` (was `editor-scene/src/bridge-protocol.ts`) and `shell.ts`
  (the `EditorShell`/`ProjectInfo` that were duplicated across the desktop app).
- [~] **2. `desktop`** — DONE: moved `bevy-editor-app` → `packages/desktop`,
  renamed to `@dcl-editor/desktop`, depends on `@dcl-editor/contract`, `main.ts`
  imports the shared `ProjectInfo`, `config.ts` `guessSibling` now walks up to
  find the (still in-place) `bevy-explorer`/`editor-scene` siblings, `build:ui`
  repointed. Remaining: have `preload.ts` type against `EditorShell`; verify the
  full `npm run build` (esbuild + build:ui) once `ui` moves. (The old
  `bevy-editor-app/` dir can be removed once this is confirmed running.)
- [x] **3. `ui`** — DONE: `editor-scene/web-ui` → `packages/ui`; `build.mjs`
  bundles `packages/ui/src` + `packages/scene/src`, output → `bevy-explorer/deploy/web`;
  `main-embed.tsx` local `EditorShell`/`ServersReady`/`ProjectInfo`/`HostState`
  decls replaced with `@dcl-editor/contract` imports. Builds + typechecks.
- [x] **4. `scene`** — DONE: `editor-scene/src` → `packages/scene/src`;
  `sdk-commands build` produces `bin/index.js` + typechecks. `bridge-protocol.ts`
  re-exports `@dcl-editor/contract` (no duplicate) — `sdk-commands` bundles the
  workspace import fine since contract is pure types.
- [~] **5. Cross-package seams** — PARTIAL: `ui` imports `scene` via relative
  paths (`../../scene/src/*`), which works for both esbuild and tsc with no extra
  config. The cleaner `packages/scene/src/api.ts` barrel + deep-import lint, and a
  formal `EngineTransport` abstraction, are still TODO (nice-to-have, not blocking).
- [x] **6. Build orchestration** — DONE: root `npm run build` runs scene → ui →
  desktop; `npm run typecheck` covers all packages; `npm start` builds + launches
  the desktop app. `npm run validate` builds + runs the e2e harness.

## Drift to reconcile at cutover

Since the migration paused, the originals kept changing while this scaffold did
not. At cutover, re-copy the final code and fold these into `@dcl-editor/contract`
(then delete the duplicated decls in the originals). Append any new drift here as
it happens — every cross-process type change made in the originals belongs in
`contract` eventually.

- **`contract/src/bus-protocol.ts` — `focus` message.** Live
  (`editor-scene/src/bridge-protocol.ts`) is `{ type: 'focus'; entity: string;
  orbit?: boolean }`; contract still has `{ entity }`. The `orbit` flag (added
  2026-06-15) distinguishes import/place framing (`orbit:false`, frame once in
  free cam) from explicit hierarchy Focus (orbit-lock). Reconcile both the type
  and the `page-ui.ts` focus handler.
- **`contract/src/shell.ts` — `EditorShell`.** Live (`bevy-editor-app/src/preload.ts`
  + `web-ui/src/main-embed.tsx`) added `requestReady(): Promise<ServersReady |
  null>` (2026-06-15, Cmd+R reload fix: pull the cached ready payload on remount
  since the `servers-ready` push doesn't re-fire). Add it to `EditorShell` here.

## Decisions

- Engine stays external & feature-gated (see `editor-scene/ARCHITECTURE.md`).
- The editor scene is KEPT but shrinks to the in-engine agent (gizmos/markers/
  overlays + thin CRDT bridge); data orchestration/schema/save move toward `ui`.
- One UI codebase, two entry adapters (in-world same-window vs electron iframe),
  differing only at the `EngineTransport` seam.
