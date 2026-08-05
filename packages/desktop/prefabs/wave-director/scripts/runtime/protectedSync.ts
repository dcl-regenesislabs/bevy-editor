import { GltfContainer, type Entity } from '@dcl/sdk/ecs'
import { isServer, syncEntity } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'
import { getRealm } from '~system/Runtime'
import { ProtectedLedger, isServerPeer, protectedLogLine, type ProtectedEntry } from './pure/protectedFields'

// The one way to publish a server-owned entity. It fuses the three steps that
// are only correct together — create the components, sync them under a stable
// id, arm a validator on each — so there is no order to get wrong and no
// entity that is synced but unguarded for a frame.
//
//   protectedSync({
//     entity, syncId: SLOT_SYNC_ID,
//     components: [SlotPick],
//     validate: ({ value, from }) => false            // clients may not write
//   })
//
// `validate` judges CLIENT requests only: the auth server's own writes are
// accepted before it is consulted, so a validator that returns false is the
// plain "server-owned, read-only to everyone else" case.
//
// Server-only: validators exist nowhere else, so calling this on a client
// throws rather than pretending to protect anything.
//
// Registration order. A component's FIRST validator must be armed before the
// server announces itself (serverLife's first heartbeat) — after that, a
// racing client's write reaches an unguarded component. Whoever emits that
// heartbeat calls sealProtectedRegistration(); a later first-time registration
// logs `[SERVER] protected-sync {"kind":"late",…}`. Per-entity registrations
// after the seal are normal — pools create entities while the game runs.
//
// Observed authority. Every registration is recorded and, in preview only,
// emitted as a structured `[SERVER] protected-sync {…}` line that the editor
// parses off the Logs stream to draw its observed-authority view.
//
// The registry is anchored on globalThis: every prefab carries its own copy of
// this file, and two ledgers would each see half the truth.

const SYNC_KEY = '__dclProtectedSync_v1'
const QUEUE_LIMIT = 64

export interface ProtectedChange {
  entity: Entity
  component: unknown
  value: unknown
  from: string
}

export interface ProtectedSyncOptions {
  entity: Entity
  /** Stable enum id, so every peer agrees which entity this is across restarts. */
  syncId: number
  /** Component definitions to create, sync and guard. */
  components: unknown[]
  /** Judges client-originated writes; the server's own writes never reach it. */
  validate: (change: ProtectedChange) => boolean
}

export function protectedSync(options: ProtectedSyncOptions): void {
  if (!isServer()) {
    throw new Error('protectedSync is server-only — a client cannot validate anything')
  }

  const components = options.components.map(asProtectedComponent)
  const componentIds: number[] = []
  for (const component of components) {
    if (!component.has(options.entity)) component.create(options.entity)
    componentIds.push(component.componentId)
  }

  syncEntity(options.entity, componentIds, options.syncId)

  for (const component of components) {
    component.validateBeforeChange(options.entity, (change) => {
      if (isServerPeer(change.senderAddress, AUTH_SERVER_PEER_ID)) return true
      return options.validate({
        entity: change.entity,
        component,
        value: change.newValue,
        from: change.senderAddress
      })
    })
  }

  const entry: ProtectedEntry = { entity: Number(options.entity), componentIds }
  const { late } = ledger().record(entry.entity, componentIds)
  if (late.length > 0) {
    console.error(protectedLogLine('late', { entity: entry.entity, componentIds: late }))
  }
  publish(protectedLogLine('registered', entry))
}

/**
 * Release-side reset for pooled server entities: clearing GltfContainer.src
 * makes the renderer drop and reload the model on the next acquire, which is
 * what re-registers its colliders. Reusing the entity without this leaves the
 * previous model's colliders behind.
 */
export function protectedPooledReset(entity: Entity): void {
  const gltf = GltfContainer.getMutableOrNull(entity)
  if (gltf !== null) gltf.src = ''
}

/** What the server currently guards. Read-only view for diagnostics. */
export function protectedRegistry(): ProtectedEntry[] {
  return ledger().entries()
}

/** Called by whoever emits the first heartbeat, once every validator is armed. */
export function sealProtectedRegistration(): void {
  ledger().seal()
}

interface ProtectedChangeInfo {
  entity: Entity
  newValue: unknown
  senderAddress: string
}

interface ProtectedComponent {
  componentId: number
  componentName: string
  has(entity: Entity): boolean
  create(entity: Entity): unknown
  validateBeforeChange(entity: Entity, cb: (change: ProtectedChangeInfo) => boolean): void
}

function asProtectedComponent(value: unknown): ProtectedComponent {
  if (!isProtectedComponent(value)) {
    throw new Error('protectedSync: `components` takes component definitions, not values')
  }
  return value
}

function isProtectedComponent(value: unknown): value is ProtectedComponent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'componentId' in value &&
    typeof value.componentId === 'number' &&
    'componentName' in value &&
    typeof value.componentName === 'string' &&
    'has' in value &&
    typeof value.has === 'function' &&
    'create' in value &&
    typeof value.create === 'function' &&
    'validateBeforeChange' in value &&
    typeof value.validateBeforeChange === 'function'
  )
}

function ledger(): ProtectedLedger {
  const globals = globalThis as unknown as Record<string, unknown>
  const current = globals[SYNC_KEY]
  if (isLedger(current)) return current
  const created = new ProtectedLedger()
  globals[SYNC_KEY] = created
  return created
}

// Byte-identical copies of this file are still separate class identities, so
// probe the shared ledger by shape — instanceof would reject a sibling's.
function isLedger(value: unknown): value is ProtectedLedger {
  return (
    typeof value === 'object' &&
    value !== null &&
    'record' in value &&
    typeof value.record === 'function' &&
    'entries' in value &&
    typeof value.entries === 'function' &&
    'seal' in value &&
    typeof value.seal === 'function'
  )
}

let preview: boolean | null = null
const queued: string[] = []

// The dev gate that actually exists on the pin. If the query never answers (or
// answers "not preview"), the queue is dropped rather than grown.
void getRealm({})
  .then((realm) => {
    preview = realm.realmInfo?.isPreview === true
    flushQueue()
  })
  .catch(() => {
    preview = false
    flushQueue()
  })

function publish(line: string): void {
  if (preview === true) {
    console.log(line)
    return
  }
  if (preview === null && queued.length < QUEUE_LIMIT) queued.push(line)
}

function flushQueue(): void {
  const lines = queued.splice(0)
  if (preview !== true) return
  for (const line of lines) console.log(line)
}
