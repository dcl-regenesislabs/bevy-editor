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
    }
  | { type: 'set-selection'; selected: string[]; active: string | null }
  | { type: 'set-camera'; mode: CameraMode; axis?: string }
  // frame an entity. orbit !== false → lock the orbit camera onto it (explicit
  // Focus). orbit === false → frame ONCE in free mode (import/place); orbit would
  // chase the entity on every later move and glitch the view.
  | { type: 'focus'; entity: string; orbit?: boolean }
  | { type: 'refresh' } // page changed scene content; scene re-pulls (running scenes only)
  // the pointer was released anywhere on the page — the scene's UI misses
  // releases that land on DOM panels, which would leave a gizmo ghost-drag
  | { type: 'pointer-up' }
  // a clean tap on the engine canvas, forwarded by the page — the engine's
  // pointer triggers don't reliably reach the scene while a virtual camera
  // has player input disabled, so cam-mode picking is page-driven
  | { type: 'pointer-tap'; add: boolean; toggle: boolean }
  // scroll wheel over the viewport while flying: multiplicative speed change
  | { type: 'fly-speed'; factor: number }
  | { type: 'resync' } // unconditional re-pull (after a scene restart the frozen CRDT is fresh)
  // mirror a page-side mutation into the scene's snapshot — /crdt_snapshot is
  // stale while the scene is frozen, so a refetch can't carry these
  | { type: 'component-written'; entity: string; name: string; json: string }
  | { type: 'entity-deleted'; entity: string; recursive: boolean }
  | { type: 'rpc'; id: number; method: string; args?: unknown[] }

export type SceneToPageMessage =
  | {
      type: 'scene-ready'
      bridge?: number
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
  // gizmo drag finished — carries the final transforms (frozen scenes can't be re-pulled)
  | { type: 'drag-end'; transforms: Record<string, unknown> }
  | { type: 'tool'; tool: EditorTool }
  | { type: 'rpc-reply'; id: number; ok: boolean; result?: unknown; error?: string }

// Bumped manually when the scene-side bridge changes — the page logs both
// builds so a stale cached bundle is diagnosable instead of mysterious.
export const SCENE_BRIDGE_VERSION = 3
