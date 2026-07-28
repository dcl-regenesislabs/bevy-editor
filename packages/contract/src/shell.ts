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
  position: string // base parcel, "x,y"
  spawn: string // authored spawn point in DCL world space, "x,y,z" ('' if unknown)
  spawnPoints: string // scene.json's spawnPoints, verbatim JSON (drawn in the viewport)
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

// ---- Decentraland account (deep-link sign-in) ----
// The renderer starts a sign-in by opening decentraland.org/auth in the user's
// browser (openExternal). The auth dapp bounces back into the app via the
// dcl-creator-hub:// protocol; the main process parses the deep-link and pushes
// the payload over this channel. The renderer then fetches + stores the actual
// AuthIdentity itself (localStorage / SSO client) — main never holds credentials.
export const AUTH_SIGNIN_CHANNEL = 'auth-deep-link-signin'

// Editor tool chords (⌥Q/⌥W/⌥E/⌥R, ⌥F), claimed in the main process because the
// engine iframe holds focus whenever the viewport is clicked — see main.ts.
export const EDITOR_CHORD_CHANNEL = 'editor-chord'
export type EditorChord =
  | { action: 'tool'; tool: string }
  | { action: 'focus' }
  | { action: 'undo' }
  | { action: 'redo' }
  | { action: 'duplicate' }

// Payload of AUTH_SIGNIN_CHANNEL. `authRequestId` is echoed by the auth dapp
// when available; the renderer uses it to bind the callback to the request it
// started (an unsolicited deep-link with a foreign id must not sign anyone in).
export interface AuthSigninPayload {
  identityId: string
  authRequestId: string | null
}

// ---- AI assistant ----
// The in-app assistant drives a local AI *CLI* (Claude Code / Codex) as a child
// process of the Electron main. It runs on the user's own subscription/OAuth
// session (no API key), with the project folder as its working dir, and edits
// the scene's src/scripts/*.ts files directly on disk; sdk-commands rebuilds on
// write, and the running scene picks the new code up on the next restart (Stop).
// The renderer never spawns anything; it only sends prompts and renders
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

// ---- Publish to Worlds ----
// Publishing drives `sdk-commands deploy --no-browser --port N` (the scene's own
// toolchain) exactly like the Creator Hub does: main spawns it (build + entity
// hashing + a local "linker" HTTP server), then the RENDERER acts as the linker
// dapp — it signs the entity id with the stored AuthIdentity and POSTs the auth
// chain to http://localhost:N/api/deploy, which uploads to the worlds content
// server. The private key never reaches main or disk.
export const PUBLISH_EVENT_CHANNEL = 'publish-event'

// Streamed over PUBLISH_EVENT_CHANNEL while a publish job runs. `jobId`
// correlates events to the publishStart() that produced them — a late event
// from a cancelled/replaced job must not be attributed to the current one.
// `ready` fires once the linker server answers on `port` — the renderer takes
// over from there. `log` relays the CLI's output for the details drawer;
// `exit` reports process death (an error only if the job hadn't finished).
export type PublishEvent =
  | { kind: 'log'; jobId: string; line: string }
  | { kind: 'ready'; jobId: string; port: number }
  | { kind: 'exit'; jobId: string; code: number | null }

// ---- Scene settings (scene.json) ----
// The editable subset of a project's scene.json. Reading collapses spawn-point
// axis ranges ([min,max]) to their midpoint; saving writes plain numbers and
// preserves every scene.json field the editor doesn't model.
export interface SpawnPointSetting {
  name: string
  default: boolean
  position: { x: number; y: number; z: number }
  cameraTarget?: { x: number; y: number; z: number }
}

export interface SceneSettings {
  title: string
  description: string
  thumbnailPath: string | null // project-relative display.navmapThumbnail
  thumbnail: string | null // that image as a data URL, for preview (read-only)
  contactName: string
  contactEmail: string
  parcels: string[] // "x,y"
  base: string // must be one of `parcels`
  spawnPoints: SpawnPointSetting[]
}

// ---- Mobile preview ----
// The scene dev server binds 0.0.0.0, so a phone on the same network can join
// the running preview live (same hot reload as the editor — it's the same
// server). Main derives the LAN address and a decentraland:// deep link (the
// shape sdk-commands' --mobile QR emits, opened by the Decentraland mobile
// client) and renders it as a QR PNG data URL for the modal to show.
// `no-scene` = servers-ready hasn't fired yet (a QR would point at a dead port).
export type MobilePreview =
  | { ok: true; deepLink: string; qr: string }
  | { ok: false; reason: 'no-network' | 'no-scene' }

// Result of launching an external preview client (web explorer tab or the
// Decentraland desktop app). `no-client` = no app registered for the
// decentraland:// protocol — the UI points at the download page.
export type OpenPreview =
  | { ok: true }
  | { ok: false; reason: 'no-scene' | 'no-client' }

// ---- App auto-update ----
// Main checks GitHub Releases in the background and downloads + stages the new
// version silently (electron-updater on Windows; a zip download verified
// against latest-mac.yml's sha512 and pre-extracted on macOS — no code signing
// required). The renderer's only common-path UI is a passive "Restart to
// update" affordance once `downloaded`; an ignored update installs on the next
// natural quit. Status is pushed over this channel and pullable on (re)mount.
export const UPDATE_EVENT_CHANNEL = 'update-event'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
  // dev: unpackaged (`electron .`); translocated: macOS is running the app from
  // the read-only DMG image — it must be dragged to Applications first
  | { state: 'unsupported'; reason: 'dev' | 'translocated' }

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
  // tool chords claimed in main (see EDITOR_CHORD_CHANNEL)
  onEditorChord?: (cb: (c: EditorChord) => void) => void
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
  // ---- Decentraland account ----
  // open a URL in the user's default browser (main-process shell.openExternal)
  openExternal?: (url: string) => Promise<void>
  // subscribe to the deep-link sign-in callback (identityId + the optional
  // echoed authRequestId). Returns an unsubscribe function.
  onSignIn?: (cb: (payload: AuthSigninPayload) => void) => () => void
  // true when running unpackaged (`electron .`) — the OS can't route the
  // dcl-creator-hub:// callback to a bundle-less process, so the UI shows a
  // paste-the-link fallback (see submitSignInLink).
  isDev?: boolean
  // dev fallback: hand a pasted dcl-creator-hub:// callback URL to main, which
  // routes it through the same channel as a real deep-link. Resolves false if
  // the string isn't a valid sign-in callback.
  submitSignInLink?: (url: string) => Promise<boolean>
  // ---- Publish to Worlds ----
  // set scene.json worldConfiguration.name (the publish target world)
  setWorldName?: (dir: string, name: string) => Promise<void>
  // start a publish job for the scene at `dir` targeting the given content
  // server (https URL, e.g. the worlds content server); resolves with the id
  // its events carry — progress streams over onPublishEvent. Rejects if a job
  // is already running.
  publishStart?: (dir: string, targetContent: string) => Promise<{ jobId: string }>
  // kill the running publish job (user cancel, or cleanup after renderer failure)
  publishStop?: () => Promise<void>
  // subscribe to publish progress events; returns an unsubscribe function
  onPublishEvent?: (cb: (e: PublishEvent) => void) => () => void
  // ---- Scene settings ----
  // read the editable subset of the scene's scene.json (+ thumbnail preview)
  sceneSettings?: (dir: string) => Promise<SceneSettings>
  // validate + merge-write the settings into scene.json (unknown fields kept).
  // Resolves an error message on invalid input, null on success.
  saveSceneSettings?: (dir: string, settings: SceneSettings) => Promise<string | null>
  // native image picker; copies the chosen file into the project and resolves
  // its project-relative path + preview data URL (null if cancelled)
  pickSceneThumbnail?: (dir: string) => Promise<{ path: string; dataUrl: string } | null>
  // ---- Mobile preview ----
  // LAN deep link + QR for the running scene server (see MobilePreview)
  mobilePreview?: () => Promise<MobilePreview>
  // open the scene in the hosted bevy web explorer, in the default browser
  webPreview?: () => Promise<OpenPreview>
  // open the scene in the Decentraland desktop client via its deep link
  unityPreview?: () => Promise<OpenPreview>
  // ---- App auto-update ----
  // installed app version ("0.2.0") for the Account section
  appVersion?: () => Promise<string>
  // pull the current status on (re)mount — covers Cmd+R, where pushes don't re-fire
  updateStatus?: () => Promise<UpdateStatus>
  // user-initiated check; resolves with the outcome so the UI can say
  // "you're up to date" / show the error explicitly
  updateCheck?: () => Promise<UpdateStatus>
  // install the staged update and relaunch. Refused (not rejected — IPC mangles
  // rejections into strings) while a publish or AI turn is running.
  updateRestart?: () => Promise<{ ok: boolean; reason?: 'busy' }>
  // subscribe to status pushes; returns an unsubscribe function
  onUpdateEvent?: (cb: (s: UpdateStatus) => void) => () => void
  // CORS relay for the world storage API ONLY (its allowlist rejects localhost
  // origins). The renderer still signs the request (x-identity-* headers built
  // there); main just forwards it. Rejects any host other than the storage API.
  storageFetch?: (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string }
  ) => Promise<{ status: number; body: string }>
  // AI assistant: enumerate backends, run a turn (resolves with its turnId),
  // interrupt the running turn, drop the conversation, subscribe to stream events
  aiProviders?: () => Promise<AiProviderInfo[]>
  aiSend?: (params: AiSendParams) => Promise<{ turnId: string }>
  aiStop?: () => Promise<void>
  aiReset?: () => Promise<void>
  onAiEvent?: (cb: (e: AiEvent) => void) => void
}
