---
prefab: trigger-zone-server
claims-rpc: zone.enter, zone.occupancy
---

# Zone Authority — AI guide

Server-side verification for named zones: before a zone entry counts, the
Multiplayer Server re-derives where that player really is and confirms it.

The project copy is normally custom/zone_authority/ (the folder is slugged from
the prefab's name, "Zone Authority") — check what is on disk, a second copy is
custom/zone_authority_2/.

## When to use

Only when a zone gates something worth cheating for: a reward, a score, a paid
or ranked area. Doors, lights, sound and ambience do not need it — client
detection is fine there and this adds a round trip. The prefab needs an
authoritative scene (data.json requiresSdk: auth-server); in a scene without a
Multiplayer Server every check below resolves false.

Place ONE anywhere in the scene. It is invisible and there is nothing to wire —
it starts the authority on the server. A second instance is a no-op (the first
one's params win).

## API

    import { verifyZoneEntry, verifiedZoneOccupancy } from '../../custom/zone_authority/scripts/zone-authority'

- verifyZoneEntry(zone): Promise<boolean> — client side. true means the server
  agreed this player's real position is inside that zone. It never throws: false
  covers rejected, no such zone, and no server at all (after the rpc timeout, a
  few seconds). Await it before granting anything.
- verifiedZoneOccupancy(zone): Promise<string[]> — client side, the wallets the
  server currently counts as inside.
- verifiedInZone(zone, address): boolean — SERVER side, synchronous. For another
  server handler that must check presence before doing something.
- startZoneAuthority() is the prefab's own entry point. Never call it, and never
  create your own createRpc('zone'): this module owns the single rpc instance for
  the zone namespace, and two instances both answer while only the first reply is
  read.

Params of the prefab's script — set them in the placePrefab request:
- slack: metres of tolerance at the zone edge (default 1). Positions arrive at
  ≤10 Hz and are the avatar's feet, so 0 rejects honest players.
- logRejections: log rejected entries to the Multiplayer Server console
  (default true).

## Which half runs where

One bundle runs on both sides; isServer() from '@dcl/sdk/network' is the switch.
The CLIENT detects (only a client has avatar colliders — zone detection never
fires on the headless server) and asks; the SERVER verifies. Identity is never in
a payload: the server takes the caller from context.from, the wallet the
transport already authenticated, so a client cannot claim to be someone else.

A late joiner whose position has not reached the server yet is admitted
UNVERIFIED so arriving players are not punished, and a 4 Hz sweep drops anyone
whose position turns up outside (or stays missing for 10 s). Tell the user this
is "server-validated", never "cheat-proof".

## Do / Don't

- DON'T cache a true and reuse it later — verify at the moment of each grant.
- DON'T gate visuals or feedback on the await. Doors, sounds and UI react to
  client detection immediately; only the GRANT (points, reward, unlock) waits for
  verification, so a lagging server never makes the scene feel broken.
- DON'T keep the score on the client and report it to the server. If a value is
  worth verifying, the server owns it — count it in a server handler that calls
  verifiedInZone.
- Zones themselves are Trigger Zone prefabs and a zone's id is its entity Name.
  If one is placed, read custom/trigger_zone/ai.md before writing zone code.
- If the scene is NOT authoritative, say so instead of shipping a check that can
  only ever resolve false.

## Example

"Award 10 points at the vault and don't let people fake it": place Zone Authority
once, place a Trigger Zone named "Vault", and in the reaction's enter handler
award only after the server agrees.

    private async claim(): Promise<void> {
      if (await verifyZoneEntry('Vault')) this.award()
    }
