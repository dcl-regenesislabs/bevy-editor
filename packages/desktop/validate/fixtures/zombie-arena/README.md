# zombie-arena — the scene-side half of the fixture

`probe-zombie-arena.mjs` builds a real scene out of two directories:

| where | what |
|---|---|
| `packages/ui/src/prefabs/fixtures/zombie-arena/` | the walkthrough as data — prefab folders, the Game Config value, the placed composite, and the two generated files as goldens. `zombie-arena.test.ts` golden-tests those against the editor's own renderers. |
| here | what only a *running* scene needs — the observer script, the composite fragment that places it, and the zombie model. |

One fixture, two consumers. Change the walkthrough in the data half and both the
unit test and the probe follow.

## Files

**`arena-probe.ts`** — a v1-contract Script class placed on entity 528. It reads
the phase tuple, rebuilds the wave plan *independently* of the Wave Director,
diffs the two, shoots one clone through the outcome ledger until the server
reports it dead, and then reconstructs the alive-set the way a mid-wave joiner
would. Each claim leaves the scene as one `[ZOMBIE-ARENA] {json}` line — on the
console *and* as a `TextShape`, because the log ring truncates.

**`composite-fragment.json`** — entity 528: a Name, a Transform, and the Script
row. Its position is deliberately the Wave Director's, because the spawn area is
derived from the director's own transform and the probe has to derive the same
one to compare plans.

**`Zombie.glb`** — the Dead Surge zombie (`dead-surge/assets/custom/zombiebasic/
Zombie.glb`, 296 KB, self-contained: textures and buffers are embedded). Clips:
`ZombieUP`, `ZombieWalk`, `ZombieAttack`, `Tpose`. The fixture's `zombie_basic`
prefab names the first three in its `core::Animator`.

## Running it

```sh
npm run build                                     # the probe needs a built app
node packages/desktop/validate/probe-zombie-arena.mjs
```

First run installs the scene's own `node_modules` (~6 min on a cold cache).

To look at the scene without booting Electron:

```sh
node packages/desktop/validate/probe-zombie-arena.mjs --emit /tmp/arena
```

That writes the complete project — four kit folders copied verbatim, three
captured prefabs, carried runtime modules, the generated registry and config
accessor, the composite — and is also how you typecheck the fixture's TypeScript
against the auth-server SDK: drop a `tsconfig.json` beside it that mirrors
`packages/desktop/prefabs/tsconfig.json` (same `@dcl/sdk` → `@dcl/sdk-auth`
paths) and run `tsc --noEmit -p`.

## Two deliberate deviations from `concept-final.md` §2

- **The Player Rig anchor is placed *Editor & Play*, not *Editing only*.** The
  ghost projection drops the anchor's Script rows, which takes the rig's server
  half with them. Until that is resolved the walkthrough's "keep a placed anchor?
  yes" has to mean Editor & Play.
- **The walkthrough's leftover `src/scripts/zombie-brain.ts` is not here.**
  Capture copies rather than moves, so the original survives in a real project —
  but it would need its runtime imports vendored into `src/scripts/runtime/` as
  well, and the editor's unused-script nudge offers to delete it anyway.
