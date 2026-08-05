# runtime-modules

Master copies of the multiplayer helper modules that **prefabs carry into
scenes**. This folder is not a library scenes depend on and is never vendored
into templates wholesale — a blank scene ships zero runtime code.

The model (same as the seat prefabs' `ui-owner.ts`):

- Each built-in prefab's scripts import the specific modules they need with
  relative paths. When the prefab is instantiated, those module files are
  copied into the scene next to the prefab's scripts.
- Identical files already present in the scene are reused, not duplicated —
  two prefabs share one copy, so modules cannot drift *within* a scene.
- A bug fix lands here and reaches scenes through the normal prefab-update
  path. Blast radius of a change = scenes using a prefab that carries the
  module, never "every scene".

Rules for modules in this folder:

- Small, single-purpose files; no barrel exports (a barrel drags unused
  modules — and their module-scope side effects like `registerMessages` —
  into every bundle).
- `pure/` holds SDK-free logic, unit-tested from
  `packages/desktop/src/runtime-pure.test.ts`. SDK-bound modules are
  compile-verified by the scene harness against the pinned auth-server SDK.
- Extracted from shipped games: `timeSync` (Tower of Madness), `playerStore`
  (Dead Surge), `rng` (DCL-Hazards-POC), `spawner` / `outcomes` (Dead Surge's
  wave planner and validated-request path).
- A module that must run on the auth server calls `isServer()` and says so in
  its header. `serverState` throws when it is constructed on a client, and
  `markServerReady()` is what arms the heartbeat — a server branch that never
  calls it leaves every client in `waking` forever.
- A module's header comment is the ONE home for its API: carried copies are
  byte-identical by test, so `scripts/runtime/<module>.ts` in any prefab folder
  is literally the same text. Prefab `ai.md` guides link to it and never restate
  signatures (`.claude/skills/add-builtin-prefab/SKILL.md`).
- Carried copies are produced by `node scripts/sync-runtime-modules.mjs` and
  never by hand; `--check` fails when one has drifted. Adding an import to a
  master changes what every prefab carrying it ships, so re-run the sync in the
  same commit.

## What is here

| Module | What it owns |
|---|---|
| `timeSync` | one clock: server time, offset, readiness |
| `schedule` | `interval` / `after` systems, and the phase helpers over `pure/phase.ts` |
| `rng` | seeded draws, and the draw-order invariant that makes them agree across clients |
| `rpc` | request/response over the message bus; `createRpc` at module scope only |
| `playerStore` | per-wallet `Storage.player` rows, schema-versioned, debounced flush |
| `playerPositions` | the client-side roster |
| `serverLife` | the heartbeat and the `waking / running / degraded / asleep / unreachable` ladder |
| `serverState` | server-private state with opt-in `Storage` persistence; throws on a client |
| `protectedSync` | `create + syncEntity + validateBeforeChange` in one call, plus the observed-authority ledger |
| `spawner` | the clone runner: pools, plans, per-player clones — a shadow copy of the SDK's `runtime-script.js` (see below) |
| `outcomes` | the sequenced, server-validated gameplay-event ledger |
| `zoneBus` | trigger-zone membership, keyed by entity Name |

`spawner.ts` reproduces `node_modules/@dcl/sdk-commands/dist/logic/runtime-script.js`
so a clone's scripts start exactly the way a placed entity's do. That file is
pinned per-commit and moves without notice, which is why
`packages/desktop/validate/probe-script-runner.mjs` fingerprints it: a
fingerprint failure is never fixed by updating the hash — re-verify `spawner.ts`
against the new runner first, then update both in one commit.

`engine.addSystem(fn, priority)` sorts **descending**, so priority `-100` runs
LAST among update systems, not first. Neither `start()` nor `update()` ordering
is load-bearing anywhere here: the generated `spawnables.ts` calls
`registerSpawnables()` at module scope, and module bodies all run before the
first script starts.

## Claimed names

Every versioned key a module or kit prefab defines, and who defines it. A prefab
carrying a module that defines one lists it in its `ai.md` `claims-globals:`.

| Key | Defined by |
|---|---|
| `__dclZoneBus_v1` | `zoneBus.ts` |
| `__dclSpawner_v1` | `spawner.ts` — snapshots and live pools |
| `__dclOutcomes_v1` | `outcomes.ts` — ledgers and the one wired rpc instance |
| `__dclProtectedSync_v1` | `protectedSync.ts` — the protected-registration ledger |
| `__dclServerState_v1` | `serverState.ts` — store-key claims |
| `__dclPlayerStoreKeys_v1` | `playerStore.ts` — store-key claims |
| `__dclGameConfig_v1` | the generated `src/scripts/game-config.ts` |
| `__dclRoundLoop_v1`, `__dclRoundTuple_v1` | the Round Loop prefab |
| `__dclLevelSlots_v1` | the Level Slots prefab |
| `__dclWaveDirector_v1` | the Wave Director prefab |

Synced-entity ids are hand-allocated and must not collide (admin-tools holds
8000; the editor allocates scene entities from 8001):

| Id | Owner |
|---|---|
| 3101 | Round Loop — `runtime::RoundPhase` |
| 8020 | Level Slots — `levelSlots::SlotState` |

## Cross-prefab conventions

Two prefabs that must agree at runtime agree through one of these three, never
through a scene-level dependency:

- **Shared state lives on `globalThis` under a versioned key** (`__dclZoneBus_v1`).
  Every prefab bundles its own copy of a module, so module scope would give two
  prefabs two disconnected buses. The copies are separate class identities too —
  probe the shared object by SHAPE, never `instanceof` (`isRegistry` in
  `zoneBus.ts`). The prefab that DEFINES the key declares it in its `ai.md`
  front-matter (`claims-globals:`), and the same goes for rpc methods
  (`claims-rpc:`) and comms messages (`claims-messages:`); `guides.test.ts` fails
  on a collision.
- **The id two scripts share is the entity's Name**, matched trimmed and
  case-insensitively through one helper (`zoneKey` in `pure/zoneRegistry.ts`) —
  used by the client bus and the server authority alike, because two spellings of
  one place is a silent failure, and a valid entry that reads as a forged one is
  worse.
- **A consuming PREFAB carries its own copy** of the module it consumes (the
  copies dedupe within a scene, so the bus is still one object) and never imports
  out of another prefab's folder, which may not be placed. A script in the
  creator's `src/` has nothing to carry, so it imports from the placed prefab's
  folder — `custom/<slug>/scripts/runtime/…` — which is what that prefab's
  `ai.md` tells the assistant to do.
