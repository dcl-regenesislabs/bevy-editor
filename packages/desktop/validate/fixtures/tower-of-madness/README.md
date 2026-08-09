# tower-of-madness — the build guide, as a scene that runs

Tower of Madness (docs/BUILD-A-MULTIPLAYER-GAME.md) as what a creator would have
on disk at the end of the build: five kit prefabs placed, eleven chunk prefabs
created, one Trigger Area named **Start**, and an `src/scripts/` tree of four
attached scripts plus five files nothing attaches (`race-ui.ts` and `pure/*`).

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

## Numbers, and where they come from

- **Round length is 60 s** (`round-results.ts`'s `roundSeconds` param) with a 5 s
  break, short enough that a probe run can watch a whole round close. Game Flow's
  own round length is the 180 s ceiling above it. Both are the guide's own
  numbers — the settings table in its "Set the params" step carries these.
- **Chunk height is 6 m and the base sits at y=2**, the top of the plinth. The
  original scene's 10.821 m came from its models.

## Running it

```sh
npx vitest run packages/desktop/src/tower-of-madness.test.ts   # the loop
npm run build && node packages/desktop/validate/probe-tower.mjs # the scene
node packages/desktop/validate/probe-tower.mjs --emit /tmp/tower # just the files
```

Local Play does boot a Multiplayer Server: the editor installs
`@dcl/sdk@auth-server` **and** `@dcl/sdk-commands@auth-server` into a scene that
needs one (`packages/desktop/src/sdk-capability.ts:34`), and that toolchain's
`start` spawns the server on every run, with no flag to suppress it. So a local
run can reach `round`, `tower`, `finish` and `board` with nothing deployed — the
scene's own `node_modules` are what decide it. A run that never sees a round
tuple reports those four as SKIP rather than PASS;
`TOWER_PROBE_REQUIRE_SERVER=1` holds the gate to the full set (use it on a world
deploy, or on any run where the server must be there).

The note that used to sit here said `sdk-commands start` boots no Multiplayer
Server. That was true of the scene it was measured on — one left on the standard
SDK, which has no `spawnAuthServer` — and false of the toolchain the editor
installs.
