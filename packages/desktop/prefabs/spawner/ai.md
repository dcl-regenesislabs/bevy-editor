---
prefab: spawner
claims-globals: __dclSpawnPoints_v1
---

# Spawner — AI guide

A spot that makes copies of a prefab appear while the game runs. Copies are made
on the player's own game the moment the trigger fires — nothing is stored, and a
fresh play starts with none.

The project copy is normally custom/spawner/ — check what is on disk, a second
copy is custom/spawner_2/.

## When to use

Anything that shows up DURING play: an enemy, a pickup, a crate, a vehicle.
By default a copy is built at the Spawner's own spot, so place it where the
thing belongs — the `where` param below covers the other landings.

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
- where: 'at this spawner' (default) | 'at the player' | 'custom spot'. Where a
  copy lands: the spawner's own spot, the feet (and facing) of the player whose
  trigger fired, or a "Spawn Spot" child the creator positions. NEVER create
  that child yourself — setting where to 'custom spot' materializes it, the
  creator places it with the gizmos, and the game hides it. If the user asks
  for a spawn position, set where and tell them to move the marker; do not
  invent coordinates.

Two more things are automatic, not settings: several copies spread just enough
not to stack (one copy lands exactly here), and the Spawner's disc is visible
while playing exactly when the Spawner itself is the button.

From another script, by the Spawner's NAME — that is the whole wiring:

    import { requestSpawn, retireSpawned } from '../../custom/spawner/scripts/runtime/spawnPoints'
    requestSpawn('Crate Spawner')

retireSpawned(entity) takes one copy away (a pickup that was collected). Full
signatures live in that file's header — read those, not a copy of them here.

## Each player sees their own copies

Copies live on the game that made them: the player who clicked sees the crate,
another player standing next to them does not. That is right for pickups,
personal effects and single-player scenes. For copies every player must agree on
(a boss, a contested pickup), spawn them from your own server-side script
instead — if the scene has zone_authority or round_loop placed, read that
prefab's ai.md for the authoritative pattern.

## Do / Don't

- DON'T put a Spawner inside a prefab that gets copied. Every copy would carry
  the same spot under the same name; only the first answers requestSpawn. The
  editor's spawn dropdown already hides prefabs that carry a Spawner for this
  reason — don't route around it by id.
- DON'T write a spawn position. Copies appear at the Spawner, auto-spread when
  several are out. To drop loot where something died, put a Spawner there when
  you build the scene, or say plainly that the drop is at a fixed spot.
- At the cap nothing happens: a press while atMostAtOnce copies are already alive
  is ignored rather than moving a live one. Say so if the user asks for a button.
- requestSpawn reaches ANY Spawner by name, whatever its when — 'when a script
  asks' just means no other trigger is armed. Use it for a copy that only
  another script should set off.

## Example

"A crate a lever makes appear": placePrefab spawner named "Crate Spawner" where
the crate should land, with spawn: the Crate prefab, when: 'when a script asks',
atMostAtOnce: 1, disappearsAfter: 30. Then, in the lever script's own pull:

    import { requestSpawn } from '../../custom/spawner/scripts/runtime/spawnPoints'
    requestSpawn('Crate Spawner')
