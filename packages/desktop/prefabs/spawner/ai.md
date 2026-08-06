---
prefab: spawner
claims-globals: __dclSpawnBus_v1
claims-rpc: spawnBus
---

# Spawner — AI guide

A spot that makes copies of a prefab appear while the game runs. The Multiplayer
Server mints every copy, so every player sees the same ones in the same place.

The project copy is normally custom/spawner/ — check what is on disk, a second
copy is custom/spawner_2/.

## When to use

Anything that shows up DURING play: an enemy, a pickup, a crate, a vehicle.
Place one where the copies should appear — a copy is built at the Spawner's own
spot, so the Spawner goes where the thing belongs. It needs an authoritative
scene (data.json requiresSdk: auth-server).

Every prefab in the project can be copied this way — there is no setting to turn
on. What bounds it is that prefab's Max alive (default 64, listed in the
[Spawnable prefabs] block): it must be at least as large as the copies you ask
for, counting every other spawner and wave aimed at the same prefab. The copies
are built from the prefab's snapshot at run time, whether or not one is also
placed in the scene.

Placement makes names unique, so a second "Button Spawner" is placed as
"Button Spawner 2" and is a separate spot with its own cap.

## API

Params — set them in the placePrefab request, never tell the user to go and
change them:
- spawn: the prefab to copy. Give its NAME (the [Spawnable prefabs] block lists
  them) and the editor resolves the id. Empty means nothing appears; the script
  says so in the console.
- when: 'when clicked' | 'when a player enters' | 'every few seconds' |
  'when a script asks'. These stored values are the
  wire — write them verbatim. The inspector may show friendlier display labels
  (e.g. 'when a script asks' reads as 'when another script asks'), but the layout
  always stores the values above.
- everySeconds: for 'every few seconds', how many seconds between copies
  (default 10).
- hoverLabel: for 'when clicked', the words a player sees before they click
  (default 'Use').

WHERE THE SPAWNER SITS IS THE WIRING — there is no target picker and no zone
name. Place it as a CHILD of the thing (the placePrefab position puts it there;
the editor's right-click gesture parents it for you):
- 'when clicked': the parent is the button (it needs a collider — the scene
  checks say so if it has none). A spawner with no parent is its own button:
  its disc shows itself while playing so players can see what to click.
- 'when a player enters': a parent that is a Trigger Zone is the zone. With no
  zone parent, the spawner's own spot is the walk-in area — its scale is the
  area's size in metres, so scale the spawner to size the area.
- atMostAtOnce: copies from this spot alive at once (default 1).
- disappearsAfter: seconds a copy sticks around; 0 keeps it until something
  removes it.

Two more things are automatic, not settings: several copies spread just enough
not to stack (one copy lands exactly here), and the Spawner's disc is visible
while playing exactly when the Spawner itself is the button.

From another script, by the Spawner's NAME — that is the whole wiring:

    import { requestSpawn, retireSpawned } from '../../custom/spawner/scripts/runtime/spawnBus'
    requestSpawn('Crate Spawner')

retireSpawned(entity) takes one copy away (a pickup that was collected). Full
signatures live in that file's header — read those, not a copy of them here.

## What the server actually guarantees

The server mints each copy's id, holds the cap and broadcasts the alive-set, so
two players cannot take the same copy and a joiner rebuilds the same set. It does
NOT check the press: a click or a zone entry is reported by the player's own
game, and the server checks the cap, the rate and the id, nothing else.

A player joining a server that has been running a long time replays at most 384
log entries; anything older is rebuilt from the server's saved per-spot state,
not from the log.

## Do / Don't

- DON'T put a Spawner inside a prefab that gets copied. Every copy would carry
  the same spot under the same name; the bus refuses them and the Spawner does
  nothing. The editor's spawn dropdown already hides prefabs that carry a
  Spawner for this reason — don't route around it by id.
- DON'T write a spawn position. Copies appear at the Spawner, auto-spread when
  several are out. To drop loot where something died, put a Spawner there when
  you build the scene, or say plainly that the drop is at a fixed spot.
- At the cap nothing happens: a press while atMostAtOnce copies are already alive
  is ignored rather than moving a live one. Say so if the user asks for a button.
- For a copy that must set itself off from elsewhere, use when: 'when a script
  asks' and call requestSpawn with the Spawner's exact name.

## Example

"A crate a lever makes appear": placePrefab spawner named "Crate Spawner" where
the crate should land, with spawn: the Crate prefab, when: 'when a script asks',
atMostAtOnce: 1, disappearsAfter: 30. Then, in the lever script's own pull:

    import { requestSpawn } from '../../custom/spawner/scripts/runtime/spawnBus'
    requestSpawn('Crate Spawner')
