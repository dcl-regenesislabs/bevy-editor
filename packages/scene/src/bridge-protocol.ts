import { type LiveSceneInfo } from './bevy-api/interface'

// ⚠️ KEEP IN SYNC with `@dcl-editor/contract` (packages/contract/src/bus-protocol.ts),
// which is the source of truth for this protocol (used by the ui + desktop
// packages). This copy is intentionally self-contained — the scene is bundled by
// `sdk-commands`, and we don't want to couple its resolver to a workspace import.
// Any message-shape change here must be mirrored in contract, and vice versa.
//
// Messages exchanged between the host page UI (React) and this scene over the
// explorer's editor message bus (`/editor_send` + `/editor_poll` console
// commands). The page polls target "page"; the scene polls target "scene".

export type EditorTool = 'select' | 'translate' | 'rotate' | 'scale'

export type CameraMode = 'off' | 'free' | 'target'

export type PageToSceneMessage =
  | { type: 'init' } // page UI announces itself; scene hides its panels and replies scene-ready
  | { type: 'set-tool'; tool: EditorTool }
  | {
      type: 'set-flags'
      orientGlobal?: boolean
      pivotEach?: boolean
      nodeDisplay?: 'always' | 'selected' | 'selecting'
      showLinks?: boolean
    }
  | { type: 'set-selection'; selected: string[]; active: string | null }
  | { type: 'set-camera'; mode: CameraMode; axis?: string }
  // frame an entity in the viewport. orbit !== false → lock the orbit camera onto
  // it (explicit Focus). orbit === false → frame ONCE in free mode (import/place):
  // orbit would chase the entity on every later move and glitch the view.
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
  | { type: 'entity-deleted'; entity: string; recursive: boolean }
  | { type: 'rpc'; id: number; method: string; args?: unknown[] }

// Bumped manually when the scene-side bridge changes — the page logs both
// builds so a stale cached bundle is diagnosable instead of mysterious.
export const SCENE_BRIDGE_VERSION = 4

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
