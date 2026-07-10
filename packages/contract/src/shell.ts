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
}

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
}
