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
4. VALIDATE → npm run validate     (typecheck + unit tests + build; the gate — must pass)
5. RUNTIME  → npm run validate:e2e (run it whenever behavior could change; 10/10 expected)
6. REPORT   → summarize what changed + the validation result
```

**`npm run validate` is the contract.** It type-checks every package, runs the
unit tests, and runs the full build. If it passes, the change is structurally
sound. Never report a change as done without it passing.

The e2e harness in step 5 is **not optional busywork** — if your change touches
runtime behavior (anything a user clicks or sees), run it and expect a green
10/10. It only gets skipped when the environment genuinely can't run it (no
GPU/scene); say so explicitly when you skip it.

---

## Where does my change go?

| The feature is about… | Edit in | Notes |
|---|---|---|
| A panel, button, dialog, layout, styling, the toolbar, asset catalog | `packages/ui/src` | React + TypeScript. Styles in `src/styles.ts`. Panels in `src/panels/`. Actions in `src/actions.ts`. |
| Selection, gizmos, world-click picking, overlays, the free camera, transform math | `packages/scene/src` | Runs *inside* the engine as an SDK7 scene. Engine input via `inputSystem`/`PrimaryPointerInfo`. |
| Reading/writing the edited scene's entities (components, save, undo) | `packages/scene/src/inspector.ts` (+ `state.ts`) | The CRDT bridge + composite save live here; the UI calls these via `packages/ui/src/actions.ts`. |
| A new message between the UI and the scene | `packages/contract/src/bus-protocol.ts` (single source of truth) | The scene re-exports it via `bridge-protocol.ts`, so you edit the type **once**. Handle it in `scene/src/page-ui.ts`; send it from `ui/src/`. |
| Project picker, scene dev-servers, window/menu, IPC | `packages/desktop/src` | Electron main process (`main.ts`), preload bridge (`preload.ts`), server lifecycle (`servers.ts`). |
| A new Electron IPC method exposed to the page | `packages/contract/src/shell.ts` (`EditorShell`) + `packages/desktop/src/{main.ts,preload.ts}` + consume in `packages/ui/src` | `contract` is the single source of truth for this type. |
| Engine behavior | **Don't.** The editor runs on **stock upstream** `bevy-explorer` (the `@dcl-regenesislabs/bevy-explorer-web` npm package) — no fork, no patches. Implement what you need **scene-side** in `packages/scene/src` with upstream-only SDK7 APIs (Raycast, TextureCamera/CameraLayer, `/scene_content`, CRDT). | If something seems to need an engine change, it almost certainly doesn't — find the scene-side way first. |

---

## Conventions (enforced — violating these fails review)

- **No dynamic `import()`** — static `import` at top of file only. (Exception: `React.lazy`.)
- **No `as any`** — use precise types, generics, or `unknown` + narrowing.
- **Sparse comments** — only explain non-obvious *why* (a gotcha, constraint,
  workaround). Don't narrate code.
- **One bus protocol, in `@dcl-editor/contract`** — `bus-protocol.ts` is the
  single source of truth. The scene's `bridge-protocol.ts` is just
  `export * from '@dcl-editor/contract'` (we confirmed `sdk-commands` bundles the
  workspace import fine), so a message-shape change is made **once**, in contract
  — no mirroring. Don't reintroduce a second copy.
- **Don't swallow errors** — log through the namespaced logger (`log.ts` in scene
  and ui), not an empty `.catch(() => {})`. `warn`/`error` always print; `debug`
  is gated by `?editorDebug`.
- **Edit vs play save model** — edits while the scene is *paused* (edit mode,
  `state.frozen`) autosave to `main.composite`; edits while *playing* are runtime
  only and revert on Stop (Unity-style). Don't persist runtime state. See
  `packages/ui/src/autosave.ts`.
- **State & re-renders** — write with `state.x = y` (auto-notifies, no `bump()`);
  read in a component with `useStore(() => state.x)` (one per slice; selector must
  return a stable raw value). Sets/Maps and the snapshot are written through
  replace-on-write helpers in `state.ts` — **never** `state.selected.add(...)` or
  `state.snapshot[id][name] = ...` (those don't re-render). Don't pull
  browser-only deps into `state.ts`/`reactive.ts` (they ship in the SDK7 scene).
  Full rules: [`docs/STATE-ARCHITECTURE.md`](./docs/STATE-ARCHITECTURE.md).

---

## Validation in depth

### `npm run validate` — the gate (always run this)
Type-checks all packages, runs the **unit tests** (`vitest`), and runs the full
build (`scene → ui → desktop`). Deterministic, ~30–60s, no engine or Electron
needed. Output ends in `✅ ALL CHECKS PASSED` or `❌ VALIDATION FAILED` with a
per-step summary. (`npm test` runs just the unit tests — see [`docs/TESTING.md`](./docs/TESTING.md).)

### `npm run validate:e2e` — runtime check (when behavior matters)
`packages/desktop/validate/validate.mjs` launches the desktop app with Chrome
DevTools Protocol enabled, opens a scene, and drives it like a user (boot →
picker → engine → scene → select → move → world-click → assets → logs → home),
capturing screenshots to `packages/desktop/validate/artifacts/`.

- Point it at a scene with `BEVY_EDITOR_PROJECT=/path/to/some/dcl-scene`
  (default: a `towerofmadness` sibling of the repo). Any folder with a
  `scene.json` works. Leave it **unset** to let the harness drive the picker
  (setting it makes the app auto-open the project and bypass the picker step).
- Run a subset: `node packages/desktop/validate/validate.mjs --steps=boot,picker,engine,scene`.
- **It needs a real GPU/WebGPU and is sensitive to timing** — treat a green run
  as strong evidence and a red run as "investigate", not as a flaky-free oracle.
  The `validate` gate is the hard requirement; e2e is corroboration.
  See [`docs/AI-AGENT.md`](./docs/AI-AGENT.md) for the step-by-step reference.

---

## Gotchas worth knowing

- **Engine web build must be resolvable**, or the UI has nothing to attach to. It
  comes from the `@dcl-regenesislabs/bevy-explorer-web` npm package after
  `npm install` (no build step). Resolution order: `BEVY_WEB_DIR` env → installed
  npm package → `../bevy-explorer/deploy/web` sibling fallback. The UI itself
  builds into `packages/ui/dist`; the desktop server serves both dirs same-origin.
- **Main-process changes need a full relaunch** — Cmd+R only reloads the page.
- **Boot wedge**: a corrupt IndexedDB makes the engine hang at "logging-in"; the
  app has a 40s watchdog that clears storage and reloads. The e2e harness clears
  it pre-launch.
- **The scene is privileged** ("super-user") so it can read/write other scenes'
  CRDT and use the full SDK7 surface — this is a stock upstream capability (the
  system UI scene uses it too); the editor needs no engine changes to exploit it.

---

## Reporting back

When done, report: (1) what changed and which package(s); (2) the `npm run
validate` result (paste the summary line); (3) anything you couldn't verify
(e.g. "behavior needs a manual e2e run with a real scene"). Be honest about what
was and wasn't tested.
