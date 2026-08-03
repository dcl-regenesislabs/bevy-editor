// Turns the scene's Trigger Zones into server-verified zones. Drop one anywhere
// in the scene — it is invisible and there is nothing to wire: it starts the
// zone authority on the Multiplayer Server, which re-checks a caller's real
// position before their entry counts and drops anyone who walks out.
//
// Consumers stay client-side and ask for confirmation only where it is worth
// something (a reward, a door to a paid area):
//
//   import { verifyZoneEntry } from '../../custom/zone_authority/scripts/zone-authority'
//   if (isInZone('Vault') && (await verifyZoneEntry('Vault'))) grantOnce()
import { type Entity } from '@dcl/sdk/ecs'
import { startZoneAuthority } from './zone-authority'

export class ZoneAuthority {
  constructor(
    public src: string,
    public entity: Entity,
    /** Metres of tolerance at the zone edge — positions arrive at ~10Hz */
    public slack: number = 1,
    /** Log rejected entries to the Multiplayer Server console */
    public logRejections: boolean = true
  ) {}

  start(): void {
    startZoneAuthority({ slack: this.slack, log: this.logRejections })
  }
}
