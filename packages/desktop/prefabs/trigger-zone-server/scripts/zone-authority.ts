// Server-side verification for named trigger zones. A client's zone events are
// client-trusted by design (only the client has avatar colliders), so anything
// worth cheating for asks the Multiplayer Server to confirm the claim first:
//
//   const ok = await verifyZoneEntry('Vault')   // consumer script, client side
//
// The server never trusts the payload for identity — the caller is context.from,
// the wallet the transport already authenticated — and re-derives the position
// itself from the avatar transforms it receives over comms.
import {
  Schemas,
  Transform,
  TriggerArea,
  engine,
  type LastWriteWinElementSetComponentDefinition
} from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { playerPosition, sceneLocalPosition } from './runtime/playerPositions'
import { zoneKey } from './runtime/pure/zoneRegistry'
import { createRpc } from './runtime/rpc'
import { insideZone, type Quat, type Vec3, type ZoneShape } from './zone-geometry'

// Namespace and method names are the wire contract with consumer scripts; they
// outlive this file. createRpc registers schemas, so it runs at module scope.
const rpc = createRpc('zone')

const SWEEP_S = 0.25
const DEFAULT_SLACK_M = 1
// A member whose position the server cannot see at all (still loading, comms
// hiccup) keeps their place this long before the sweep gives up on them.
const LOST_GRACE_MS = 10_000
const SPHERE_MESH = 1

interface Zone {
  shape: ZoneShape
  center: Vec3
  rotation: Quat
  scale: Vec3
}

type NameValue = { value: string }
type NameComponent = LastWriteWinElementSetComponentDefinition<NameValue>

// zone key -> wallet -> the ms at which the server lost sight of that wallet's
// position, 0 while it can see them.
const verified = new Map<string, Map<string, number>>()
let started = false
let slackM = DEFAULT_SLACK_M
let logRejections = true

/** Server: start answering zone.enter and sweeping the verified roster. Idempotent. */
export function startZoneAuthority(options: { slack?: number; log?: boolean } = {}): void {
  if (started) return
  started = true
  slackM = options.slack !== undefined && options.slack >= 0 ? options.slack : DEFAULT_SLACK_M
  logRejections = options.log ?? true
  if (!isServer()) return

  rpc.handle('zone.enter', (body, from) => admit(zoneOf(body), from))
  rpc.handle('zone.occupancy', (body) => {
    const zone = zoneOf(body).trim()
    return { zone, addresses: [...(verified.get(zoneKey(zone))?.keys() ?? [])] }
  })

  let accum = 0
  engine.addSystem((dt: number) => {
    accum += dt
    if (accum < SWEEP_S) return
    accum = 0
    sweep()
  }, undefined, 'zone-authority-sweep')
  console.log('[zoneAuthority] server verification ready, slack', slackM, 'm')
}

/** Client: ask the server to confirm this player really is inside `zone`. */
export async function verifyZoneEntry(zone: string): Promise<boolean> {
  try {
    const reply = await rpc.call<unknown>('zone.enter', { zone })
    return isRecord(reply) && reply.ok === true
  } catch {
    // A rejection is an answer: outside the zone, unknown zone, or no server.
    return false
  }
}

/** Client: the wallets the server currently counts as inside `zone`. */
export async function verifiedZoneOccupancy(zone: string): Promise<string[]> {
  try {
    const reply = await rpc.call<unknown>('zone.occupancy', { zone })
    if (!isRecord(reply) || !Array.isArray(reply.addresses)) return []
    return reply.addresses.filter((value): value is string => typeof value === 'string')
  } catch {
    return []
  }
}

/** Server: has this wallet been verified inside `zone` and not swept out since? */
export function verifiedInZone(zone: string, address: string): boolean {
  return verified.get(zoneKey(zone))?.has(address.toLowerCase()) ?? false
}

function admit(zone: string, from: string): { ok: true; verified: boolean } {
  const name = zone.trim()
  if (name === '') throw new Error('zone.enter needs a zone name')
  const key = zoneKey(name)
  const areas = findZones(key)
  if (areas.length === 0) throw new Error(`no zone named "${name}"`)
  const address = from.toLowerCase()
  const position = playerPosition(address)

  // Grace for a late joiner: the server has not received this avatar's transform
  // yet, and rejecting the first entry of every arriving player would be worse
  // than admitting one unverified. The 4 Hz sweep drops them the moment their
  // position arrives outside.
  if (position === null) {
    remember(key, address)
    return { ok: true, verified: false }
  }

  if (!insideAny(areas, position)) {
    forget(key, address)
    if (logRejections) console.log(`[zoneAuthority] rejected ${address}: outside "${name}"`)
    throw new Error(`outside "${name}"`)
  }
  remember(key, address)
  return { ok: true, verified: true }
}

function sweep(): void {
  const now = Date.now()
  for (const [key, members] of [...verified]) {
    const areas = findZones(key)
    for (const [address, lostSinceMs] of [...members]) {
      if (areas.length === 0) {
        members.delete(address)
        continue
      }
      const position = playerPosition(address)
      if (position === null) {
        if (lostSinceMs === 0) members.set(address, now)
        else if (now - lostSinceMs > LOST_GRACE_MS) members.delete(address)
        continue
      }
      if (insideAny(areas, position)) members.set(address, 0)
      else members.delete(address)
    }
    if (members.size === 0) verified.delete(key)
  }
}

function remember(key: string, address: string): void {
  const members = verified.get(key) ?? new Map<string, number>()
  if (!members.has(address)) members.set(address, 0)
  verified.set(key, members)
}

function forget(key: string, address: string): void {
  const members = verified.get(key)
  if (members === undefined) return
  members.delete(address)
  if (members.size === 0) verified.delete(key)
}

function insideAny(areas: Zone[], position: Vec3): boolean {
  return areas.some((area) => insideZone(area.shape, position, area.center, area.rotation, area.scale, slackM))
}

// Zones are resolved by NAME, matched exactly the way zoneBus matches on the
// client (trimmed, case-insensitive) — the name is the only id a zone has, and
// the two sides must agree on the spelling rules or a valid entry reads as a
// forged one. Several areas may share a name; the bus treats them as one place,
// so being inside any of them is being inside the zone.
function findZones(key: string): Zone[] {
  const found: Zone[] = []
  if (key === '') return found
  const names = nameComponent()
  for (const [entity, name] of engine.getEntitiesWith(names, TriggerArea)) {
    if (zoneKey(name.value) !== key) continue
    const transform = Transform.getOrNull(entity)
    // Rotation and scale are the zone's own. The editor places zones at the
    // scene root; a zone reparented under a rotated entity would need the whole
    // chain composed, which only sceneLocalPosition does today.
    const center = sceneLocalPosition(entity)
    if (transform === null || center === null) continue
    found.push({
      shape: TriggerArea.getOrNull(entity)?.mesh === SPHERE_MESH ? 'sphere' : 'box',
      center,
      rotation: transform.rotation,
      scale: transform.scale
    })
  }
  return found
}

// Every placed prefab bundles its own copy of this file, so the component may
// already be defined by a sibling copy.
function nameComponent(): NameComponent {
  const existing = engine.getComponentOrNull('core-schema::Name')
  if (existing !== null) return existing as NameComponent
  return engine.defineComponent('core-schema::Name', { value: Schemas.String })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function zoneOf(body: unknown): string {
  return isRecord(body) && typeof body.zone === 'string' ? body.zone : ''
}
