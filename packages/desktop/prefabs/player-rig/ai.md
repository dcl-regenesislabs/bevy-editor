---
prefab: player-rig
claims-rpc: outcomes.rig
---

# Player Rig — AI guide

One rig per player: a nameplate and a health bar that follow every avatar, with
hit points the Multiplayer Server owns and validates.

The project copy is normally custom/player_rig/ (the folder is slugged from the
prefab's name, "Player Rig") — check what is on disk, a second copy is
custom/player_rig_2/.

## When to use

Any scene where players can be hurt, healed or killed and it matters who is
right. Needs an authoritative scene (data.json requiresSdk: auth-server); with
no Multiplayer Server the bar renders and nothing ever changes it.

Place ONE. It is a Spawnable prefab with instancing "perPlayer": the placed one
is the anchor you edit in the viewport, and at run time the per-player pool
clones it once per present player on every client. Keep the placed anchor —
without it the server half has nowhere to run.

## API

Hit points move over the outcomes.rig ledger. Another script asks for a change;
the server decides. Import the placed prefab's carried copies:

    import { outcomes } from '../../custom/player_rig/scripts/runtime/outcomes'
    import { playerPositions } from '../../custom/player_rig/scripts/runtime/playerPositions'
    import { addressInstanceId } from '../../custom/player_rig/scripts/pure/rigState'

- "damage" — payload { instanceId, amount }. Refused when the player is dead,
  inside spawn protection, inside the 250 ms cooldown, or when instanceId is not
  the caller's own; the amount is floored into 1..maxDamagePerRequest.
- "heal" — same shape, clamped up to maxHp.
- "respawn" — payload { instanceId }; only once the delay elapsed and a life
  remains. The server fires this itself when the timer is up, so you rarely
  need to send it.
- Every accepted request broadcasts { instanceId, value } to all clients, value
  being the remaining hit points. Subscribe with outcomes('rig').onOutcome(…).

instanceId is always addressInstanceId(wallet) — a stable hash, so it survives a
rejoin and is identical on every client without sending a roster.

Rig script params: rig (this prefab itself, so the anchor can open the
per-player pool when the generated registry has not — the editor sets it, leave
it alone), maxHp 100, lives 3, respawnSeconds 5, spawnProtectionSeconds 2
(server rules, not suggestions), showHealthBar true.

Hand anchor gun params (scripts/gun-hitscan.ts): shotDamage 12 and
shotsPerSecond 4 are what this client REQUESTS and the server clamps; ledger
"wave" is the outcome ledger whose "hit" validator scores the shot — that
validator belongs to the Wave Director, so if one is placed read
custom/wave_director/ai.md before changing it.

The gun's range is NOT a param: it reads Game Config `weapons.range` (24 metres
when there is no Game Config). Change the number in the table, never in the
script — a param of the same name would be the same value in two places, and the
config-shadowing check blocks it. These sit on the Hand Anchor
child, not the rig root: a setParams request has to name that entity.

## What is trustworthy

The health NUMBER is server truth. The health bar's POSITION is cosmetic: it is
drawn from this client's own view of where that avatar stands, so it can lag or
sit slightly off, and that is never a sign the number is wrong.

Nothing about a shot's geometry is validated. In a "planned" spawn the targets
exist only on clients, so the server cannot check the shooter's distance or line
of sight even in principle. It checks rate, clamps damage, and owns the hit
points. Call that "server-validated", never "cheat-proof".

## Which half runs where

One bundle runs on both sides; isServer() from '@dcl/sdk/network' is the switch.
The SERVER runs on the placed anchor (per-player clones are client-local, so no
clone ever exists there): it loads vitals from Storage.player, arms the three
validators, sweeps respawns and flushes to storage every 20 s. CLIENTS run the
clones: they set AvatarAttach.avatarId, scale the bar, and write the plate.

The rig's parts are found by shape, never by name — a clone's snapshot has no
Name components. The head anchor is the child with AvatarAttach anchor point 1,
the hand anchor is anchor point 3.

## Do / Don't

- DON'T subtract hit points on the client and tell the server afterwards. Report
  the request and render what comes back, or the two will disagree.
- DON'T put the anchor in Editing-only placement. Its scripts are stripped from
  the build, and the server half goes with them.
- DON'T parent held items to the rig root — it does not follow the hand. Put
  them under the Hand Anchor, which carries its own right-hand AvatarAttach.
- DON'T read hp out of Storage.player from a client; only the server can.
- DO leave the first request after a player arrives failing: vitals are loading
  from storage and the server refuses rather than damage stale defaults.

## Example

"A zombie bit me — take 8 health off":

    private bite(): void {
      const me = playerPositions().find((p) => p.local)
      if (!me) return
      outcomes('rig').report('damage', { instanceId: addressInstanceId(me.address), amount: 8 })
    }
