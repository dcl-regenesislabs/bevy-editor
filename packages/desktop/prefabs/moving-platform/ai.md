---
prefab: moving-platform
claims-rpc: platform.call
---

# Moving Platform — AI guide

A platform that travels its path and carries riders, in the same place at the
same moment for every player, with (at most) one shared fact on the network.

The project copy is normally custom/moving_platform/ — check what is on disk, a
second copy is custom/moving_platform_2/.

## When to use

Anything that moves on a schedule and players stand on or dodge: lifts,
ferries, patrolling hazards, appearing bridges. Needs a scene with a
Multiplayer Server (data.json requiresSdk: auth-server) — it reads the server
clock. Not for motion players push or steer; the position is a function of
time, plus at most one start timestamp.

## API

    import { drivePath, pathPositionAt, type PathPlan } from './runtime/syncedTween'

- drivePath(entity, plan): call every frame from update(). Derives the leg and
  phase from the server clock and seeks the entity's Tween to match.
- pathPositionAt(plan, atMs): where the platform is at any server timestamp,
  engine-free — the server-side referee.
- PathPlan: { stops: Vector3[], mode: 'back and forth' | 'around' | 'once',
  travelMs, waitMs, easing, offsetMs, sinceMs? }. sinceMs anchors the cycle to
  a shared start timestamp; absent means "running since forever".

Calling a platform whose runs is 'when called' (from any script, either side):

    await game.request('platform.call', { name: 'Bridge' })

The name is the platform entity's Name, matched case-insensitively — the same
name-is-the-id contract Trigger Areas use. The server answers by publishing
one fact ({ since: game.now() }) under game.state['platform.<name>']; every
peer derives the motion from it, and calling again while present is a no-op.

Params of the prefab's script — set them in the placePrefab request:
- path: the stops after the placed spot, in travel order, each {x, y, z}
  metres from where the platform is placed ([{x,y,z}, …], default one stop at
  {x:0,y:0,z:8}). Every point renders as an XYZ row with its own "Set" button
  that drags a ghost of the model; an empty path parks the platform.
- loop: 'back and forth' (default), 'around' (…last point back to start), or
  'once' (make the trip and park at the last stop).
- runs: 'from the start' (default) or 'when called' (parked until
  platform.call names it; pairs well with loop 'once').
- tripSeconds: seconds between one stop and the next (default 4).
- waitSeconds: seconds it waits at each stop (default 1).
- smooth: true (default) eases in and out of stops.
- startOffsetSeconds: staggers a row of platforms (default 0).

## Why it agrees across clients

The engine's tween is an integrator and two players' copies drift apart at
every turn, forever. This module never lets the engine decide which leg it is
in: the leg table is anchored to the Unix epoch (or the called-at timestamp)
and every peer derives the same answer from getServerTime(), written into the
tween's currentTime as an exact seek. A late joiner and a restarted server
land on the same phase without being told anything.

The server runs the same loop, so its collider sits where players see it.

## Do / Don't

- DON'T put an isServer() early return in the drive loop — the server's tween
  would freeze at its first leg's end, silently, forever.
- DON'T syncEntity the platform or spawn it through a 'server' pool. Its
  position is derived; a synced Transform becomes a per-tick stream that
  fights every client's local tween (the module logs an error if it sees one).
- DON'T write TweenSequence on it — the SDK's sequence system fights the seek.
- DON'T author a speed above ~20 m/s per leg; the engine stops carrying riders
  past ~5 metres per frame.
- DO spawn platforms at runtime: client-local clones (any non-'server' pool)
  agree in phase automatically, and a shared appearance is runs 'when called'
  plus one platform.call.

## Example

"Make a bridge that extends when the boss dies": place Moving Platform named
"Bridge" across the gap, set runs to 'when called' and loop to 'once', and in
the server code that handles the boss dying add
await game.request('platform.call', { name: 'Bridge' }). Every player sees the
bridge slide out at the same moment, and players who join later see it already
extended.
