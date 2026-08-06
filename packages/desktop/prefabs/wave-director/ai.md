---
prefab: wave-director
claims-globals: __dclWaveDirector_v1
---

# Wave Director — AI guide

Runs enemy waves: the Multiplayer Server owns the wave seed, the hit validators
and the enemy health ledger, and every player's game reconstructs the identical
spawns locally instead of receiving them.

The project copy is normally custom/wave_director/ (the folder is slugged from
the prefab's name, "Wave Director") — check what is on disk, a second copy is
custom/wave_director_2/.

## When to use

A scene where waves of enemies arrive on a timer and players shoot them, and the
kills are worth something (score, a leaderboard, a reward). It needs an
authoritative scene (data.json requiresSdk: auth-server). Place ONE. A second
instance runs a second plan over the same ledger — don't.

It clones a SPAWNABLE prefab: the enemy must be a prefab whose Spawnable setting
is on, with a max at least as large as the biggest wave count. Nothing is placed
in the scene for it — the clones are built from the prefab's snapshot at run
time, one identical set per player.

## API

Params of the prefab's script — set them in the placePrefab request:
- zombie: which Spawnable prefab to clone. It stores the prefab's id, but you
  never type one: give the prefab's NAME (the [Spawnable prefabs] block lists
  them) and the editor resolves it. Empty means no waves; the script says so in
  the console.
- wavesTable: the Game Config table the counts come from (default "waves",
  columns wave / count / interval / speedMult). With no Game Config it runs a
  built-in ten-wave table.

Read the live wave from the shared view (no import, probe it by shape):

    const view = (globalThis as Record<string, unknown>).__dclWaveDirector_v1
    // { wave, phase, planned, alive, entryOf(instanceId) }

entryOf(id).init carries that clone's { x, y, z, speedMult, hp, wave } — an
enemy's own script reads its speed multiplier from there.

Report outcomes through the ledger this folder carries. Kinds are `hit` (a
player damaged a clone) and `bite` (a clone damaged a player); the ledger key is
"wave":

    import { outcomes } from '../../custom/wave_director/scripts/runtime/outcomes'
    import { spawnedFrom } from '../../custom/wave_director/scripts/runtime/spawner'

    const id = spawnedFrom(entity)?.instanceId
    if (id !== undefined) outcomes('wave').report('hit', { instanceId: id })

outcomes('wave').onOutcome(e => …) fires on every client in sequence order; a
`hit` whose value is 0 means that clone just died. Signatures of the carried
modules live in their own file headers under scripts/runtime/ — read those, not
a copy of them here.

## What the server actually guarantees

The server never holds an enemy entity, so it cannot check where one is: in a
planned wave each player simulates positions locally. It owns the wave seed, so
everyone gets the same spawns and the same alive-set; and it owns health —
damage is DERIVED from Game Config (weapons.gunDamage, zombie.biteDamage), never
read from the report, and each reporter is rate-limited from weapons.fireRate.
Say "damage is server-tracked", never "hits are verified".

Phases come from the Round Loop prefab when one is placed; if none is, waves
free-run off the synced clock. If placed, read custom/round_loop/ai.md. With a
Round Loop only its WAVE phases spawn: the lobby and every intermission plan
nothing, and wave n runs the table's row n. Free-running there is no lobby, so
every phase is a wave.

## Do / Don't

- DON'T spawn enemies yourself, or send spawn messages: the plan is a pure
  function of the phase tuple and rebuilding it is how a late joiner sees the
  same wave. Anything random you add must be drawn from that plan.
- DON'T keep enemy health on the client or trust a reported damage number. Report
  the hit, then react to the outcome the server broadcasts.
- DON'T put wave counts or damage numbers in a script param — they belong in
  Game Config, or the two copies will diverge.
- DO check the largest wave count fits the enemy prefab's "Max alive" — 64
  unless its data.json sets one; the editor blocks Play when a wave overruns it.

## Example

"Waves of zombies that die when I shoot them": place Wave Director, set zombie to
the ZombieBasic prefab, and in the gun script report the hit and let the server
answer.

    const id = spawnedFrom(hitEntity)?.instanceId
    if (id !== undefined) outcomes('wave').report('hit', { instanceId: id })
