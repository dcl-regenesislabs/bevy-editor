// Desktop shell for the bevy in-world editor.
//
// The renderer is editor-scene/web-ui's `editor-app` bundle (React +
// TypeScript), served from the bevy web build at /editor-app.html. It renders
// the SAME panel components as the in-world editor and embeds the engine in a
// same-origin iframe, talking to it through iframe.contentWindow over the
// console-command RPC + editor bus (editor-scene/src/bridge-protocol.ts is the
// interface contract). This process only manages the local stack: project
// picking, scene dev servers, static web serving, menus.
import { app, BrowserWindow, dialog, Menu, ipcMain, session } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as config from './config'
import { serveBevyWeb, startSceneServer, stopAll, stopSceneServer } from './servers'
import { aiReset, aiSend, aiStop, detectProviders } from './ai'
// shared cross-process contracts — single source of truth (also used by ui)
import type { AiEvent, AiSendParams, ProjectInfo, ServersReady } from '@dcl-editor/contract'

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
function projectInfo(dir: string): ProjectInfo {
  const name = path.basename(dir.replace(/\/+$/, ''))
  const info: ProjectInfo = { path: dir, name, title: name, world: null, parcels: 0, thumbnail: null }
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
  cfg.recentProjects = [projectDir, ...cfg.recentProjects.filter((p) => p !== projectDir)].slice(0, 8)
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
