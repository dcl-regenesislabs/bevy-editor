// What to call an entity that carries no Name. The hierarchy used to fall back to
// the raw entity id ("#517"), which tells a creator nothing and is version-packed
// noise besides. Everything here is derived from the entity's own components, so
// it needs no new plumbing — and it applies to authored-but-unnamed rows too, not
// just code-spawned ones.
import type { Snapshot } from './state'
import { entityName } from './custom-components'

export interface EntityKind {
  /** the row's main label — only the last-resort branch involves an id */
  primary: string
  /** true when `primary` was derived from components rather than read from a Name */
  derived: boolean
  /** the small grey noun after it; null when `primary` already names the kind */
  detail: string | null
}

// Protobuf oneofs reach the snapshot in ENGINE form — { box: {} }, not
// { $case: 'box', box: {} } (see the fixture at viewport/pick-layer.test.ts:53).
// Unset optionals arrive as null, so skip null values.
function activeCase(v: unknown): string | null {
  if (v === null || typeof v !== 'object') return null
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val !== null && val !== undefined) return k
  }
  return null
}

function field(comps: Record<string, unknown>, comp: string, key: string): string | null {
  const c = comps[comp] as Record<string, unknown> | undefined
  const v = c?.[key]
  return typeof v === 'string' && v !== '' ? v : null
}

function basename(src: string, keepExt: boolean): string {
  const file = src.split(/[\\/]/).filter((p) => p !== '').pop() ?? src
  if (keepExt) return file
  const dot = file.lastIndexOf('.')
  return dot > 0 ? file.slice(0, dot) : file
}

function clip(s: string, n = 28): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length <= n ? one : `${one.slice(0, n - 1)}…`
}

const MESH: Record<string, string> = {
  box: 'Box',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  plane: 'Plane',
  gltf: 'Gltf mesh'
}

// SDK7 reserves the first ids for the engine. They carry engine-output components
// whose names ("AvatarBase", "CameraMode") mean nothing to a creator.
const RESERVED_NAMES: Record<string, string> = { '0': 'Scene root', '1': 'Player', '2': 'Camera' }

export function describeEntity(snapshot: Snapshot, id: string, hasChildren: boolean): EntityKind {
  const comps = snapshot[id] ?? {}
  const reserved = Number(id)
  if (Number.isFinite(reserved) && reserved < 512) {
    return { primary: RESERVED_NAMES[id] ?? 'Engine', derived: true, detail: null }
  }
  const derive = (primary: string, detail: string | null = null): EntityKind => ({
    primary,
    derived: true,
    detail
  })

  // An author-supplied name beats every derivation, on code entities too.
  const name = entityName(snapshot, id)
  if (name !== undefined) {
    const model = field(comps, 'GltfContainer', 'src')
    return { primary: name, derived: false, detail: model === null ? null : basename(model, false) }
  }

  // Any Ui* component marks a screen-space node. These only surface under
  // showEngine, but they must not fall through to 'Empty'.
  for (const k of Object.keys(comps)) {
    if (k.startsWith('Ui')) {
      const text = field(comps, 'UiText', 'value')
      return derive(text === null ? 'UI node' : `"${clip(text)}"`, 'ui')
    }
  }

  const gltf = field(comps, 'GltfContainer', 'src')
  if (gltf !== null) return derive(basename(gltf, false), 'model')

  // For text the content IS the identity.
  const text = field(comps, 'TextShape', 'text')
  if (text !== null) return derive(`"${clip(text)}"`, 'text')

  // The last two urn segments are the contract/token.
  const urn = field(comps, 'NftShape', 'urn')
  if (urn !== null) return derive(urn.split(':').slice(-2).join(':'), 'NFT')

  const video = field(comps, 'VideoPlayer', 'src')
  if (video !== null) return derive(basename(video, true), 'video')

  const clipUrl = field(comps, 'AudioSource', 'audioClipUrl')
  if (clipUrl !== null) return derive(basename(clipUrl, false), 'sound')
  const stream = field(comps, 'AudioStream', 'url')
  if (stream !== null) {
    // no URL global here: this module is bundled into the SDK7 scene runtime,
    // which has no DOM lib. The host is all a stream URL usefully gives us.
    const host = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(stream)
    return derive(host === null ? stream : host[1], 'stream')
  }

  if (comps.AvatarShape !== undefined) {
    const an = field(comps, 'AvatarShape', 'name') ?? field(comps, 'AvatarShape', 'id')
    return derive(an ?? 'NPC', 'avatar')
  }

  // The single most common code entity in this repo: seat.ts spawns one sphere
  // per sit spot, across 23 built-in prefabs.
  const mesh = activeCase((comps.MeshRenderer as { mesh?: unknown } | undefined)?.mesh)
  if (mesh !== null) return derive(MESH[mesh] ?? 'Mesh', null)

  const light = activeCase((comps.LightSource as { type?: unknown } | undefined)?.type)
  if (light !== null) return derive(light === 'spot' ? 'Spot light' : 'Point light', null)

  // An invisible collider is otherwise undiagnosable.
  const collider = activeCase((comps.MeshCollider as { mesh?: unknown } | undefined)?.mesh)
  if (collider !== null) return derive('Collider', collider)

  const pe = (comps.PointerEvents as { pointerEvents?: Array<{ eventInfo?: { hoverText?: string } }> } | undefined)
    ?.pointerEvents
  if (Array.isArray(pe) && pe.length > 0) {
    const hover = pe[0]?.eventInfo?.hoverText
    return derive(typeof hover === 'string' && hover !== '' ? `Click: "${clip(hover, 20)}"` : 'Click target', 'click')
  }

  // Real SDK components that carry no identifying payload of their own — without
  // these they fall to the last-resort branch and read as raw component names.
  if (comps.TriggerArea !== undefined) return derive('Trigger area', null)
  if (comps.AvatarModifierArea !== undefined) return derive('Avatar modifier area', null)
  if (comps.CameraModeArea !== undefined) return derive('Camera mode area', null)
  if (comps.AvatarAttach !== undefined) return derive('Attached to avatar', null)
  if (comps.VirtualCamera !== undefined) return derive('Virtual camera', null)

  const keys = Object.keys(comps).filter((k) => k !== 'Transform')
  if (keys.length === 0) return derive(hasChildren ? 'Group' : 'Empty', null)

  // Last resort — always terminates, never returns a bare id as the primary.
  // The id (low 16 bits, version stripped) is demoted to the grey detail so the
  // row stays identifiable.
  const first = keys[0].includes('::') ? keys[0].split('::').pop() ?? keys[0] : keys[0]
  return derive(first, `#${Number(id) & 0xffff}`)
}
