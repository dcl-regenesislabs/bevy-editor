// Decode (and encode) the custom (non-engine-managed) components the engine can't name. The
// bevy sidecar captures components it doesn't recognize and surfaces them in /crdt_snapshot as
// raw bytes keyed by their numeric component id; each value is `"<lww-timestamp>:<base64>"` (an
// array of those for grow-only). Here we map those numeric ids back to the SDK component
// definitions, decode the bytes into typed values for display, and — for write-back — encode an
// edited value and emit it via /set_component_raw (which needs a newer timestamp to win LWW).

import { Name, Tags, SyncComponents, NetworkEntity, NetworkParent } from '@dcl/sdk/ecs'
import { ReadWriteByteBuffer } from '@dcl/ecs/dist/serialization/ByteBuffer'
import { CUSTOM_REGISTRY_DEFS } from './custom-registry'
import { type Snapshot } from './state'

// Minimal view of the SDK component-definition surface we use to decode/encode raw bytes.
type CustomDef = {
  componentId: number
  componentName: string
  schema: {
    deserialize: (reader: ReadWriteByteBuffer) => unknown
    serialize: (value: unknown, builder: ReadWriteByteBuffer) => void
    create: () => unknown
  }
}

// All known custom component definitions, each bound to the scene engine — so `componentId` is
// the numeric id the snapshot keys these by, and `schema` decodes/encodes the raw bytes. The
// SDK-exported core-schema:: set (Name/Tags/Sync/Network) plus the asset-packs:: / inspector::
// set replicated from the Creator Hub registries (custom-registry).
const CUSTOM_DEFS = [
  Name,
  Tags,
  SyncComponents,
  NetworkEntity,
  NetworkParent,
  ...CUSTOM_REGISTRY_DEFS
] as unknown as CustomDef[]

const BY_ID = new Map<number, CustomDef>()
const BY_NAME = new Map<string, CustomDef>()
for (const def of CUSTOM_DEFS) {
  BY_ID.set(def.componentId, def)
  BY_NAME.set(def.componentName, def)
}

// The component name the editor stores the entity's name under, post-decode.
export const NAME_COMPONENT = (Name as unknown as CustomDef).componentName

// Current LWW timestamp of each decoded custom component, keyed `${entityId}/${componentName}`;
// a write-back sends current+1 so the new value wins LWW. Repopulated on every decode.
const timestamps = new Map<string, number>()

const NUMERIC = /^\d+$/

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INV = ((): Int16Array => {
  const t = new Int16Array(256).fill(-1)
  for (let i = 0; i < B64_ALPHABET.length; i++) t[B64_ALPHABET.charCodeAt(i)] = i
  return t
})()

// base64 <-> bytes without atob/btoa (absent in the scene runtime).
function base64ToBytes(b64: string): Uint8Array {
  let len = b64.length
  while (len > 0 && b64[len - 1] === '=') len--
  const out = new Uint8Array((len * 3) >> 2)
  let o = 0
  let acc = 0
  let bits = 0
  for (let i = 0; i < len; i++) {
    const v = B64_INV[b64.charCodeAt(i)]
    if (v < 0) continue
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += B64_ALPHABET[b0 >> 2]
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '='
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 63] : '='
  }
  return out
}

// Split a snapshot custom value `"<ts>:<base64>"` into its timestamp and bytes.
function splitTsB64(s: string): { ts: number; b64: string } {
  const i = s.indexOf(':')
  if (i < 0) return { ts: 0, b64: s }
  return { ts: Number(s.slice(0, i)) || 0, b64: s.slice(i + 1) }
}

function decodeBytes(def: CustomDef, b64: string): unknown {
  return def.schema.deserialize(new ReadWriteByteBuffer(base64ToBytes(b64)))
}

// Rewrite each entity's numeric-id-keyed custom components (raw `"ts:base64"` from the sidecar)
// into their decoded `{ componentName: value }` form, in place, and record their timestamps.
// LWW → a single value; grow-only → an array. Unknown ids (no SDK definition yet) and
// undecodable entries are left as-is so nothing is silently dropped.
export function decodeCustomComponents(snapshot: Snapshot): void {
  timestamps.clear()
  for (const [entityId, comps] of Object.entries(snapshot)) {
    for (const key of Object.keys(comps)) {
      if (!NUMERIC.test(key)) continue
      const def = BY_ID.get(Number(key))
      if (def === undefined) continue
      const raw = comps[key]
      try {
        let ts = 0
        let value: unknown
        if (Array.isArray(raw)) {
          value = raw.map((s) => {
            const { ts: t, b64 } = splitTsB64(s as string)
            ts = Math.max(ts, t)
            return decodeBytes(def, b64)
          })
        } else {
          const { ts: t, b64 } = splitTsB64(raw as string)
          ts = t
          value = decodeBytes(def, b64)
        }
        delete comps[key]
        // Normalise to plain JSON so unset Optional fields (which deserialize to `undefined`)
        // are dropped rather than left as explicit `undefined` — matching the shape of the
        // engine's JSON component values, which the editor's renderer expects.
        comps[def.componentName] = JSON.parse(JSON.stringify(value))
        timestamps.set(`${entityId}/${def.componentName}`, ts)
      } catch {
        // leave the raw entry in place if it doesn't decode against this schema
      }
    }
  }
}

// Whether `name` is a custom (non-engine-managed) component the editor must write via
// /set_component_raw rather than /set_component.
export function isCustomComponent(name: string): boolean {
  return BY_NAME.has(name)
}

export function customComponentId(name: string): number | undefined {
  return BY_NAME.get(name)?.componentId
}

// Custom component names that can be added to an entity — the user-managed namespaces
// (core-schema::, asset-packs::), excluding the inspector:: tooling state the editor keeps but
// never surfaces.
export function customComponentNames(): string[] {
  return [...BY_NAME.keys()].filter((n) => !n.startsWith('inspector::'))
}

// A fresh default value for a custom component, built locally from its SDK schema (the engine's
// /component_default can't address custom components). Normalised to plain JSON so unset Optional
// fields (which `create()` leaves undefined) drop out, matching the decoded snapshot shape.
export function createCustomDefault(name: string): unknown | undefined {
  const def = BY_NAME.get(name)
  if (def === undefined) return undefined
  return JSON.parse(JSON.stringify(def.schema.create() ?? {}))
}

// The LWW timestamp the editor last saw for this custom component (0 if unseen).
export function customTimestamp(entityId: string, name: string): number {
  return timestamps.get(`${entityId}/${name}`) ?? 0
}

// UTF-8 encode a string (no TextEncoder in the scene runtime).
function utf8Bytes(s: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c < 0x80) {
      out.push(c)
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(++i)
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff)
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    }
  }
  return new Uint8Array(out)
}

// Standard base64 of a string's UTF-8 bytes — used to ship the composite to /save_composite.
export function stringToBase64(s: string): string {
  return bytesToBase64(utf8Bytes(s))
}

// componentName + jsonSchema for every known custom component, for the composite builder.
export function customComponentDefs(): Array<{ componentName: string; jsonSchema: unknown }> {
  return CUSTOM_DEFS.map((d) => ({
    componentName: d.componentName,
    jsonSchema: (d.schema as { jsonSchema?: unknown }).jsonSchema
  }))
}

// Encode an edited custom component value to base64 via its SDK schema, for /set_component_raw.
// Returns undefined if the component isn't a known custom one. Throws if the value doesn't match
// the schema (e.g. a missing required field).
export function encodeCustomComponent(name: string, value: unknown): string | undefined {
  const def = BY_NAME.get(name)
  if (def === undefined) return undefined
  const buf = new ReadWriteByteBuffer()
  def.schema.serialize(value, buf)
  return bytesToBase64(buf.toBinary())
}

// The entity's authored name (core-schema::Name) if set, else undefined — used to label tree
// rows. Must run after decodeCustomComponents.
export function entityName(snapshot: Snapshot, id: string): string | undefined {
  const name = snapshot[id]?.[NAME_COMPONENT] as { value?: string } | undefined
  return typeof name?.value === 'string' && name.value !== '' ? name.value : undefined
}
