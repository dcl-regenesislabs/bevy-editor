---
prefab: level-slots
claims-globals: __dclLevelSlots_v1, levelSlots::SlotState
---

# Level Slots — AI guide

Rotates arena variants through a play area: the Multiplayer Server picks which
variant each slot shows, every client rebuilds that geometry locally.

The project copy is normally custom/level_slots/ (the folder is slugged from the
prefab's name, "Level Slots") — check what is on disk, a second copy is
custom/level_slots_2/.

## When to use

When the same play area should look different between rounds and every player
must see the SAME variant — arena rotation, map votes, seasonal dressing. Not for
decoration that never changes (author it once) and not for anything a single
player should see alone (that is client-local, no server involved).

The prefab needs an authoritative scene (data.json requiresSdk: auth-server). In
a scene with no Multiplayer Server nothing is ever picked and the slots stay
empty.

Place ONE instance per play area. Its children are the slots, used in hierarchy
order; the prefab ships one, Slot_1. To drive more areas, duplicate Slot_1 inside
the instance and raise slotCount to match.

Params of the prefab's script:
- slotCount: how many slots this instance drives (default 1). Clamped to the
  number of child entities — a bigger number does not invent anchors.
- arenas: the Spawnable prefabs to rotate through, a PrefabRef[] the inspector
  renders as a dropdown over prefabs with Spawnable ON. Empty means nothing
  spawns; the scene-health card says so.

An arena variant is an ordinary prefab with Spawnable ON and no placed anchor.
Multi-entity is fine here — the server never materializes it.

## API

    import { rotateLevels, currentArena, onLevelChange } from '../../custom/level_slots/scripts/level-slots-api'

- rotateLevels(seed): SERVER side. Draws a fresh arena for every slot and
  replicates the picks. On a client it is a no-op — the pick is the one thing a
  client may not invent. A slot never redraws the arena it is already showing.
  You rarely need to call it: with a Round Loop in the scene the controller
  already calls it on every phase that is not a wave (the lobby and each
  intermission), reading the phase off globalThis.__dclRoundTuple_v1. Call it
  yourself only for a rotation of your own — a vote, an admin command — and
  never per frame.
- currentArena(slot?): the prefab ref showing in that slot (0-based), or null.
  Any side.
- onLevelChange(fn): fires with the per-slot refs whenever the picks change, and
  once immediately if picks already exist. Returns an unsubscribe function. Use
  it to reset spawn points, scores or props when the arena swaps.

Do not call installRotator or publishArenas — the prefab's own controller owns
them, and a second writer would fight the server for the picks.

## Which half runs where

One bundle runs on both sides; isServer() from '@dcl/sdk/network' is the switch.
Only ONE value crosses the wire: the pick index per slot, in a single synced
component (levelSlots::SlotState) on a single entity, protected so only the
Multiplayer Server can write it. That is why the v1 rule "server-owned spawnables
are a single entity" is respected here by design — the arena subtree is never
server state.

Each client watches that component and, when a pick changes, releases the old
arena's clones and spawns the picked prefab 'seeded' from the shared value.
Static geometry from a shared index is deterministic; positions of anything that
MOVES are not, so never assume two clients agree about a moving thing just
because they agree about the arena.

## Do / Don't

- DON'T open a 'server' pool over an arena prefab. Arenas are consumed 'seeded';
  'server' is single-entity in v1 and pool-open throws on a multi-entity prefab.
- DON'T write levelSlots::SlotState yourself, and don't keep a parallel copy of
  "which arena is up" — read currentArena or subscribe with onLevelChange.
- DON'T call rotateLevels from a client or from update(). It is a server-side
  phase decision; from anywhere else it silently does nothing or thrashes.
- DON'T add your own "rotate on the intermission" glue when a Round Loop is
  placed — the controller already does exactly that, and a second caller would
  swap the arena twice on the same boundary.
- DON'T reference an arena's entities by Name. Clone names are stripped, so a
  name-keyed lookup finds the authored anchor, never the arena on screen.
- If the scene is NOT authoritative, say so instead of shipping a rotation that
  can only ever stay on its first pick.

## Example

"Swap the arena every intermission and move the spawn points with it": place
Level Slots next to a Round Loop and set arenas to the two arena prefabs. The
swap needs no code. To move the spawn points with it, react to the change:

    import { onLevelChange } from '../../custom/level_slots/scripts/level-slots-api'

    start(): void {
      onLevelChange((arenas) => this.resetSpawnPoints(arenas[0]))
    }

For a rotation of your own — a between-rounds vote, say — draw it explicitly
from the server side, with any number you like as the seed:

    import { rotateLevels } from '../../custom/level_slots/scripts/level-slots-api'

    private onVoteClosed(winner: number): void {
      if (isServer()) rotateLevels(winner)
    }
