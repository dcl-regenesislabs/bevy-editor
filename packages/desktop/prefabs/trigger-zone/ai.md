---
prefab: trigger-zone
claims-globals: __dclZoneBus_v1
---

# Trigger Area — AI guide

An invisible named volume that knows who is standing in it. Other scripts react
to it BY NAME through the bus module carried in this folder — nothing is wired,
and a reacting script pasted into another scene keeps working.

## When to use

Any request shaped like "when a player walks somewhere / is somewhere / leaves
somewhere": open a door, play a sound or emote, award points, show a message,
start an ambience. One area per place — though several volumes may share a Name,
and the bus then treats them as one place.

## API

AN AREA'S ID IS THE ENTITY'S NAME, matched trimmed and case-insensitively — the
[Scene] block lists the areas the scene already has.

Import from the bus module carried in this folder. Check the folder on disk
first: a second copy lives in custom/trigger_zone_2/, and so on.

    import { isInZone, onZone, playersInZone, zoneOf } from '../../custom/trigger_zone/scripts/runtime/zoneBus'

- isInZone(name): true while THIS viewer is inside. Occupancy — the default you want.
- playersInZone(name): every avatar currently inside, deduped across volumes sharing the name.
- onZone(name, 'enter' | 'exit' | 'any', fn): edges derived from occupancy; returns
  an unsubscribe. Late subscribers get current occupancy replayed as enters. The
  event: { zone, kind, entity (the avatar that MOVED — never the area), address,
  local (true for this viewer), zoneEntity }.
- zoneOf(entity): the area name of the entity a script is attached to ('' if unnamed).

Full signatures (and zoneNames()) are in the module header: scripts/runtime/zoneBus.ts
in this folder.

Params of the area's own script — set them in the placePrefab request, never
tell the user to change them:
- who: 'this player' (default) | 'any player' — whose client the area reacts to.
- fireWhen: 'every time' (default) | 'once per player' | 'once ever' — how often
  an entry may fire.
- exitDelay: seconds (default 0.3) a player may step back out before counting as
  gone. Boundary hysteresis, NOT a cooldown — a reaction owns its own rate limit,
  and naming that limit "cooldown" next to the area's settings reads as this one;
  name it for what it limits and say so in its doc comment.

## Occupancy beats edges

Most "when someone is in here" code is occupancy, not events: isInZone() in
update() cannot flicker, needs no debounce, and a door with two people in it
does not close when one of them leaves.

    update(): void { if (isInZone('Front Door Area')) this.open(); else this.close() }

Use onZone(name, 'enter', …) only when the reaction really is one-shot, 'exit'
for leaving, 'any' when one script handles both (event.kind is 'enter' | 'exit').
Cover the edge the user asked for and no more.

## Where the reaction script goes

An entity's Script component is a LIST — an area carries its detector AND any
reactions. Decide by what the reaction acts on:

- It changes ANOTHER object ("open the door", "turn on the lights") → attach to
  THAT object, resolved from the [Scene] roster, with public zone: string =
  'Front Door Area'. A reaction living elsewhere needs telling which area; never
  hardcode the name where a param would do.
- It acts on the player, the UI, the sound, the score — nothing else involved
  ("play an emote", "show a message", "give points") → attach to THE AREA ITSELF,
  with an attachScript request naming the area, and give it NO zone param at all.
  Not a blank one: a param the creator must leave empty is a field that can only
  be got wrong. Call zoneOf(this.entity) in start() — the attachment already says
  which area, and renaming the area can't orphan it. Exactly this shape, params
  for the reaction only:

      export class AreaPoints {
        private zone = ''
        constructor(public src: string, public entity: Entity, public points: number = 10) {}
        start() {
          this.zone = zoneOf(this.entity)
          onZone(this.zone, 'enter', (e) => { if (e.local) this.award(e.address) })
        }
        update(dt: number) {}
        private award(address: string) { /* what happens goes here */ }
      }

- NEVER pick an unrelated entity just to have somewhere to put a script. No
  object involved → the area is the answer.
- An area named in the prompt ("…when they enter Front Hall") says WHICH area to
  attach to — it is not a request for a zone param.

## Do / Don't

- DON'T subscribe triggerAreaEventsSystem.onTriggerEnter/Stay/Exit on an area
  entity. The SDK keeps exactly ONE callback per (entity, event), so your
  subscription silently replaces the prefab's own detector and the area stops
  working for everybody. The prefab owns those callbacks; you consume the bus.
- DON'T hand-roll proximity (distance loops against the player). The prefab
  exists so you never do.
- The volume IS the entity's Transform scale in metres, so the scale gizmo is the
  resize tool. Neither you nor the editor can measure a model's bounding box —
  place the area NEAR the object at a sensible size and say in one line to drag
  the scale handles to fit. Never claim you fitted it.
- Detection is client-side only: the headless server has no avatar colliders, so
  an area never fires there. Fine for doors, lights, sound, ambience. When an area
  gates something valuable (a reward, a score, a paid area) the client detects and
  the SERVER verifies — that is the Zone Authority prefab; if it is in this
  project, read custom/zone_authority/ai.md. Otherwise say the check is
  client-trusted rather than implying it is safe.

## Example

"Make the door open when someone walks up": placePrefab trigger-zone named
"Front Door Area" (4×3×4 at the doorway, who: 'any player'), then a script on
the Door entity whose update() runs the isInZone snippet above.
