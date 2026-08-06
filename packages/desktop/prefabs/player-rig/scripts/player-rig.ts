// One rig per player: a nameplate and a health bar anchored to every avatar in
// the scene, plus a right-hand anchor to hang a held item from. Hit points are
// owned by the Multiplayer Server — clients only render the number it publishes.
//
// The same class runs in three places and picks its half from what it finds:
//
//   server            no clone exists (per-player rigs are client-local), so the
//                     placed rig is the authority: it owns the vitals in
//                     Storage.player and validates every damage/heal/respawn
//                     request on the outcomes.rig ledger.
//   client, clone     a rig the per-player pool built for one wallet. Renders
//                     that player's bar and plate, sets AvatarAttach.avatarId.
//   client, placed    the authoring anchor. Opens the per-player pool if the
//                     generated registry has not already opened one.
//
// HONESTY NOTE, repeated in the guide and the prefab card: the health NUMBER is
// server truth. The bar's POSITION is cosmetic — it is drawn from each client's
// own view of where that avatar is, so it can lag or sit slightly off.
import {
  AvatarAttach,
  Material,
  MeshRenderer,
  TextShape,
  Transform,
  VisibilityComponent,
  engine,
  type Entity
} from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/players'
import * as spawner from './runtime/spawner'
import { outcomes, type OutcomeEntry } from './runtime/outcomes'
import { playerPositions } from './runtime/playerPositions'
import { createPlayerStore, type PlayerStore } from './runtime/playerStore'
import {
  DEFAULT_RIG_RULES,
  RIG_SCHEMA_VERSION,
  addressInstanceId,
  applyDamage,
  applyHeal,
  applyRespawn,
  barColor,
  barFraction,
  combatFrom,
  defaultVitals,
  repairVitals,
  respawnDue,
  rulesFrom,
  shortAddress,
  type RigCombat,
  type RigRules,
  type RigVitals
} from './pure/rigState'

/** A prefab id picked in the inspector's prefab dropdown. */
type PrefabRef = string

const RIG_LEDGER = 'rig'
// outcomes.ts stamps the server's own reports with this instead of a wallet.
const SERVER_ORIGIN = 'server'
const HEAD_ANCHOR = 1
const BAR_WIDTH = 0.96
const RESOLVE_INTERVAL_S = 0.5
const FLUSH_INTERVAL_S = 20

const ledger = outcomes(RIG_LEDGER)

// Every clone on this client, keyed by the instance id the ledger broadcasts
// against, so one ledger subscription feeds all of them.
const rigs = new Map<number, PlayerRig>()
let subscribed = false

interface RigParts {
  head: Entity | null
  bar: Entity | null
  fill: Entity | null
  plate: Entity | null
}

export class PlayerRig {
  private parts: RigParts = { head: null, bar: null, fill: null, plate: null }
  private rules: RigRules = DEFAULT_RIG_RULES
  private clone = false
  private instanceId = 0
  private address = ''
  private plateText = ''
  private hp = 0
  private sinceResolve = 0
  private authority: RigAuthority | null = null

  constructor(
    public src: string,
    public entity: Entity,
    /** The Player Rig prefab itself — the per-player pool clones it. */
    public rig: PrefabRef = '',
    public maxHp: number = 100,
    public lives: number = 3,
    public respawnSeconds: number = 5,
    public spawnProtectionSeconds: number = 2,
    public showHealthBar: boolean = true
  ) {}

  start(): void {
    this.rules = rulesFrom({
      maxHp: this.maxHp,
      maxLives: this.lives,
      respawnMs: Math.round(this.respawnSeconds * 1000),
      spawnProtectionMs: Math.round(this.spawnProtectionSeconds * 1000)
    })
    if (isServer()) {
      this.authority = new RigAuthority(this.rules)
      this.authority.arm()
      return
    }

    this.parts = collectParts(this.entity)
    this.hp = this.rules.maxHp
    if (!this.showHealthBar) this.hideBar()

    const from = spawner.spawnedFrom(this.entity)
    if (from === null) {
      // The authoring anchor. Its AvatarAttach has no avatarId, so left alone it
      // resolves to the LOCAL player and every avatar wears a frozen full-HP
      // duplicate on top of its real per-player clone. Hide the whole subtree —
      // the anchor exists to be edited and captured, never to be seen in play.
      hideSubtree(this.entity)
      // The generated registry normally opens the pool for a perPlayer prefab;
      // opening it here too is the fallback for a scene whose registry has not
      // been regenerated yet. A stale ref (prefab deleted) throws, and a throw
      // out of start() aborts every script the runner has not started yet plus
      // the scene's own main().
      try {
        if (this.rig !== '' && spawner.poolFor(this.rig) === null) spawner.perPlayer(this.rig)
      } catch (error) {
        console.log('[PlayerRig] the "rig" param is not a Spawnable prefab —', error)
      }
      return
    }

    this.clone = true
    this.instanceId = from.instanceId
    rigs.set(this.instanceId, this)
    subscribe()
    for (const entry of ledger.snapshot()) {
      if (entry.instanceId === this.instanceId) this.hp = entry.value
    }
    this.renderBar()
    this.resolveOwner()
  }

  update(dt: number): void {
    if (this.authority !== null) {
      this.authority.tick(dt)
      return
    }
    if (!this.clone || this.address !== '') return
    this.sinceResolve += dt
    if (this.sinceResolve < RESOLVE_INTERVAL_S) return
    this.sinceResolve = 0
    this.resolveOwner()
  }

  detach(): void {
    if (this.clone) rigs.delete(this.instanceId)
  }

  /** Called from the ledger subscription when this rig's hit points change. */
  applyHp(hp: number): void {
    this.hp = hp
    this.renderBar()
  }

  private resolveOwner(): void {
    const address = addressForInstance(this.instanceId)
    if (address === null) return
    this.address = address
    for (const child of childrenOf(this.entity)) {
      const attach = AvatarAttach.getOrNull(child)
      if (attach === null) continue
      AvatarAttach.createOrReplace(child, { anchorPointId: attach.anchorPointId, avatarId: address })
    }
    this.setPlate(getPlayer({ userId: address })?.name ?? shortAddress(address))
  }

  private setPlate(text: string): void {
    if (this.parts.plate === null || text === this.plateText) return
    this.plateText = text
    const shape = TextShape.getMutableOrNull(this.parts.plate)
    if (shape !== null) shape.text = text
  }

  private renderBar(): void {
    const fill = this.parts.fill
    if (fill === null || !this.showHealthBar) return
    const fraction = barFraction(this.hp, this.rules.maxHp)
    const transform = Transform.getMutableOrNull(fill)
    if (transform !== null) {
      transform.scale.x = BAR_WIDTH * fraction
      transform.position.x = -(BAR_WIDTH / 2) * (1 - fraction)
    }
    const color = barColor(fraction)
    Material.createOrReplace(fill, {
      material: {
        $case: 'unlit',
        unlit: { diffuseColor: { r: color.r, g: color.g, b: color.b, a: 1 }, castShadows: false }
      }
    })
  }

  private hideBar(): void {
    for (const part of [this.parts.bar, this.parts.plate]) {
      if (part !== null) VisibilityComponent.createOrReplace(part, { visible: false })
    }
  }
}

// The server half. Kept in its own class so the render half above never has to
// branch on isServer() past start(), and so nothing here is reachable on a client.
class RigAuthority {
  private store: PlayerStore<RigVitals>
  private combat = new Map<string, RigCombat>()
  private byInstance = new Map<number, string>()
  private loading = new Set<string>()
  private sinceFlush = 0

  constructor(private rules: RigRules) {
    this.store = createPlayerStore<RigVitals>({
      key: `rig.${RIG_SCHEMA_VERSION}`,
      schemaVersion: RIG_SCHEMA_VERSION,
      defaults: () => defaultVitals(rules),
      repair: (value, defaults) => repairVitals(value, defaults)
    })
  }

  arm(): void {
    ledger.validate('damage', (payload, from) => this.judge(from, payload, 'damage'))
    ledger.validate('heal', (payload, from) => this.judge(from, payload, 'heal'))
    ledger.validate('respawn', (payload, from) => this.judge(from, payload, 'respawn'))
  }

  tick(dt: number): void {
    const now = Date.now()
    // Respawns go back out through report() so every client sees the restored
    // hit points on the same channel as every other change.
    for (const [address, combat] of this.combat) {
      if (respawnDue(combat, now)) ledger.report('respawn', { instanceId: addressInstanceId(address) })
    }
    this.sinceFlush += dt
    if (this.sinceFlush < FLUSH_INTERVAL_S) return
    this.sinceFlush = 0
    void this.store.saveDirty()
  }

  // One entry point for all three kinds: for a client the caller is context.from,
  // never the payload, so a request claiming someone else's instance id is
  // refused outright rather than quietly applied to the caller. The server's own
  // reports arrive as 'server' — a value no wallet can take — and address the
  // instance directly.
  private judge(
    from: string,
    payload: { instanceId: number; amount?: number },
    kind: 'damage' | 'heal' | 'respawn'
  ): { ok: true; value: number } | { ok: false; reason: string } {
    const fromServer = from === SERVER_ORIGIN
    const address = fromServer ? (this.byInstance.get(payload.instanceId) ?? '') : from.toLowerCase()
    if (address === '') return { ok: false, reason: 'unknown player' }
    if (!fromServer && payload.instanceId !== addressInstanceId(address)) {
      return { ok: false, reason: 'instance mismatch' }
    }
    const combat = this.combat.get(address)
    if (combat === undefined) {
      this.beginLoad(address)
      return { ok: false, reason: 'vitals still loading' }
    }
    const now = Date.now()
    const amount = payload.amount ?? 1
    const verdict =
      kind === 'damage'
        ? applyDamage(combat, this.rules, amount, now)
        : kind === 'heal'
          ? applyHeal(combat, this.rules, amount, now)
          : applyRespawn(combat, this.rules, now)
    if (!verdict.ok) return verdict
    this.persist(address, combat)
    if (verdict.dead) void this.store.save(address)
    return { ok: true, value: verdict.hp }
  }

  // A first request is refused, not queued: the load is a Storage round trip and
  // an unloaded player would otherwise take damage against default hit points
  // that the stored ones are about to overwrite.
  private beginLoad(address: string): void {
    if (this.loading.has(address)) return
    this.loading.add(address)
    void this.store.load(address).then((vitals) => {
      this.loading.delete(address)
      if (this.combat.has(address)) return
      this.combat.set(address, combatFrom(vitals, this.rules, Date.now()))
      this.byInstance.set(addressInstanceId(address), address)
    })
  }

  private persist(address: string, combat: RigCombat): void {
    this.store.mutate(address, (vitals) => {
      if (combat.hp === 0 && vitals.hp > 0) vitals.deaths += 1
      vitals.hp = combat.hp
      vitals.lives = combat.lives
    })
  }
}

function subscribe(): void {
  if (subscribed) return
  subscribed = true
  ledger.onOutcome((entry: OutcomeEntry) => {
    rigs.get(entry.instanceId)?.applyHp(entry.value)
  })
}

// The per-player pool never sends a roster: it keys each clone by the hash of
// the wallet it built the clone for, so the owner is recovered by hashing the
// avatars this client can see and matching.
function addressForInstance(instanceId: number): string | null {
  for (const player of playerPositions()) {
    if (addressInstanceId(player.address) === instanceId) return player.address
  }
  return null
}

function childrenOf(parent: Entity): Entity[] {
  const found: Entity[] = []
  for (const [entity, transform] of engine.getEntitiesWith(Transform)) {
    if (transform.parent === parent) found.push(entity)
  }
  return found
}

// Parts are found by SHAPE, never by name: the generated snapshot strips
// core-schema::Name from every clone, so a name lookup would work on the placed
// rig and silently find nothing on all 32 clones.
// Every entity in the anchor's Transform subtree, the anchor itself included.
function hideSubtree(root: Entity): void {
  VisibilityComponent.createOrReplace(root, { visible: false })
  for (const child of childrenOf(root)) hideSubtree(child)
}

function collectParts(root: Entity): RigParts {
  const parts: RigParts = { head: null, bar: null, fill: null, plate: null }
  for (const child of childrenOf(root)) {
    if (AvatarAttach.getOrNull(child)?.anchorPointId === HEAD_ANCHOR) parts.head = child
  }
  if (parts.head === null) return parts
  for (const child of childrenOf(parts.head)) {
    if (TextShape.getOrNull(child) !== null) parts.plate = child
    else if (MeshRenderer.getOrNull(child) !== null) parts.bar = child
  }
  if (parts.bar === null) return parts
  for (const child of childrenOf(parts.bar)) {
    if (MeshRenderer.getOrNull(child) !== null) parts.fill = child
  }
  return parts
}
