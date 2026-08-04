# Refactor plan — structure audit, 2026-08-04

> **Status: all five phases done.** Every god file is retired
> (`scripts/lint-allowlist.mjs` is down to one entry, `viewport/gizmo.ts`), the
> lint gate is the first step of `npm run validate`, the `src/` root is folded
> into `engine/ core/ actions/ boot/`, and the whole gate is green.
>
> **Known debt, deliberately left:**
> - Two layer back-edges eslint can't yet ban: `engine/scene-ui.ts` imports
>   `core/{store,history}`, and `core/autosave.ts` imports `panels/authored-ids`
>   + `features/editor/scene-health`. Both are single files; closing them means
>   deciding whether scene-ui is really core and whether autosave's panel
>   dependencies can be inverted via a callback.
> - `packages/scene/src/viewport/gizmo.ts` (839 lines) is the last allowlisted
>   file. It is cohesive — drag orchestration on top of tested pure modules — so
>   it is a lower-value split than the ones already done.
> - The scene and desktop refactors are verified by tsc, eslint, unit tests and
>   the build, but NOT by running the app. Before merging, launch it and exercise
>   Play/Pause, a gizmo drag, save, undo/redo, publish, and the AI assistant.

Outcome of a full structural audit (6 scope-isolated auditors + adversarial
verification of every high-severity claim). Verdict: **no architectural
refactor**. The layering (contract → scene ↔ ui, desktop shell), the
`reactive()` store, the bus discipline, and the ds-contract enforcement
pattern stay as they are. The debt is concentrated: five god files and a
missing enforcement layer. Five phases, each independently shippable.

Guiding rule for everything below (generalized from `ds-contract.test.ts`,
which exists because prose rules drifted until a test made them fail builds):
**every STRICT convention ships with its guard in the same PR.**

---

## Phase 1 — Guardrails (this brief is execution-ready)

Goal: make the conventions AGENTS.md already calls "enforced" actually fail
the build, and stop the known contract drift. No behavior changes. Everything
lands in one PR gated by `npm run validate`.

### 1. Root ESLint flat config

There is currently **no eslint/prettier config anywhere in the repo** (the
scene package's `lint` script fails outright — no config file). Add
`eslint.config.mjs` at the repo root using ESLint 9 + the `typescript-eslint`
meta-package, covering `packages/*/src/**/*.{ts,tsx}`.

- Syntax-level linting only — do **not** enable type-aware rules in this
  phase (they need per-package project wiring and slow the gate; tsc already
  runs in validate).
- Ignores: `**/node_modules`, `**/dist`, `packages/desktop/{staging,release,build,templates,.node-cache}`,
  `packages/scene/bin`. (`staging`/`release` are generated packaging output —
  vitest.config.ts already excludes them for the same reason.)
- Rules:
  - `@typescript-eslint/no-explicit-any`: error. This also catches `as any`.
    One existing violation: `packages/scene/src/bevy-api/index.ts:8` — fix it
    properly if cheap, otherwise a line-disable with a why-comment.
  - `no-restricted-syntax` banning `ImportExpression` (dynamic `import()`),
    message pointing to the static-import convention. One existing runtime
    violation: `packages/scene/src/camera/camera-projection.ts:25` (a ~system
    module that may genuinely need it) — line-disable with rationale.
    `desktop/src/updater.ts:308` is a type-position `import()` and won't be
    flagged.
  - `max-lines`: warn at 500, error at 800 (`skipBlankLines: false`,
    `skipComments: false` — raw wc parity keeps it predictable).
  - Per-file overrides relaxing `max-lines` for the current >800 offenders
    (shrink-only allowlist): `packages/ui/src/panels/AiPanel.tsx` (1294),
    `packages/scene/src/inspector.ts` (1259), `packages/desktop/src/main.ts`
    (960), `packages/scene/src/viewport/gizmo.ts` (839). Cap each override at
    its current line count so the file can only shrink.
- Staleness guard, modeled on ds-contract's shrink-only `ALLOWED_LEGACY`: a
  small vitest file asserting each allowlisted file still exceeds 800 lines,
  so a fixed file whose override lingers fails the build. Place it so the
  root vitest include (`packages/**/src/**/*.test.ts`) picks it up — e.g.
  `packages/ui/src/lint-allowlist.test.ts` reading the shared allowlist from
  one module both the eslint config and the test import.
- Defer import-boundary rules (layer direction, deep-import bans) to phase 2
  — they belong with the `scene/src/api.ts` barrel so there's a legal path
  before the ban.

### 2. Clean up the scene package's dead lint tooling

`packages/scene/package.json` has `lint`/`lint:fix` scripts that fail when
run, plus 8 unused devDependencies from the SDK scene template: `eslint@^8`,
`@typescript-eslint/{parser,eslint-plugin}@^6`, `eslint-config-prettier`,
`eslint-config-standard-with-typescript`, `eslint-plugin-{import,n,react}`,
`prettier@3.0.3`. Delete the two scripts and all 8 deps (eslint 8 would also
conflict with the root eslint 9 install). The scene is linted by the root
config like every other package.

### 3. Extend tsconfig.base.json to ui and desktop

Only `packages/contract` extends `tsconfig.base.json` today; ui and desktop
restate strictness inline and have already drifted (ui dropped
`forceConsistentCasingInFileNames`). Make `packages/ui/tsconfig.json` and
`packages/desktop/tsconfig.json` extend `../../tsconfig.base.json`,
overriding only what genuinely differs (desktop: target/module/lib/types for
Node/CJS; ui: bundler/noEmit settings). `packages/scene` stays on the SDK's
`tsconfig.ecs7.json` (sdk-commands requires it) but should restate the base's
strict flags explicitly. `npm run typecheck` must stay green — if extending
surfaces new errors, fix the code, don't loosen the base.

### 4. `satisfies EditorShell` in preload

`packages/desktop/src/preload.ts:11` exposes a bare object literal, so tsc
never checks it against the contract, and it has already drifted:
`onServersReady` (preload.ts:48) and `requestReady` declare an inline
3-field payload while `ServersReady` (`packages/contract/src/shell.ts:21-27`)
— and what main.ts actually sends — has 5 fields (`spawn`, `spawnPoints`).

Build the object as a named const checked against the contract
(`const shell = {...} satisfies EditorShell`) before
`exposeInMainWorld('editorShell', shell)`, and replace inline payload types
with imports from `@dcl-editor/contract`. Fix any further drift `satisfies`
surfaces — the contract is the source of truth. Do **not** mass-edit the
optionality of EditorShell members in this pass (separate, later decision).

### 5. Wire lint into the gate

- Root `package.json`: add `"lint": "eslint ."`.
- `scripts/validate.mjs`: add `{ name: 'lint (eslint)', cmd: 'npm', args: ['run', 'lint'] }`
  as the **first** step (fastest feedback; the steps array short-circuits).
- CI needs no change — both workflows already run `npm run validate`.

### Acceptance

- `npm run validate` passes end-to-end (lint → typecheck → vitest → build).
- `npx eslint .` from a clean checkout reports 0 errors; warnings only from
  the 500-line soft ceiling.
- Deleting a line-count override for a still-large file fails lint; shrinking
  a file below 800 and leaving its override fails the staleness test.
- `git grep "as any" -- packages/*/src` shows no undisabled occurrences.
- `npm run lint -w @dcl-editor/scene` no longer exists.

---

## Phase 2 — Seams (do before any god-file split)

- `packages/scene/src/api.ts` barrel re-exporting the ~dozen modules the UI
  actually uses (64 UI files deep-import `../../scene/src/*` today; histogram:
  state 51, custom-components 16, inspector 15, allowed-components 12).
  Add a `@scene/*` tsconfig+vite alias, migrate imports mechanically, then
  lint-ban deep imports (`no-restricted-imports`).
- Make the vite shim map fail loud: `packages/ui/vite.config.ts` redirects 5
  scene modules by basename (`bevy-api`, `utils`, `login`, `current-scene`,
  `boot-trace`); a rename today silently bundles the engine module. Add a
  startup assertion that every redirect key matches an existing scene file.
- Pure-deletion pass in scene state: `state.pageUi` is never false — remove
  the 7 dead fields (`addComponentOpen`, `addComponentFilter`,
  `newEntityName`, `assetPickerOpen`, `assetFilter`, `hoveredDelete`,
  `parentConfirm`, at state.ts:87-115) and the unreachable `!pageUi` branches
  in `play-hud.ts`, `viewport/overlay.tsx`, `system-actions.ts`.
- CONVENTIONS.md: document the src-root layering (engine-bridge / boot /
  core), the `panels/` vs `features/` split, and the `*-web.ts` shim pattern.
  Import-boundary lint rules land here: ds → lib → panels/features → entry;
  only actions and boot.ts may import bus.ts.

## Phase 3 — God files, UI

- **AiPanel.tsx (1294)**: finish the extraction already started in
  `features/ai/`. Split out `ai/context.ts` (pure prompt-context assembly,
  lines 229-325), `features/ai/markdown.tsx` (327-394), `features/ai/activity.tsx`
  (106-202), `features/ai/ModelMenu.tsx` (420-486), icons into `src/icons`;
  then Chat + StudioShell, leaving AiPanel a ~300-line mode switch. Move
  transcript/busy/provider state into `ai-store.ts` to retire the documented
  never-unmount invariant (header comment, lines 4-8).
- **actions.ts (743, 44 exports, 15 importers)**: split into `actions/`
  by domain (selection, playback, entities, prefabs, assets) with an index
  re-export for incremental migration. The entities module should absorb the
  history.ts setter-injection cycle hack (history.ts:168-178).
- **worlds.ts (779, 46 exports)**: directory-ize into `features/worlds/`
  (endpoints / signed-fetch / inventory / gatekeeper / storage); publish
  state machine moves next to its only consumer as
  `features/publish/publish-flow.ts`; `formatBytes`/`formatAgo` to
  `lib/format.ts`. `auth.ts` → `features/account/auth.ts`.

## Phase 4 — God files, shell & scene

- **desktop/main.ts (960)**: extract `projects.ts` first (Home CRUD,
  lines 451-614 + projectInfo 281-319 — largest and least Electron-coupled);
  fold instance-lock/deep-link handoff (80-196) into `deeplink.ts`; then
  `menu.ts`/`chords.ts`; register the 48 IPC handlers via per-feature
  `registerXxxIpc(deps)` functions taking `{win, cfg, log}` explicitly.
  Keep each security guard (host-pinned storage-fetch, https-only
  open-external) physically adjacent to its handler when it moves.
- **scene/inspector.ts (1259)**: split along its existing section comments —
  boot/retry (60-222), transport (226-345), entity-ops (605-841, 1079-1243),
  save pipeline (892-990) — keeping `inspector.ts` as a thin re-export so the
  15 UI import sites don't churn (moot if phase 2's barrel landed first).

## Phase 5 — Tests & polish (opportunistic)

- `updater.test.ts` for `parseFeed`/`isNewer` (updater.ts:191-214 — pure,
  and a wrong answer bricks auto-update) and `ai.test.ts` feeding recorded
  claude/codex NDJSON through the two `parseLine` parsers (ai.ts:230-317).
- `ds/ContextMenu` owning outside-close/Escape/clamping; migrate the 5
  hand-rolled call sites (HierarchyPanel, Prefabs, SceneTopbar, SceneCard,
  account).
- Fold the ui/src root clusters into `engine/`, `boot/`, `core/` per the
  phase-2 CONVENTIONS.md layering.
- Rename panels/properties.tsx's scrubbing `NumberField` (collides with ds
  `NumberField`); split properties.tsx (fields / schema-editor / shape-editor /
  transform-editor + tested `lib/euler.ts`); extract Prefabs.tsx's shared
  widgets (`PrefabMark`, `PrefabUpdateBadge`, `PrefabInstanceStrip`) so other
  panels stop importing the panel.
- Either bless or migrate the manual-`notify()` pattern (history, autosave,
  boot, reveal) — STATE-ARCHITECTURE.md currently says it doesn't exist.
