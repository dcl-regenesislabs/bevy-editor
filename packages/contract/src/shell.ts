// The Electron host ↔ renderer IPC contract. The desktop package's preload
// exposes `window.editorShell` implementing `EditorShell`; the ui package's
// embedded entry consumes it. This is the SINGLE source of truth for that
// surface — previously `EditorShell` and `ProjectInfo` were duplicated in the
// desktop main process and the renderer with no shared type.

// Per-project metadata shown on the home/picker screen.
export interface ProjectInfo {
  path: string
  name: string // folder name (fallback / sub-label)
  title: string // display.title from scene.json, else folder name
  world: string | null // worldConfiguration.name (a DCL Name) if a World
  parcels: number // parcel count
  thumbnail: string | null // data URL of the scene thumbnail, if any
  favourite?: boolean // pinned in the Home Favourites shelf
  lastOpened?: number // epoch ms of the last open (for "last opened" sort)
  missing?: boolean // the folder (or its scene.json) is gone — greyed, remove-only
}

// Payload of the `servers-ready` event: where the renderer should attach.
export interface ServersReady {
  realm: string
  systemScene: string
  position: string
}

// Full state returned by getState() — app config plus runtime info.
export interface HostState {
  recentProjects: string[]
  projects: ProjectInfo[]
  logs: string[]
  bevyWebDir: string
  editorSceneDir: string
  webPort: number
  scenePort: number
  editorScenePort: number
  favourites: string[]
  viewMode: 'grid' | 'list'
}

// A scene starter shipped with the app (copied on "New scene").
export interface SceneTemplate {
  id: string
  name: string
  description: string
}

// ---- AI assistant ----
// The in-app assistant drives a local AI *CLI* (Claude Code / Codex) as a child
// process of the Electron main. It runs on the user's own subscription/OAuth
// session (no API key), with the project folder as its working dir, and edits
// the scene's src/scripts/*.ts files directly on disk — sdk-commands hot-reloads
// them. The renderer never spawns anything; it only sends prompts and renders
// the streamed events below.
export type AiProvider = 'claude' | 'codex'

// One selectable backend, as reported to the chat UI. `available` is false when
// the CLI binary isn't installed (or, best-effort, isn't logged in) — the UI
// disables it and shows `reason`.
export interface AiProviderInfo {
  id: AiProvider
  label: string
  available: boolean
  models: string[]
  defaultModel: string
  reason?: string
}

// A single user turn to run. `text` is the prompt the user typed; `context` is
// editor state the assistant should see but the user shouldn't have to retype
// (the selected entity + its components) — it's prepended to the prompt, not
// shown in the chat bubble. The main process keeps the per-provider session id
// and resumes it, so turns chain into one conversation until aiReset().
export interface AiSendParams {
  provider: AiProvider
  model?: string
  text: string
  context?: string
}

// Streamed over the `ai-event` channel while a turn runs. `turnId` correlates
// events to the send() that started them. Text arrives incrementally (`text`);
// `tool` marks a file the assistant read/edited; `done` ends the turn.
export type AiEvent =
  | { kind: 'started'; turnId: string }
  | { kind: 'text'; turnId: string; text: string }
  | { kind: 'tool'; turnId: string; tool: string; detail: string }
  | { kind: 'error'; turnId: string; message: string }
  | { kind: 'done'; turnId: string; ok: boolean }

// The bridge exposed to the renderer as `window.editorShell`.
export interface EditorShell {
  pickProject: () => Promise<void>
  openProject: (dir: string) => Promise<void>
  // stop the current project's dev server when returning to the picker
  closeProject?: () => Promise<void>
  getState: () => Promise<HostState>
  // clear corrupt engine browser storage when boot stalls; resolves true if cleared
  recoverEngineStorage?: () => Promise<boolean>
  onStackLog: (cb: (line: string) => void) => void
  onServersReady?: (cb: (info: ServersReady) => void) => void
  // pull the cached ready payload on (re)mount — covers Cmd+R reload, where the
  // push doesn't re-fire; resolves null on first load (servers not up yet)
  requestReady?: () => Promise<ServersReady | null>
  onServersError?: (cb: (message: string) => void) => void
  // ---- Home / scene management ----
  // pin/unpin a scene in the Favourites shelf
  toggleFavourite?: (dir: string) => Promise<void>
  // drop a scene from the recents list (does NOT touch the folder)
  removeFromRecents?: (dir: string) => Promise<void>
  // move the scene folder to the OS Trash (confirmed in main); resolves true if deleted
  deleteProject?: (dir: string) => Promise<boolean>
  // open the scene folder in the OS file manager
  revealInFinder?: (dir: string) => Promise<void>
  // set the scene's display.title in scene.json (folder path is unchanged)
  renameProject?: (dir: string, title: string) => Promise<void>
  // copy the scene folder to "<name> copy"; resolves the new path (or null)
  duplicateProject?: (dir: string) => Promise<string | null>
  // persist the Home grid/list preference
  setViewMode?: (mode: 'grid' | 'list') => Promise<void>
  // pick a parent folder for a new scene (native dialog); null if cancelled
  pickFolder?: () => Promise<string | null>
  // list the bundled scene templates for the New-scene modal
  sceneTemplates?: () => Promise<SceneTemplate[]>
  // scaffold a new scene from a template into parentDir; resolves the new path (or null)
  createScene?: (parentDir: string, name: string, template: string) => Promise<string | null>
  // AI assistant: enumerate backends, run a turn (resolves with its turnId),
  // interrupt the running turn, drop the conversation, subscribe to stream events
  aiProviders?: () => Promise<AiProviderInfo[]>
  aiSend?: (params: AiSendParams) => Promise<{ turnId: string }>
  aiStop?: () => Promise<void>
  aiReset?: () => Promise<void>
  onAiEvent?: (cb: (e: AiEvent) => void) => void
}
