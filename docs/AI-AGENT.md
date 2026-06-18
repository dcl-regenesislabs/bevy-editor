# Driving the editor with an AI agent

The editor exposes a clean, typed automation surface: an AI agent (Claude Code,
the Anthropic API, or any script) can inspect and edit a scene by talking to the
same seams the UI uses — no private hooks. This doc covers (1) that surface and
how to drive it safely, and (2) the CDP end-to-end harness that already does this
for testing.

> The editor was deliberately built as *a privileged scene + a thin transport*,
> which is exactly what makes it automatable: every editing action is already a
> typed message or console command. There is **no MCP layer** — these are the
> native seams.

---

## Part 1 — The automation surface

### Two ways in

| Seam | From | Use it for |
|---|---|---|
| **Engine console commands** | the page (`window.engine_console_command_args`) or `window.__euiCmd` | direct, synchronous-feeling engine ops: snapshot the scene, set a component, create/delete entities, register content, freeze/unfreeze, reload |
| **Editor bus** | `sendToScene(msg)` / `sceneRpc(method, args)` | viewport-level intent the scene owns: selection, tool, camera, focus, and scene-computed values (e.g. `cameraDrop`) |

Both are typed in **`@dcl-editor/contract`** and wrapped so an agent never builds
raw strings.

### Typed commands (`makeCommands`)

`packages/scene/src/commands.ts` exposes `makeCommands(rawConsole)` — one typed
method per engine command, with parsed/typed returns. Two bound singletons:

- `packages/ui/src/cmd.ts` — bound to the engine console (use from the page/agent side)
- `packages/scene/src/cmd.ts` — bound to `BevyApi` (scene side)

```ts
import { cmd } from './cmd'

const snapshot = await cmd.crdtSnapshot()        // the whole scene as a typed Snapshot
const names    = await cmd.componentNames()      // available component types
await cmd.setComponent(entityId, 'Transform', json)
const [id]     = await cmd.newEntity(componentId, base64, 1)
await cmd.freezeScene(); await cmd.unfreezeScene()
await cmd.reload(hash)
```

From a browser-console / CDP context you can also call the raw transport directly:
`window.__euiCmd('crdt_snapshot')`.

### Bus RPC (`sceneRpc`)

For things the scene computes (it owns the live camera, selection, gizmos), use
the request/response channel:

```ts
import { sceneRpc, sendToScene } from './bus'

await sendToScene({ type: 'set-selection', selected: ['512'], active: '512' })
await sendToScene({ type: 'set-tool', tool: 'translate' })
const drop = await sceneRpc<{ x: number; y: number; z: number }>('cameraDrop')
```

The message unions (`PageToSceneMessage`, `SceneToPageMessage`) and the RPC method
set are the contract — read `packages/contract/src/bus-protocol.ts` and the scene
handler in `packages/scene/src/page-ui.ts`.

### What's safe to automate

- **Inspect freely.** `crdtSnapshot`, `componentNames`, `componentSchema`,
  `sceneStats`, `sceneContent` are read-only and cheap. Ground the agent in the
  current scene with these before mutating — don't dump the whole scene into a
  prompt; query what you need.
- **Mutations go through the editor's own paths**, which are **undo-backed** and
  honor the edit/play model: edits while *frozen* autosave to the composite; edits
  while *playing* are runtime-only and revert on Stop. Prefer the `ui/actions.ts`
  wrappers (`uiSetComponentValue`, `uiAddEntity`, …) over raw `setComponent` when
  driving the page, so selection sync, undo history, and autosave stay correct.
- **Gate the destructive ops.** `deleteEntity`, overwriting a script/component, and
  bulk edits should be confirmed before an autonomous agent runs them — the same
  boundary that makes the tool trustworthy for a human.
- **Don't fight the frozen/playing state.** Check `state.frozen` (`window.__eui`)
  first; a frozen scene's `/crdt_snapshot` is intentionally stale.

### A minimal agent loop (sketch)

An embedded assistant or external script is just a tool-use loop over the surface
above: expose `get_scene` (→ `crdtSnapshot`), `set_component`, `add_entity`,
`select`, `run_preview` (freeze/unfreeze) as tools whose handlers call `cmd.*` /
`sceneRpc`, then let the model plan. This is the path sketched in the project's
origin discussion; the transport already exists, so it's a thin adapter, not new
infrastructure. (An in-product assistant panel is a roadmap item — see
[`PRODUCTION-READINESS.md`](./PRODUCTION-READINESS.md).)

---

## Part 2 — The CDP end-to-end harness

`packages/desktop/validate/validate.mjs` is a Chrome-DevTools-Protocol harness
that launches the real Electron app and drives it like a user. It's both the
regression test and a worked example of agent-style control.

### Run it

```bash
npm run validate:e2e                       # build + full run, from the repo root
# or, for a subset / specific scene:
cd packages/desktop
node validate/validate.mjs --steps=boot,picker,engine,scene
BEVY_EDITOR_PROJECT=/path/to/scene node validate/validate.mjs
```

### What it checks (the steps)

`boot` → `picker` → `engine` → `scene` → `select` → `move` → `worldclick` →
`shortcut` → `tools` → `camera` → `selectbus` → `tooltip` → `assets` → `logs` → `home`:

| Step | Asserts | Driven by |
|---|---|---|
| `boot` | app process up + CDP reachable | CDP |
| `picker` | the React picker renders and is interactive | shadow-DOM hit-test |
| `engine` | the engine iframe answers console-RPC | `__euiCmd('/help')` |
| `scene` | the editor scene reaches "ready" | `__eui.status` |
| `select` | clicking the hierarchy selects an entity | shadow-DOM click |
| `move` | the avatar moves and reports its position | `/move_player_to` + `/player_position` (deterministic) |
| `worldclick` | clicking a model in the viewport selects it | engine pointer + `/pointer_target` |
| `shortcut` | a viewport-focused keystroke still drives a shortcut | CDP key → engine iframe → host forward |
| `tools` | W/E/R from the viewport switch the active tool | forwarded keys → `__eui.activeAction` |
| `camera` | the `` ` `` shortcut toggles the fly camera | forwarded key → `__eui.camMode` |
| `selectbus` | the page↔scene bus round-trips a selection | `editor_send` set-selection → `__eui.selected` |
| `tooltip` | hovering a `data-tip` control shows the custom tooltip | CDP hover → `.eui-tip` overlay |
| `assets` | the catalog loads (validates the `/opendcl` proxy end-to-end) | shadow-DOM + `__eui.assetCatalog` |
| `logs` | the logs drawer toggles and has content | shadow-DOM |
| `home` | the back-to-picker control works | shadow-DOM |

Exit code 0 = all requested steps passed. Screenshots/console artifacts land in
`packages/desktop/validate/artifacts/`.

**Prefer deterministic driving over synthetic input.** Real clicks/keys are
timing-flaky; reach for the engine's own commands and the editor bus first
(that's why `move` uses `/move_player_to` instead of holding W). Synthetic input
is only for the paths that *must* be exercised that way (e.g. `shortcut`/`tools`
verify that a key landing on the engine iframe still reaches the host).

### Requirements & caveats

- **A real GPU** — the engine is WebGPU; it can't run headless.
- **A test scene** via `BEVY_EDITOR_PROJECT` (any folder with a `scene.json`).
- **macOS/Linux** — it uses a few POSIX conveniences (`caffeinate` keeps the
  display awake on macOS so the frame clock doesn't suspend; guarded to darwin).
- **Timing-sensitive** — treat green as strong evidence, red as "investigate".
  The hard gate is `npm run validate` (typecheck + unit tests + build).

### The driver (build feature tests on this)

The harness has a small **DRIVER** layer (top of `validate.mjs`) of reusable
primitives, so a new feature test is a few lines, not CDP boilerplate. Build on
these rather than hand-rolling `Runtime.evaluate`:

| Primitive | What it does |
|---|---|
| `cmd(name, ...args)` | call ANY engine console command → reply string (e.g. `cmd('scene_tree')`) |
| `bus(msg)` | send a `PageToScene` editor bus message (tool/selection/camera/focus) |
| `getState(expr)` | read editor state; `s` is `window.__eui` (e.g. `getState('s.camMode')`) |
| `waitState(expr, ms)` | wait until a state expression is truthy |
| `movePlayerTo(x,y,z,[dur])` / `walkPlayerTo(...)` | drive the avatar deterministically |
| `playerPos()` | avatar position `[x,y,z]` (DCL coords) |
| `crdtSnapshot()` | the inspected scene's live CRDT (note: **stale while the scene is frozen** — verify editor writes via `__eui.snapshot` or unfreeze first) |
| `focusViewport()` | focus the engine canvas so dispatched keys/mouse target it |
| `pressKey(key, code, vk, mods?)` | dispatch a key (forwarded engine→host if the viewport is focused) |
| `expect(cond, msg)` | fail the step with a message |
| `sceneReady()` | gate a step on the editor having reached ready |

### The command catalog (what you can drive)

Anything `window.__euiCmd(name, args)` reaches — i.e. every engine console
command. The useful ones for tests:

- **Avatar (agent commands, bevy-explorer `agent_commands.rs`):** `move_player_to x y z [dur]`, `walk_player_to x y z [timeout]`, `player_position`, `teleport x y` (parcel), `emote urn`.
- **Inspect:** `crdt_snapshot`, `scene_tree`, `scene_entities`, `entity_components <id>`, `pointer_target [true]`, `scene_stats`, `scene_logs <n>`, `component_names`, `component_schema <Name>`.
- **Edit (super-user writes):** `set_component <id> <Name> <json>`, `delete_component <id> <Name>`, `new_entity <componentId> <base64> [count]`, `delete_entity <id> [-r]`, `save_composite <base64>`.
- **Scene control:** `freeze_scene`, `unfreeze_scene`, `tick_scene <n>`, `set_scene <hash>`, `reload [hash]`, `highlight <ids…>`.

The editor bus (`bus(msg)`) drives: `set-tool`, `set-selection`, `set-camera`,
`focus`, `set-flags`, `refresh` (see `packages/contract/src/bus-protocol.ts`).

### Adding a feature test

1. Add the step name to the default `STEPS` array.
2. Add a guarded block: `if (STEPS.includes('myfeature') && sceneReady()) { try { … record('myfeature', ok, detail) } catch (e) { record('myfeature', false, e.message) } }`.
3. **Drive it deterministically** (a `cmd`/`bus`, not a click) and **assert on ground truth** (`getState(...)`, `crdtSnapshot()`, a command reply). Use `waitFor`/`waitState` for anything async.
4. Keep it **non-destructive** (revert writes) and **independent** (don't rely on a prior step's leftover state).

Gotchas worth knowing: `select` (`Q`) is a *toggle*; `crdt_snapshot` is stale
while frozen (the editor mirrors writes page-side over the bus); tool letters are
suppressed while a navigation camera owns WASD (set `camMode='none'` first).
