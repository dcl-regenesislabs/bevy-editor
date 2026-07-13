// Desktop shell for the bevy in-world editor.
//
// The renderer is editor-scene/web-ui's `editor-app` bundle (React +
// TypeScript), served from the bevy web build at /editor-app.html. It renders
// the SAME panel components as the in-world editor and embeds the engine in a
// same-origin iframe, talking to it through iframe.contentWindow over the
// console-command RPC + editor bus (editor-scene/src/bridge-protocol.ts is the
// interface contract). This process only manages the local stack: project
// picking, scene dev servers, static web serving, menus.
import { app, BrowserWindow, dialog, Menu, ipcMain, session, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as config from './config'
import { serveBevyWeb, startSceneServer, stopAll, stopSceneServer } from './servers'
import { aiReset, aiSend, aiStop, detectProviders } from './ai'
import { DEEPLINK_PROTOCOLS, isDeeplink, parseSignin } from './deeplink'
// shared cross-process contracts — single source of truth (also used by ui)
import { AUTH_SIGNIN_CHANNEL } from '@dcl-editor/contract'
import type { AiEvent, AiSendParams, ProjectInfo, SceneTemplate, ServersReady } from '@dcl-editor/contract'

let cfg: config.AppConfig
let win!: BrowserWindow
let storageRecovered = false
let quitting = false // set on teardown so late child output stops spewing to the terminal
const logs: string[] = []

// The scene folder the user is currently editing — the AI CLI's working dir.
// openProject is the only place it's known; it wasn't stored anywhere before.
let currentProjectDir: string | null = null

// Last 'servers-ready' payload + the project it belongs to. Cmd+R reloads only
// the web page, not the dev servers (still running), so on a reload we re-send
// this instead of leaving the host stuck on "Starting…" waiting for an event
// that openProject only fires on first load.
let lastReady: { dir: string; payload: ServersReady } | null = null

// Quiet Chromium's own stderr logging (WebRTC data-channel teardown aborts on
// quit, GPU chatter, …) — internal engine noise, not actionable to a Creator
// Hub user. `log-level=3` keeps only FATAL. Developers can opt back in with
// ELECTRON_ENABLE_LOGGING=1 (or `npm run dev`, which sets DEV).
if (process.env.ELECTRON_ENABLE_LOGGING === undefined && process.env.DEV === undefined) {
  app.commandLine.appendSwitch('log-level', '3')
}

// Unpackaged `electron .`: on macOS the OS can't route dcl-creator-hub:// to a
// process with no bundle Info.plist (it launches a bare Electron instead), so
// the renderer exposes a dev-only "paste the callback link" fallback. Preload
// reads this synchronously at load (sendSync) — guaranteed in a sandboxed
// preload, unlike process.argv/additionalArguments.
const IS_DEV = process.defaultApp || process.env.DEV !== undefined
ipcMain.on('editor-is-dev', (e) => {
  e.returnValue = IS_DEV
})

// ---- dcl-creator-hub:// deep-link (decentraland.org/auth sign-in bounce-back) ----
// Single instance: on Windows/Linux the OS launches a SECOND process with the
// deep-link in argv; the lock forwards it to us via 'second-instance' instead.
const gotInstanceLock = app.requestSingleInstanceLock()
if (!gotInstanceLock) {
  app.quit()
  process.exit(0)
}
// Register the schemes. In dev (`electron .`, process.defaultApp) the executable
// is the bare electron binary, so the entry script must be baked into the
// registration or the OS would relaunch electron without the app.
for (const protocol of DEEPLINK_PROTOCOLS) {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient(protocol)
  }
}

// macOS 'open-url' can fire before whenReady builds the window — buffer and
// flush at the end of startup. Note a cold-start sign-in callback is dropped by
// design even after the flush: the renderer only accepts callbacks bound to a
// sign-in it started this session (anti session-fixation), and a relaunched app
// has none pending — the user just clicks Sign in again.
let pendingDeeplink: string | null = null
function routeDeeplink(url: string): void {
  const payload = parseSignin(url)
  if (payload === null) return
  if (!app.isReady() || win === undefined || win.isDestroyed()) {
    pendingDeeplink = url
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send(AUTH_SIGNIN_CHANNEL, payload)
  log('◆ sign-in deep-link received')
}
app.on('open-url', (e, url) => {
  e.preventDefault()
  routeDeeplink(url)
})
app.on('second-instance', (_e, argv) => {
  if (win !== undefined && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  for (const a of argv) if (isDeeplink(a)) routeDeeplink(a)
})

// When launched by a harness (or piped), the parent can close our stdout while
// we keep logging; the write then throws EPIPE asynchronously and crashes the
// process. Swallow stream errors and guard every console write.
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})

function log(line: string): void {
  logs.push(line)
  if (logs.length > 500) logs.shift()
  if (quitting) return // during teardown, don't forward child shutdown chatter to the terminal
  try {
    console.log('[stack]', line)
  } catch {
    /* stdout closed (piped parent went away) */
  }
  if (win !== undefined && !win.isDestroyed()) win.webContents.send('stack-log', line)
}

// Push one AI-assistant stream event to the renderer's chat panel. Same shape as
// the 'stack-log' push; guarded so a late event during teardown can't throw.
function emitAiEvent(e: AiEvent): void {
  if (win !== undefined && !win.isDestroyed()) win.webContents.send('ai-event', e)
}

function hostUrl(params?: Record<string, string>): string {
  const q = new URLSearchParams(params)
  return `http://localhost:${cfg.webPort}/editor-app.html${params !== undefined ? `?${q}` : ''}`
}

const IMG_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

// Read a scene project's metadata + thumbnail (as a data URL) for the home grid.
// Enriched with Home state: favourite/lastOpened from config, and `missing` when
// the folder or its scene.json is gone (so the card greys instead of throwing).
function projectInfo(dir: string): ProjectInfo {
  const name = path.basename(dir.replace(/\/+$/, ''))
  const info: ProjectInfo = {
    path: dir,
    name,
    title: name,
    world: null,
    parcels: 0,
    thumbnail: null,
    favourite: cfg?.favourites?.includes(dir) ?? false,
    lastOpened: cfg?.lastOpened?.[dir]
  }
  if (!fs.existsSync(path.join(dir, 'scene.json'))) {
    info.missing = true
    return info
  }
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8')) as {
      display?: { title?: string; navmapThumbnail?: string }
      scene?: { parcels?: string[] }
      worldConfiguration?: { name?: string }
    }
    if (meta.display?.title) info.title = meta.display.title
    if (meta.worldConfiguration?.name) info.world = meta.worldConfiguration.name
    if (Array.isArray(meta.scene?.parcels)) info.parcels = meta.scene.parcels.length
    const thumbRel = meta.display?.navmapThumbnail
    if (thumbRel !== undefined) {
      const thumbPath = path.join(dir, thumbRel)
      if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size < 4_000_000) {
        const ext = path.extname(thumbPath).toLowerCase()
        const mime = IMG_MIME[ext] ?? 'image/png'
        info.thumbnail = `data:${mime};base64,${fs.readFileSync(thumbPath).toString('base64')}`
      }
    }
  } catch {
    /* keep folder-name fallback */
  }
  return info
}

async function openProject(projectDir: string): Promise<void> {
  if (!fs.existsSync(path.join(projectDir, 'scene.json'))) {
    dialog.showErrorBox('Not a scene', `${projectDir} has no scene.json`)
    return
  }
  cfg.recentProjects = [projectDir, ...cfg.recentProjects.filter((p) => p !== projectDir)]
  cfg.lastOpened[projectDir] = Date.now()
  config.save(cfg)
  currentProjectDir = projectDir // the AI assistant runs with this as its cwd
  aiReset() // fresh scene → fresh conversation (drops the prior project's session)

  // committing to a (re)launch of this project — invalidate any stale ready
  // payload so a reload during startup doesn't replay the previous scene's
  lastReady = null

  // Navigate to the loading screen FIRST (no realm yet) so the user sees build
  // status + logs immediately instead of a frozen home. The page mounts the
  // bevy iframe only once we report the servers ready below.
  await win.loadURL(hostUrl({ project: projectDir }))

  let position = '0,0'
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(projectDir, 'scene.json'), 'utf8')) as {
      scene?: { base?: string }
    }
    position = meta.scene?.base ?? '0,0'
  } catch {
    /* default spawn */
  }

  try {
    // editor system scene rarely changes — start it once and reuse our process
    await startSceneServer(cfg.editorSceneDir, cfg.editorScenePort, [], log, false)
    // the scene you're entering: always start its own fresh process (stopping
    // ours from a previous scene) so its build/server logs stream to the drawer
    await startSceneServer(projectDir, cfg.scenePort, ['--data-layer'], log)
    const payload: ServersReady = {
      realm: `http://localhost:${cfg.scenePort}`,
      systemScene: `http://localhost:${cfg.editorScenePort}`,
      position
    }
    lastReady = { dir: projectDir, payload }
    if (!win.isDestroyed()) win.webContents.send('servers-ready', payload)
  } catch (e) {
    log(`✖ ${String(e)}`)
    if (!win.isDestroyed()) win.webContents.send('servers-error', String(e))
  }
}

async function pickProject(): Promise<void> {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open Decentraland scene folder',
    properties: ['openDirectory']
  })
  if (!res.canceled && res.filePaths[0] !== undefined) await openProject(res.filePaths[0])
}

// ---- Home / scene management ----

// Bundled scene starters live in packages/desktop/templates/<id>/ (shipped with
// the app). __dirname is dist/ at runtime, so templates sit one level up.
function templatesDir(): string {
  const candidates = [path.resolve(__dirname, '..', 'templates'), path.resolve(__dirname, 'templates')]
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0]
}
const SCENE_TEMPLATES: SceneTemplate[] = [
  { id: 'blank', name: 'Blank', description: 'An empty parcel — start from scratch' },
  { id: 'starter', name: 'Starter', description: 'A clickable cube with a bit of SDK7 code' }
]
function sceneTemplates(): SceneTemplate[] {
  return SCENE_TEMPLATES.filter((t) => fs.existsSync(path.join(templatesDir(), t.id)))
}

const slugify = (s: string): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'my-scene'

// First non-existing "<base>[ suffix]" folder path, so copies never clobber.
function freeFolder(base: string, suffix: (n: number) => string): string {
  let dest = base
  let n = 2
  while (fs.existsSync(dest)) dest = suffix(n++)
  return dest
}

function toggleFavourite(dir: string): void {
  cfg.favourites = cfg.favourites.includes(dir)
    ? cfg.favourites.filter((p) => p !== dir)
    : [dir, ...cfg.favourites]
  config.save(cfg)
}

function removeFromRecents(dir: string): void {
  cfg.recentProjects = cfg.recentProjects.filter((p) => p !== dir)
  config.save(cfg)
  buildMenu()
}

// Move a scene folder to the OS Trash (recoverable), confirmed first — a
// creator's folder is often their only copy, so never fs.rm.
async function deleteProject(dir: string): Promise<boolean> {
  const res = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Move to Trash', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Delete "${path.basename(dir)}"?`,
    detail: `The scene folder will be moved to your Trash — you can restore it from there.\n\n${dir}`
  })
  if (res.response !== 0) return false
  try {
    await shell.trashItem(dir)
  } catch (e) {
    dialog.showErrorBox('Could not delete', String(e))
    return false
  }
  cfg.recentProjects = cfg.recentProjects.filter((p) => p !== dir)
  cfg.favourites = cfg.favourites.filter((p) => p !== dir)
  delete cfg.lastOpened[dir]
  config.save(cfg)
  buildMenu()
  return true
}

// Rename edits scene.json's display.title — NOT the folder — so recents paths stay valid.
function renameProject(dir: string, title: string): void {
  const sj = path.join(dir, 'scene.json')
  const meta = JSON.parse(fs.readFileSync(sj, 'utf8')) as { display?: Record<string, unknown> }
  meta.display = { ...(meta.display ?? {}), title: title.trim() }
  fs.writeFileSync(sj, JSON.stringify(meta, null, 2))
}

function duplicateProject(dir: string): string | null {
  if (!fs.existsSync(dir)) return null
  const base = dir.replace(/\/+$/, '')
  const dest = freeFolder(`${base} copy`, (n) => `${base} copy ${n}`)
  fs.cpSync(dir, dest, {
    recursive: true,
    filter: (src) => !['node_modules', 'bin', '.git'].includes(path.basename(src))
  })
  cfg.recentProjects = [dest, ...cfg.recentProjects.filter((p) => p !== dest)]
  config.save(cfg)
  buildMenu()
  return dest
}

// Scaffold a new scene by copying a bundled template folder (offline, deterministic
// — no global sdk-commands init). Deps install on first open (ensureProjectDeps).
function createScene(parentDir: string, name: string, template: string): string | null {
  const tdir = path.join(templatesDir(), template)
  if (!fs.existsSync(tdir)) throw new Error(`template not found: ${template}`)
  const slug = slugify(name)
  const dest = freeFolder(path.join(parentDir, slug), (n) => path.join(parentDir, `${slug}-${n}`))
  fs.cpSync(tdir, dest, { recursive: true })
  try {
    const sj = path.join(dest, 'scene.json')
    const meta = JSON.parse(fs.readFileSync(sj, 'utf8')) as { display?: Record<string, unknown> }
    meta.display = { ...(meta.display ?? {}), title: name.trim() }
    fs.writeFileSync(sj, JSON.stringify(meta, null, 2))
  } catch {
    /* template had no/invalid scene.json — leave as copied */
  }
  cfg.recentProjects = [dest, ...cfg.recentProjects.filter((p) => p !== dest)]
  cfg.lastOpened[dest] = Date.now()
  config.save(cfg)
  buildMenu()
  return dest
}

async function pickFolder(): Promise<string | null> {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a folder for the new scene',
    properties: ['openDirectory', 'createDirectory']
  })
  return res.canceled ? null : (res.filePaths[0] ?? null)
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Scene',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: () => void win.loadURL(hostUrl()) },
        { label: 'Open Scene Folder…', accelerator: 'CmdOrCtrl+O', click: () => void pickProject() },
        { type: 'separator' },
        ...cfg.recentProjects.map((p) => ({ label: p, click: () => void openProject(p) })),
        { type: 'separator' },
        { role: 'quit' as const }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

void app.whenReady().then(async () => {
  cfg = config.load()

  ipcMain.handle('pick-project', () => pickProject())
  ipcMain.handle('open-project', (_e, dir: string) => openProject(dir))
  // Leaving a scene back to the picker: stop the project's dev server (and its
  // auth-server child) so it doesn't keep running in the background. The editor
  // system scene stays up — it's shared across projects and reused on re-open.
  ipcMain.handle('close-project', () => {
    stopSceneServer(cfg.scenePort)
    lastReady = null
    currentProjectDir = null
    aiReset() // no project → no assistant working dir; drop the conversation
    log('■ scene closed — stopped project dev server')
  })
  // AI assistant: the renderer sends prompts and subscribes to 'ai-event'; all
  // CLI spawning happens in ./ai (main-process only, per the sandbox). aiSend
  // resolves as soon as the turn's child is running; events stream in async.
  ipcMain.handle('ai-providers', () => detectProviders())
  ipcMain.handle('ai-send', (_e, params: AiSendParams) => aiSend(params, currentProjectDir, emitAiEvent))
  ipcMain.handle('ai-stop', () => aiStop())
  ipcMain.handle('ai-reset', () => aiReset())
  // Engine boot recovery: a corrupt IndexedDB/Service Worker store makes the
  // engine's indexedDB.open fail, so it never registers its console command and
  // the editor hangs at "logging-in" forever. The renderer's boot watchdog calls
  // this when the engine stalls; we wipe those stores (the engine recreates them)
  // and report success so the renderer can reload the iframe with a clean slate.
  // Guarded to run once per launch to avoid any reload loop.
  ipcMain.handle('recover-engine-storage', async () => {
    if (storageRecovered) return false
    storageRecovered = true
    log('⟳ engine stalled — clearing corrupt browser storage (IndexedDB / Service Worker) and reloading')
    try {
      await session.defaultSession.clearStorageData({ storages: ['indexdb', 'serviceworkers'] })
      return true
    } catch (e) {
      log(`✖ storage recovery failed: ${String(e)}`)
      return false
    }
  })
  // Pull counterpart to the 'servers-ready' push: a reload (Cmd+R) re-mounts the
  // host page but openProject (the only pusher) doesn't re-run. The dev servers
  // are still up, so the page asks for the cached payload on mount and resumes
  // without waiting for an event that won't come. Returns null on first load
  // (servers not started yet) — the page then waits for the push as before.
  ipcMain.handle('request-ready', () => {
    if (lastReady === null) return null
    const project = lastReady
    const url = win.isDestroyed() ? '' : win.webContents.getURL()
    try {
      return new URL(url).searchParams.get('project') === project.dir ? project.payload : null
    } catch {
      return null
    }
  })
  ipcMain.handle('get-state', () => ({
    ...cfg,
    logs,
    projects: cfg.recentProjects.map(projectInfo)
  }))
  // Decentraland account: open the auth dapp in the default browser. https-only —
  // a renderer must never be able to launch arbitrary local schemes through us.
  ipcMain.handle('open-external', (_e, url: string) => {
    if (!/^https:\/\//.test(url)) throw new Error('only https URLs can be opened')
    return shell.openExternal(url)
  })
  // Dev fallback for the callback the OS can't deliver to an unpackaged app: the
  // renderer pastes the dcl-creator-hub:// URL and we route it exactly like a
  // real deep-link (the renderer's nonce check still gates who it signs in).
  ipcMain.handle('submit-signin-link', (_e, url: string) => {
    if (typeof url !== 'string' || parseSignin(url) === null) return false
    routeDeeplink(url)
    return true
  })
  // Home / scene management
  ipcMain.handle('toggle-favourite', (_e, dir: string) => toggleFavourite(dir))
  ipcMain.handle('remove-from-recents', (_e, dir: string) => removeFromRecents(dir))
  ipcMain.handle('delete-project', (_e, dir: string) => deleteProject(dir))
  ipcMain.handle('reveal-in-finder', (_e, dir: string) => shell.showItemInFolder(dir))
  ipcMain.handle('rename-project', (_e, dir: string, title: string) => renameProject(dir, title))
  ipcMain.handle('duplicate-project', (_e, dir: string) => duplicateProject(dir))
  ipcMain.handle('set-view-mode', (_e, mode: 'grid' | 'list') => {
    cfg.viewMode = mode
    config.save(cfg)
  })
  ipcMain.handle('pick-folder', () => pickFolder())
  ipcMain.handle('scene-templates', () => sceneTemplates())
  ipcMain.handle('create-scene', (_e, parentDir: string, name: string, template: string) =>
    createScene(parentDir, name, template)
  )

  win = new BrowserWindow({
    width: 1500,
    height: 950,
    title: 'Bevy Scene Editor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Defense-in-depth: these are Electron 33's defaults, but pin them so a
      // future Electron bump or a stray webPreferences edit can't silently
      // weaken the renderer. The preload uses contextBridge, so isolation is
      // safe; nothing in the renderer needs Node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (process.env.BEVY_EDITOR_DEBUG !== undefined) {
    // automation runs while the user may be on another macOS Space: keep the
    // window composited so Chromium doesn't suspend rAF (the engine's clock)
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setAlwaysOnTop(true)
  }

  buildMenu()

  const web = await serveBevyWeb(cfg.bevyWebDir, cfg.uiDir, cfg.webPort)
  log(
    web === null
      ? `port ${cfg.webPort}: reusing running web server`
      : `serving engine from ${cfg.bevyWebDir} + UI from ${cfg.uiDir} on :${cfg.webPort}`
  )

  // In `npm run dev`, the dev script already runs the web server (Vite HMR + engine
  // static) on this port, so serveBevyWeb above no-ops (port busy → reuse) and HMR
  // is handled there — nothing extra to do in the main process.

  await win.loadURL(hostUrl())

  // automation / deep-link entry: open a project straight away
  if (process.env.BEVY_EDITOR_PROJECT !== undefined) await openProject(process.env.BEVY_EDITOR_PROJECT)

  // Cold-start deep-links: Windows/Linux deliver them in argv (skip the runtime
  // args: 2 in dev where argv[1] is the app path, 1 packaged); macOS may have
  // buffered one in the early 'open-url'. Route them now that `win` exists.
  for (const a of process.argv.slice(process.defaultApp ? 2 : 1)) {
    if (isDeeplink(a)) routeDeeplink(a)
  }
  if (pendingDeeplink !== null) {
    const url = pendingDeeplink
    pendingDeeplink = null
    routeDeeplink(url)
  }
})

function teardown(): void {
  quitting = true
  aiStop() // reap any running AI CLI turn
  stopAll()
}

app.on('window-all-closed', () => {
  teardown()
  app.quit()
})
app.on('before-quit', teardown)

// Ctrl+C / kill from the launching terminal (npm start, npm run dev): Electron
// may terminate on the signal without running before-quit, which would orphan
// the scene servers and let their graceful-shutdown logs spew into the terminal
// after the prompt returns. Run the same forceful teardown, then exit now.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    teardown()
    app.exit(0)
  })
}
