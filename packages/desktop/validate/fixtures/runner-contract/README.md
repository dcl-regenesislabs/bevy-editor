# Runner-contract fixture

Inputs for `packages/desktop/validate/probe-script-runner.mjs`. Nothing here ships
to a creator's scene; the probe copies these into a throwaway scene it creates
from the blank template.

## Why this exists

A Script reaches a live entity by two different code paths:

| path | constructed by |
|---|---|
| a **placed** entity's script | `@dcl/sdk-commands/dist/logic/runtime-script.js` → `runScripts()` |
| a **clone's** script | `packages/desktop/runtime-modules/spawner.ts` (+ `pure/scriptInit.ts`) |

The second is a shadow copy of the first. When they drift, the same prefab behaves
differently placed than spawned — a silent gameplay bug, never a build error. The
probe runs one script through **both** paths inside **one** scene and diffs the
records field for field.

## Files

- **`contract-probe.ts`** — the fixture script. One Contract-v1 class
  (`constructor(src, entity, …params)` + `start()` / `update(dt)`), exactly one
  exported function-valued binding, and one param of every type the editor can
  author: `number`, `boolean`, `string`, `entity`, an enum (string-literal union),
  `action` (`ActionCallback`), `PrefabRef` and `PrefabRef[]`. `ping()` is the
  `@action`-tagged method the probe reaches through the SDK's own
  `callScriptMethod`.

  `PrefabRef` is a local `string` alias rather than an import from the generated
  `spawnables.ts`: the fixture stays standalone, and the brand is erased at build
  time either way. It is deliberately outside every `tsconfig` `include` — it
  compiles only inside a scene, against that scene's own SDK pin.

  Records leave the scene on two channels because neither alone survives a CDP
  harness: `console.log` into the scene log ring (which can roll over before the
  probe polls) and a `TextShape` in the CRDT (durable while the scene runs, reset
  by a rebuild — which is what makes it a clean single-run set).

- **`composite-fragment.json`** — a real `main.composite` document, produced by
  `Composite.toJson` so it carries the same embedded `jsonSchema` blobs
  `packages/scene/src/composite.ts` writes. Entity `512` carries the fixture
  script at priority `0`; entity `0` carries `src/scripts/spawnables.ts` at
  priority `-100`, the way the editor installs its generated registry. The probe
  merges it into the scene's `assets/scene/main.composite` (the blank template
  ships none, so it normally creates it) and reads the placed script's `layout`
  string straight out of it, so the clone's snapshot is constructed from the
  **same bytes** as the placed row.

The generated `src/scripts/spawnables.ts` and `src/index.ts` are rendered by the
probe itself — they change with the impl-plan §3.3 shape, so they live next to
the assertions rather than here.

## Running it

```
npm run build                                          # the probe drives the built app
node packages/desktop/validate/probe-script-runner.mjs
```

Output is `PASS` / `FAIL` / `RECORD` lines; exit `0` on success, `1` on a failed
check, `2` on a harness error. A failure keeps the scratch scene and prints its
path.

`RECORD` lines are observations, not assertions — see decision D2 in the
implementation plan. The probe reports the `start()` and `update()` ordering
between priority `0` and priority `-100` that the runner actually produced on
this pin; it never assumes one. Observations are also written to
`packages/desktop/validate/artifacts/runner-contract-observed.json`.

What the last verified run observed on pin `7.25.1-…commit-5ffe873`, both
counter-intuitive:

- `start()` — priority **0 ran before** priority −100. `runScripts` iterates
  `Object.entries(scriptsByPriority)`; `'0'` is an integer-index key and JS
  enumerates those ahead of the string key `'-100'`.
- `update()` — the priority −100 system ticked **last**. `@dcl/ecs` sorts systems
  `b.priority - a.priority` (descending, default `SYSTEMS_REGULAR_PRIORITY`
  100000), so a *lower* priority number runs *later*. Priority −100 buys "after
  everything", not "before everything".

Neither is load-bearing: `spawnables.ts` publishes its snapshot table at module
scope, and module bodies all evaluate before `runScripts` is called.

## When the fingerprint gate fails

`packages/desktop/validate/runner-fingerprint.json` pins the sha256 of the
scene's own installed `runtime-script.js`. A mismatch means the SDK's runner
changed under us.

**Do not fix it by updating the hash.** Read the new `runtime-script.js`, check it
against `spawner.ts` and `pure/scriptInit.ts`, fix any divergence, re-run this
probe, and update `pin` / `sha256` / `verifiedAt` in the same commit as the
spawner change.
