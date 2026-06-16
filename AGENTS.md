# AGENTS.md — working in dcl-editor

This file is the playbook for an automated agent (or a new contributor) handed a
feature request — e.g. from Slack: *"add a duplicate-with-children button to the
hierarchy"* or *"make the gizmo snap to a grid"*. It tells you **where things
live, how to make the change, and how to prove you didn't break anything.**

Read [`README.md`](./README.md) first for the architecture. This file is the how-to.

---

## The loop

```
1. LOCATE   → decide which package the change belongs in (table below)
2. MODIFY   → make the change, following the conventions below
3. BUILD    → npm run build        (scene → ui → desktop)
4. VALIDATE → npm run validate     (typecheck + build; the gate — must pass)
5. (deep)   → npm run validate:e2e (optional: launches the app, drives it)
6. REPORT   → summarize what changed + the validation result
```

**`npm run validate` is the contract.** It type-checks every package and runs the
full build. If it passes, the change is structurally sound. Never report a change
as done without it passing.

---

## Where does my change go?

| The feature is about… | Edit in | Notes |
|---|---|---|
| A panel, button, dialog, layout, styling, the toolbar, asset catalog | `packages/ui/src` | React + TypeScript. Styles in `src/styles.ts`. Panels in `src/panels/`. Actions in `src/actions.ts`. |
| Selection, gizmos, world-click picking, overlays, the free camera, transform math | `packages/scene/src` | Runs *inside* the engine as an SDK7 scene. Engine input via `inputSystem`/`PrimaryPointerInfo`. |
| Reading/writing the edited scene's entities (components, save, undo) | `packages/scene/src/inspector.ts` (+ `state.ts`) | The CRDT bridge + composite save live here; the UI calls these via `packages/ui/src/actions.ts`. |
| A new message between the UI and the scene | `packages/contract/src/bus-protocol.ts` **and** `packages/scene/src/bridge-protocol.ts` | ⚠️ Two copies — see "Keep the bus in sync" below. Handle it in `scene/src/page-ui.ts`; send it from `ui/src/`. |
| Project picker, scene dev-servers, window/menu, IPC | `packages/desktop/src` | Electron main process (`main.ts`), preload bridge (`preload.ts`), server lifecycle (`servers.ts`). |
| A new Electron IPC method exposed to the page | `packages/contract/src/shell.ts` (`EditorShell`) + `packages/desktop/src/{main.ts,preload.ts}` + consume in `packages/ui/src` | `contract` is the single source of truth for this type. |
| Engine behavior (raycast, rendering, new console command) | the **external** `bevy-explorer` checkout, behind `#[cfg(feature="editor")]` | Slow wasm rebuild. Avoid unless the editor genuinely needs an engine capability. |

---

## Conventions (enforced — violating these fails review)

- **No dynamic `import()`** — static `import` at top of file only. (Exception: `React.lazy`.)
- **No `as any`** — use precise types, generics, or `unknown` + narrowing.
- **Sparse comments** — only explain non-obvious *why* (a gotcha, constraint,
  workaround). Don't narrate code.
- **Keep the bus in sync** — the editor bus protocol exists in BOTH
  `packages/contract/src/bus-protocol.ts` (source of truth, imported by ui +
  desktop) and `packages/scene/src/bridge-protocol.ts` (self-contained because the
  scene is bundled by `sdk-commands`). A message-shape change in one MUST be
  mirrored in the other. The scene file has a ⚠️ banner reminding you.
- **Edit vs play save model** — edits while the scene is *paused* (edit mode,
  `state.frozen`) autosave to `main.composite`; edits while *playing* are runtime
  only and revert on Stop (Unity-style). Don't persist runtime state. See
  `packages/ui/src/autosave.ts`.

---

## Validation in depth

### `npm run validate` — the gate (always run this)
Type-checks all packages and runs the full build (`scene → ui → desktop`).
Deterministic, ~30–60s, no engine or Electron needed. Output ends in
`✅ ALL CHECKS PASSED` or `❌ VALIDATION FAILED` with a per-step summary.

### `npm run validate:e2e` — runtime check (when behavior matters)
`packages/desktop/validate/validate.mjs` launches the desktop app with Chrome
DevTools Protocol enabled, opens a scene, and drives it like a user (boot →
engine → scene load → select → move → world-click → assets → logs), capturing
screenshots to `packages/desktop/validate/artifacts/`.

- Point it at a scene with `BEVY_EDITOR_PROJECT=/path/to/some/dcl-scene`
  (default: a `towerofmadness` sibling of the repo). Any folder with a
  `scene.json` works.
- Run a subset: `node packages/desktop/validate/validate.mjs --steps=boot,picker,engine,scene`.
- Targeted harnesses also exist: `gizmo-test.mjs` (gizmo visibility + click-to-
  select + switch-select), `assets-test.mjs` (catalog + local-model import),
  `recovery-test.mjs` (IndexedDB-wedge recovery).
- **It needs a real GPU/WebGPU and is sensitive to timing** — treat a green run
  as strong evidence and a red run as "investigate", not as a flaky-free oracle.
  The `validate` gate is the hard requirement; e2e is corroboration.

---

## Gotchas worth knowing

- **Engine web build must exist** at `bevy-explorer/deploy/web/` and be built
  `--features editor`, or the UI has nothing to attach to. The UI build *writes
  into* that directory.
- **Main-process changes need a full relaunch** — Cmd+R only reloads the page.
- **Boot wedge**: a corrupt IndexedDB makes the engine hang at "logging-in"; the
  app has a 40s watchdog that clears storage and reloads. The e2e harness clears
  it pre-launch.
- **The scene is privileged** ("super-user") so it can read/write other scenes'
  CRDT — that capability is engine-side and editor-feature-gated.

---

## Reporting back

When done, report: (1) what changed and which package(s); (2) the `npm run
validate` result (paste the summary line); (3) anything you couldn't verify
(e.g. "behavior needs a manual e2e run with a real scene"). Be honest about what
was and wasn't tested.
