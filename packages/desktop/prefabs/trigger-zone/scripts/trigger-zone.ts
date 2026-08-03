// An invisible named area that knows who is standing in it. The zone's id is the
// entity's NAME — the one handle the creator, the script and the AI already
// share — so another script reacts with `isInZone('Front Hall')` and nothing has
// to be wired. Matching is case- and whitespace-insensitive (zoneRegistry).
//
// The area's size and rotation come from the entity's own Transform: scale is
// metres, so the scale gizmo is the resize tool. Detection is client-side only —
// the server has no avatar colliders, so a zone never fires there.
import {
  Schemas,
  TriggerArea,
  engine,
  triggerAreaEventsSystem,
  type Entity,
  type LastWriteWinElementSetComponentDefinition
} from '@dcl/sdk/ecs'
import { Membership } from './runtime/pure/membership'
import { emitZone, publishZone } from './runtime/zoneBus'

// Collision layers by value, not by name: the SDK renamed CL_RESERVED2 to
// CL_MAIN_PLAYER, and this script compiles against whatever pin the creator's
// project happens to carry.
const CL_PLAYER = 4
const CL_MAIN_PLAYER = 8
const SPHERE_MESH = 1

type NameValue = { value: string }
type NameComponent = LastWriteWinElementSetComponentDefinition<NameValue>

// Every placed zone bundles its own copy of this script, so the component may
// already be defined by a sibling copy (the seat prefab does the same).
function nameComponent(): NameComponent {
  const existing = engine.getComponentOrNull('core-schema::Name')
  if (existing !== null) return existing as NameComponent
  return engine.defineComponent('core-schema::Name', { value: Schemas.String })
}

// TriggerAreaResult carries plain numbers; Entity is the branded form of the
// same id. 0 is the root, never an avatar.
function toEntity(raw?: number): Entity | undefined {
  return raw === undefined || raw === 0 ? undefined : (raw as Entity)
}

export class TriggerZone {
  private members = new Membership<Entity>()
  private zone = ''

  constructor(
    public src: string,
    public entity: Entity,
    /**
     * Whose client reacts. "this player" is right for anything that happens to
     * the person who walked in; "any player" also fires for other avatars.
     */
    public who: 'this player' | 'any player' = 'this player',
    /** How often an entry may fire */
    public fireWhen: 'every time' | 'once per player' | 'once ever' = 'every time',
    /**
     * Seconds a player may step back out before the zone counts them as gone.
     * Deliberately NOT called a cooldown: this is boundary hysteresis, nothing to
     * do with how often a reaction may fire — a reaction owns its own rate limit.
     */
    public exitDelay: number = 0.3
  ) {}

  start(): void {
    // The local avatar's collider is CL_PLAYER|CL_MAIN_PLAYER and every remote
    // avatar's is CL_PLAYER alone, so masking on 8 settles "this player only" in
    // rapier — cheaper and safer than a JS identity guard.
    const mask = this.who === 'this player' ? CL_MAIN_PLAYER : CL_PLAYER
    if (TriggerArea.getOrNull(this.entity)?.mesh === SPHERE_MESH) {
      TriggerArea.setSphere(this.entity, mask)
    } else {
      TriggerArea.setBox(this.entity, mask)
    }

    this.zone = nameComponent().getOrNull(this.entity)?.value ?? ''
    publishZone(this.zone, this.entity, () => this.members.list())

    // triggerAreaEventsSystem keeps exactly ONE callback per (entity, event):
    // anything else subscribing to this entity silently replaces the zone's own
    // detector. Consumers use the bus, never onTriggerEnter.
    triggerAreaEventsSystem.onTriggerEnter(this.entity, (result) => this.seen(result.trigger?.entity))
    triggerAreaEventsSystem.onTriggerStay(this.entity, (result) => this.seen(result.trigger?.entity))
    triggerAreaEventsSystem.onTriggerExit(this.entity, (result) => this.gone(result.trigger?.entity))
  }

  update(dt: number): void {
    for (const who of this.members.tick(dt, this.exitDelay)) {
      emitZone(this.zone, 'exit', who, this.entity)
    }
  }

  // result.trigger.entity is the avatar that moved; result.triggeredEntity is
  // this area. Reading the wrong one is a silent no-op.
  private seen(raw?: number): void {
    const who = toEntity(raw)
    if (who === undefined) return
    if (this.members.touch(who, this.fireWhen)) emitZone(this.zone, 'enter', who, this.entity)
  }

  private gone(raw?: number): void {
    const who = toEntity(raw)
    if (who === undefined) return
    this.members.drop(who)
  }
}
