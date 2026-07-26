// The editor message bus: messages exchanged between the host page UI (React)
// and the in-engine editor scene over the explorer's `/editor_send` +
// `/editor_poll` console commands. The page polls target "page"; the scene polls
// target "scene". This is the SINGLE source of truth for the protocol — both the
// scene package and the ui package import it from here.

// Minimal parcel coord — kept dependency-free so the desktop/contract packages
// don't pull in @dcl/sdk. The scene package maps to/from @dcl/sdk's Vector2.
export interface ParcelCoord {
  x: number
  y: number
}

export interface LiveSceneInfo {
  hash: string
  base_url?: string
  title: string
  parcels: ParcelCoord[]
  isPortable: boolean
  isBroken: boolean
  isBlocked: boolean
  isSuper: boolean
  sdkVersion: string
}

export type EditorTool = 'select' | 'translate' | 'rotate' | 'scale'

export type CameraMode = 'off' | 'free' | 'target'

export type NodeDisplay = 'always' | 'selected' | 'selecting'

export type PageToSceneMessage =
  | { type: 'init' } // page UI announces itself; scene hides its panels and replies scene-ready
  | { type: 'set-tool'; tool: EditorTool }
  | {
      type: 'set-flags'
      orientGlobal?: boolean
      pivotEach?: boolean
      nodeDisplay?: NodeDisplay
      showLinks?: boolean
      snap?: boolean
      showSpawnAreas?: boolean
    }
  // scene.json's spawnPoints — read by the desktop shell, drawn by the scene
  | { type: 'spawn-points'; points: unknown[] }
  | { type: 'set-selection'; selected: string[]; active: string | null }
  | { type: 'set-camera'; mode: CameraMode; axis?: string }
  // the page owns the transport; the scene's own frozen flag gates avatar input
  // and the free camera, and it samples the engine only once at boot
  | { type: 'set-frozen'; frozen: boolean }
  // frame an entity. orbit !== false → lock the orbit camera onto it (explicit
  // Focus). orbit === false → frame ONCE in free mode (import/place); orbit would
  // chase the entity on every later move and glitch the view.
  | { type: 'focus'; entity: string; orbit?: boolean }
  | { type: 'refresh' } // page changed scene content; scene re-pulls (running scenes only)
  // the pointer was released over a DOM panel mid gizmo-drag — the scene's engine
  // input misses that release, so the page forwards it to avoid a ghost-drag
  | { type: 'pointer-up' }
  // scroll wheel over the viewport while flying: multiplicative speed change
  | { type: 'fly-speed'; factor: number }
  | { type: 'resync' } // unconditional re-pull (after a scene restart the frozen CRDT is fresh)
  // mirror a page-side mutation into the scene's snapshot — /crdt_snapshot is
  // stale while the scene is frozen, so a refetch can't carry these
  | { type: 'component-written'; entity: string; name: string; json: string }
  | { type: 'component-deleted'; entity: string; name: string }
  | { type: 'entity-deleted'; entity: string; recursive: boolean }
  | { type: 'rpc'; id: number; method: string; args?: unknown[] }

export type SceneToPageMessage =
  | {
      type: 'scene-ready'
      // every message kind this scene build understands — see PROTOCOL_KINDS
      kinds?: readonly string[]
      scene: LiveSceneInfo | null
      frozen: boolean
      tool: EditorTool
      orientGlobal: boolean
      pivotEach: boolean
      selected: string[]
      active: string | null
    }
  | { type: 'selection'; selected: string[]; active: string | null }
  | { type: 'drag-start' }
  // gizmo drag in progress — the scene's live transforms, on the bus tick, so the
  // inspector's number fields track the drag instead of jumping at release
  | { type: 'drag-update'; transforms: Record<string, unknown> }
  // gizmo drag finished — carries the final transforms (frozen scenes can't be re-pulled)
  | { type: 'drag-end'; transforms: Record<string, unknown> }
  | { type: 'tool'; tool: EditorTool }
  | { type: 'rpc-reply'; id: number; ok: boolean; result?: unknown; error?: string }

// The protocol's vocabulary: every message kind either side can send. The scene
// announces its own copy on scene-ready, so when the engine loads a stale cached
// bundle the page can name exactly which messages that build doesn't know —
// instead of comparing an ordinal that only helps if someone remembered to bump it.
//
// `satisfies` rejects a kind that no message declares; UnlistedProtocolKind below
// rejects a message added to a union but not listed here. Between them the list
// cannot drift from the types, which is the whole point of it not being a number.
export const PROTOCOL_KINDS = [
  // page → scene
  'init',
  'set-tool',
  'set-flags',
  'spawn-points',
  'set-selection',
  'set-camera',
  'set-frozen',
  'focus',
  'refresh',
  'pointer-up',
  'fly-speed',
  'resync',
  'component-written',
  'component-deleted',
  'entity-deleted',
  'rpc',
  // scene → page
  'scene-ready',
  'selection',
  'drag-start',
  'drag-update',
  'drag-end',
  'tool',
  'rpc-reply'
] as const satisfies readonly (PageToSceneMessage['type'] | SceneToPageMessage['type'])[]

export type ProtocolKind = (typeof PROTOCOL_KINDS)[number]

// A message kind the unions declare but PROTOCOL_KINDS omits. Adding a message
// without listing it makes the assignment below fail, naming the omission.
type UnlistedProtocolKind = Exclude<PageToSceneMessage['type'] | SceneToPageMessage['type'], ProtocolKind>
export const PROTOCOL_KINDS_COMPLETE: [UnlistedProtocolKind] extends [never]
  ? true
  : UnlistedProtocolKind = true
