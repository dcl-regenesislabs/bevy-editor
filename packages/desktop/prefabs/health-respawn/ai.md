---
prefab: health-respawn
claims-state: game.state.health
claims-messages: respawn
---

# Health & Respawn — AI guide

Hit points the game owns, and a respawn point players come back to.

The project copy is normally custom/health_respawn/ — check what is on disk, a
second copy is custom/health_respawn_2/.

## When to use

Any scene where players can die: a fall, a hazard, a fight. Place ONE anywhere;
it is invisible. A second copy is a no-op (the first one's params win).

Do NOT write your own health map, death check or teleport-home code — this piece
owns all three, and health a screen can edit is health nobody can trust.

## API

    import { damage, healthOf } from '../../custom/health_respawn/scripts/health-respawn'

- `damage(player, amount)` — GREEN only, from inside `game.onMessage`,
  `game.onEnterZone`, `game.every` or `game.onRoundStart`. Takes the player to a
  minimum of 0; at 0 this piece respawns them within half a second and refills
  them. A player who is not in the game is ignored.
- `healthOf(player)` — reads hit points anywhere, on a screen too.
- `game.state.health` — the whole `{ wallet: points }` map, readable on every
  screen and by late joiners. Read it to draw bars or count who is alive; never
  write it.

Params of the prefab's script — set them in the placePrefab request:

- `respawnAt`: the entity players come back to. Pick a pad or marker that sits at
  the scene root — the position is read straight off its Transform. Until it is
  picked, nothing respawns and the console says so.
- `maxHealth`: hit points a player starts every life with (default 100). Also the
  refill at a new round.
- `dieBelowHeight`: players below this height die (default 0 = off). This is the
  death plane for a climbing or platforming scene; set it under the lowest floor
  a player is allowed to stand on.

## Hazards

A hurting zone is a Trigger Zone plus one green handler — this piece deliberately
has no zone list, because damage belongs to it and detection belongs to the zone:

    game.onEnterZone('Moat', (player) => damage(player, 100))

## Do / Don't

- DON'T call `damage` on a screen. It throws — only the game changes shared facts.
- DON'T teleport a dead player yourself. The game whispers `respawn` to that one
  player and their own screen moves them; a `movePlayerTo` in your code moves the
  wrong avatar or none.
- DON'T handle the `respawn` message in your own script. One name has one handler
  and this piece already registered it.
- DO reset scores in `game.onRoundStart` if you also want a fresh scoreboard —
  this piece only refills health.

## Example

"Kill anyone who falls off the tower and send them back to the base": place Health
& Respawn, pick the BaseSpawn pad as `respawnAt`, and set `dieBelowHeight` to the
height just under the tower's first floor. No script at all.
