# tower-of-madness — the walkthrough, as a scene that runs

Tower of Madness (docs/MULTIPLAYER-GAME-WALKTHROUGHS.md §2) as what a creator
would have on disk after step 10: five kit prefabs placed, eleven chunk prefabs
saved, one Trigger Zone named **Start**, and five scripts in `src/scripts/`.

Two consumers, one fixture:

| consumer | what it proves |
|---|---|
| `packages/desktop/src/tower-of-madness.test.ts` | the loop runs — the tower stacks the chunks the seed asked for, a finish is validated in the game and refused when it should be, the boards come out of a closed round. Real `game` module, mocked engine, in the `npx vitest run` gate. |
| `packages/desktop/validate/probe-tower.mjs` | the scene exists — the editor generates the module, sdk-commands builds it, the engine runs it. Manual, needs a built app. |
| `packages/desktop/validate/fixtures/tower-of-madness/tsconfig.json` | the scripts compile against the real SDK signatures. Runs inside `npm run typecheck -w @dcl-editor/desktop`. |

## Files

| file | what it is |
|---|---|
| `scripts/` | the creator's `src/scripts/` tree, verbatim. `tower-builder.ts`, `madness-race.ts`, `round-results.ts`, `clock-board.ts` are attached to entities; `race-ui.ts` and `pure/*` are imported by them. |
| `scripts/tower-probe.ts` | the observer the probe reads the scene through. Not part of the game. |
| `scripts/runtime/*.ts` | **repo-only stand-ins.** One line each, re-exporting `packages/desktop/runtime-modules/`. In a real scene the editor writes these files itself the moment a script says `import { game } from './runtime/game'`; here they are what points tsc and vitest at the shipped masters. `probe-tower.mjs` never copies this directory — the editor's generation pass is one of the things it checks. |
| `prefabs.json` | the prefab folders. Five `builtin` entries are copied straight out of `packages/desktop/prefabs/`, so a kit prefab changing shape changes this scene. The eleven chunks are a table of ids; the probe builds their folders. |
| `scene-composite.json` | `assets/scene/main.composite` — the plinth, the Start gate, the Tower anchor, the placed kit, the two boards, the clock sign, and every Script row with its params. |
| `composite-fragment.json` | entity 527: the observer's Script row. |

## The chunks are placeholders

This repo ships no tower models. Each chunk folder is a floor slab plus four
stepping blocks in a per-kind pattern, built from primitives by `probe-tower.mjs`
out of the table in `prefabs.json`. **Which** chunk stands on **which** floor is
what everything here measures, and that is unaffected: drop real GLBs into the
eleven folders and every claim reads the same.

## Numbers that differ from the walkthrough, and why

- **Round length is 60 s** (`round-results.ts`'s `roundSeconds` param), not the
  walkthrough's 7:00, so a probe run can watch a whole round close. Game Flow's
  own round length is the 180 s ceiling.
- **Chunk height is 6 m and the base sits at y=2**, the top of the plinth. The
  original's 10.821 m came from its models.

## Running it

```sh
npx vitest run packages/desktop/src/tower-of-madness.test.ts   # the loop
npm run build && node packages/desktop/validate/probe-tower.mjs # the scene
node packages/desktop/validate/probe-tower.mjs --emit /tmp/tower # just the files
```

Locally the probe stops after `generation`, `build`, `boot` and `plan`:
`sdk-commands start` boots no Multiplayer Server, so no copy of the game runs,
nothing publishes a round, and no layout is ever built. Deploy the emitted scene
to a world and re-run with `TOWER_PROBE_REQUIRE_SERVER=1` for the full set.
