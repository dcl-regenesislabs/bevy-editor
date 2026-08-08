---
prefab: round-loop
claims-globals: __dclRoundLoop_v1, __dclRoundTuple_v1
claims-rpc: round.hello, round.ping
---

# Round Loop — AI guide

One phase clock for the whole game: lobby → wave 1 → intermission → wave 2 → …
The Multiplayer Server owns the phases; every client derives the same countdown
from server time, so nobody's wave ends a second early.

The project copy is normally custom/round_loop/ — check what is on disk, a second
copy is custom/round_loop_2/.

## When to use

Anything that has to happen at the same moment for everyone and repeats: waves,
rounds, matches, intermissions, a lobby that waits for players. Also the source of
`seed` and `phase` for anything that must reconstruct identical content per phase
(spawn plans, arena picks). Needs a scene with a Multiplayer Server (requiresSdk: auth-server).

## API

Consumers do NOT import this prefab's script. It publishes a bus on globalThis so a
script in your own src/ works whether or not the folder is on disk:

    interface RoundBus {
      tuple: { seed: number; phase: number; phaseStartMs: number; configVersion: number } | null
      durations: { lobbyMs: number; waveMs: number; intermissionMs: number }
      parked: boolean
      present: number
      configVersion: number
      subscribe(fn: (tuple: RoundBus['tuple']) => void): () => void
      reportConfigVersion(version: number): void
    }

    function roundBus(): RoundBus | null {
      const bus = (globalThis as Record<string, unknown>).__dclRoundLoop_v1
      return typeof bus === 'object' && bus !== null && 'subscribe' in bus ? (bus as RoundBus) : null
    }

Probe it by shape, never with instanceof — each prefab bundles its own copy of a
module, so class identity does not survive the copy.

- `tuple` is the only thing that crosses the wire: phase 0 is the lobby, odd phases
  are waves, even phases above 0 are intermissions. `phaseStartMs` is a server
  timestamp — derive countdowns from it, never from an accumulator.
- `subscribe(fn)` fires on every phase boundary and replays the current phase to a
  late subscriber. It returns an unsubscribe function.
- `reportConfigVersion(n)` lets a Game Config owner tell the loop which version to
  pin into the NEXT phase. Config edits land on a boundary, never mid-wave. Left
  alone, the loop pins `gameConfig.version` off `globalThis.__dclGameConfig_v1`,
  which the generated `src/scripts/game-config.ts` publishes.
- The bare four numbers are mirrored on `globalThis.__dclRoundTuple_v1` for scripts
  that want the tuple and nothing else — the Wave Director rebuilds its wave plan
  from exactly that. Read it, never write it.
- The server publishes the tuple through a synced, server-protected component named
  `runtime::RoundPhase`. Do not write it — client writes are rejected.

Params of the prefab's script — set them in the placePrefab request:
- lobbySeconds: how long the lobby counts down once enough players are in (30).
- waveSeconds: how long a wave lasts (90).
- intermissionSeconds: the gap between waves (20).
- minPlayers: players needed before the first wave starts (2).
- soloMode: true (default) lets one player start the round alone, ignoring
  minPlayers — turn it off for a real multiplayer match.

## Deriving a countdown

    const bus = roundBus()
    const tuple = bus?.tuple
    if (tuple) {
      const endsAt = tuple.phaseStartMs + bus.durations.waveMs
      const left = Math.max(0, Math.ceil((endsAt - getServerTime()) / 1000))
    }

`getServerTime` comes from the shared timeSync module — the header in
scripts/runtime/timeSync.ts is its reference.

## Do / Don't

- DON'T run a second phase machine. Place ONE Round Loop; a second copy renders the
  countdown and nothing else, and a hand-rolled timer beside it will disagree.
- DON'T accumulate dt or call Date.now() for a shared deadline: a client joining
  mid-wave, or a server restarting, must land on the same phase as everyone else.
- DON'T decide phases client-side. The server is the only writer; clients read.
- The loop parks when the scene empties and starts a fresh round when someone
  returns — a wave never burns down in front of nobody.
- If a Level Slots is placed, rotating the arena is a subscribe(fn) away — read
  custom/level_slots/ai.md; this prefab never reaches into another one's folder.

## Example

"Spawn a new set of enemies each wave": subscribe to the bus, and on a tuple whose
`phase` is odd, seed a deterministic plan from `tuple.seed` and `tuple.phase` and
build it locally — every client runs the same function over the same numbers and
gets the same spawns, without any of them deciding anything.
