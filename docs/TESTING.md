# Testing

Three tiers, fastest to slowest. The first two are the everyday gate; the third
is corroborating evidence.

| Tier | Command | Speed | Needs | Is it the gate? |
|---|---|---|---|---|
| **Unit tests** | `npm test` | ~0.5s | nothing | part of the gate |
| **Validate** | `npm run validate` | ~30–60s | nothing (no engine/Electron) | **yes — run after every change** |
| **E2E (CDP)** | `npm run validate:e2e` | minutes | GPU + a test scene, macOS/Linux | no — corroborating |

`npm run validate` runs **typecheck → unit tests → build** in sequence and stops
at the first failure. If it's green, the tree is healthy.

---

## Unit tests (Vitest)

Pure logic — the functions that carry correctness risk and have no engine
dependency — is unit-tested with [Vitest](https://vitest.dev).

```bash
npm test               # run once
npm run test:watch     # watch mode while iterating
```

Current coverage (`packages/scene/src/*.test.ts`):

- **`world-pos`** — transform composition through parent chains, world↔local
  round-trips, `rootLocalForWorld`, the parent-cycle guard, and the
  missing-world-origin (entity 5) case.
- **`save-diff`** — `deepEqual` (including the float32-tolerance at every nesting
  level, which the save flow depends on) and the option-collapse helpers.
- **`composite`** — the authored-entity predicate (root + ≥512).

### Why these resolve under Vitest

The scene modules import `@dcl/sdk/math` and `@dcl/sdk/ecs`, which Vite resolves
the same way the UI build does. The tested functions never call `~system/*`
engine ops, so no engine/runtime is needed. The one dynamic `import('~system/...')`
in the scene is inside a function, so it doesn't run at module load.

### Writing a new unit test

1. Colocate it: `packages/scene/src/<module>.test.ts` (or `packages/ui/src/…`).
   `vitest.config.ts` includes `packages/**/src/**/*.test.ts`.
2. Test files are **excluded from the scene's production build/typecheck**
   (`tsconfig.json` `exclude`), so importing `vitest`/Vite types can't leak into
   the shipped bundle.
3. Keep tests pure — if a function needs `state` or engine ops, either inject a
   minimal fixture (see the `Snapshot` cast helper in `world-pos.test.ts`) or
   leave it for the e2e tier.

> Good first targets to grow coverage: `custom-components` codec round-trips,
> `schema` defaults/validation, and the `composite` builder.

---

## Validate (the gate)

```bash
npm run validate
```

Typecheck (all workspaces) + unit tests + full build (scene → ui → desktop).
Fast and hermetic — no engine, no Electron, no network. This is the contract:
**a change isn't done until `npm run validate` is green.**

---

## E2E / CDP harness

Launches the real desktop app and drives it over the Chrome DevTools Protocol.
Full reference (steps, requirements, how to extend) is in
[`AI-AGENT.md`](./AI-AGENT.md#part-2--the-cdp-end-to-end-harness). In short:

```bash
npm run validate:e2e                                    # full run
node packages/desktop/validate/validate.mjs --steps=boot,picker,engine,scene
BEVY_EDITOR_PROJECT=/path/to/scene node packages/desktop/validate/validate.mjs
```

It needs a GPU (WebGPU engine), a test scene, and is macOS/Linux-only. It's
timing-sensitive: green is strong evidence, red means investigate — but the hard
requirement remains `npm run validate`.
