# zombie-arena — the walkthrough, frozen

The scene of `concept-final.md` §2 as data: what a creator would have on disk
after step 10, minus the binaries. `zombie-arena.test.ts` pushes it through the
real `renderSpawnables` and `renderGameConfig` and diffs the result byte for
byte; `packages/desktop/validate/probe-zombie-arena.mjs` materialises the same
files into a project, builds it and plays it.

Data files only — no `.ts` under `packages/ui/src`, which the ui tsconfig would
try to typecheck against a scene-context SDK. The scene-side TypeScript lives in
`packages/desktop/validate/fixtures/zombie-arena/`.

| file | what it is |
|---|---|
| `prefabs.json` | the seven prefab folders. Four are `builtin` — read straight out of `packages/desktop/prefabs/` — so changing a kit prefab's composite fails this fixture, which is the point: the registry a creator ships changed too. The other three (`zombie_basic`, `arena_graveyard`, `arena_mall`) stand in for what Make Prefab captured. |
| `scene-scripts.json` | the hand/AI-written scripts, keyed by the project-relative path they end at. Exactly one: the zombie brain, ported from Dead Surge. |
| `game-config.json` | the `editor::GameConfig` value of step 8 — the `waves` curve, `weapons`, `zombie`, `WINNER_POINTS`. |
| `scene-composite.json` | `assets/scene/main.composite`: the arena shell, the four placed kit instances, the Player Rig anchor, and on entity 0 the Game Config plus the one Script row that installs the registry at priority −100. |
| `spawnables.expected.txt` | golden — `src/scripts/spawnables.ts`. |
| `game-config.expected.txt` | golden — `src/scripts/game-config.ts`. |

## Regenerating the goldens

Both generated files are byte-goldens, so an intended change to `codegen.ts`,
`spawnable.ts` or a kit prefab's composite fails the test until you refresh them:

```sh
UPDATE_GOLDENS=1 npx vitest run packages/ui/src/prefabs/zombie-arena.test.ts
```

Read the diff before committing it. A registry that constructs the wrong class,
or the right one with no arguments, does not fail any build — it just makes the
zombie behave differently spawned than placed.

## Numbers, and where they come from

`waves` follows Dead Surge's curve (`src/shared/matchConfig.ts`): hostility steps
up at wave 5, the group grows every three waves, a kill is worth 5. The last row
asks for 48 zombies against `ZombieBasic`'s pool max of 64 — that margin is what
the wave-count check measures, so raising it past 64 must fail.

The `weapons` row is `range`, the name a creator would reach for. The kit gun
reads it from the table instead of declaring a param of its own, so the value
lives in exactly one place and the config-shadowing check stays quiet on the
kit's own prefab.
