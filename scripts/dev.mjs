// Dev mode with HMR: edit a panel/style → it hot-swaps in place, no page reload,
// no engine reboot, editor state preserved.
//
// How it fits together (one origin, no proxy):
//   - This script runs ONE node http server on the web port that combines:
//       • Vite (middleware mode) for the host UI — React Fast Refresh + HMR
//       • static serving of the external engine build for everything else
//     so the host page and the engine iframe are same-origin (required for the
//     host↔iframe console-RPC) with COOP/COEP (required for wasm threads).
//   - It then launches the desktop app with DEV=1. The app's own web server sees
//     the port already taken and reuses ours — so Electron/main stays untouched
//     and Vite never gets bundled into the production app.
//   - The editor SCENE is rebuilt by its own `sdk-commands start` watcher (spawned
//     by the app); HMR here covers the React UI.
//
// HMR is instant for component/style edits. Editing a logic/singleton module
// (state.ts, console.ts, boot.ts, actions.ts) re-runs module init, so Vite
// full-reloads those (engine reboots — same as a manual Cmd+R). Ctrl+C stops all.
//
// Usage: `npm run dev` (from the monorepo root).
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const uiRoot = path.join(root, 'packages', 'ui')
const engineDir = process.env.BEVY_WEB_DIR ?? path.resolve(root, '..', 'bevy-explorer', 'deploy', 'web')
const webPort = Number(process.env.BEVY_WEB_PORT ?? 3010)

const COOP = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin'
}
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
}

// desktop main must be built (Electron loads dist/main.cjs); the scene is served
// by its own watcher, the UI is served live by Vite below — neither needs prebuilding
console.log('▶ dev: building desktop main…')
if (spawnSync('npm', ['run', 'build:main', '-w', '@dcl-editor/desktop'], { cwd: root, stdio: 'inherit' }).status !== 0) {
  process.exit(1)
}

// the http server is created first so Vite can attach its HMR websocket to it
const server = http.createServer()

const vite = await createViteServer({
  configFile: path.join(uiRoot, 'vite.config.ts'),
  root: uiRoot,
  appType: 'custom',
  server: { middlewareMode: true, hmr: { server } }
})

server.on('request', (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${webPort}`)
  // the host page: let Vite transform it (injects the HMR client + react-refresh)
  if (url.pathname === '/editor-app.html') {
    const raw = fs.readFileSync(path.join(uiRoot, 'editor-app.html'), 'utf8')
    vite
      .transformIndexHtml(url.pathname, raw)
      .then((html) => res.writeHead(200, { 'Content-Type': 'text/html', ...COOP }).end(html))
      .catch((e) => {
        vite.ssrFixStacktrace(e)
        res.writeHead(500).end(String(e))
      })
    return
  }
  // Vite owns its module graph (/src/*, /@vite, /@react-refresh, deps); anything
  // it doesn't claim (the engine: /, /pkg, /favicon, /scripts) falls through to static
  vite.middlewares(req, res, () => {
    let file = path.join(engineDir, decodeURIComponent(url.pathname))
    if (url.pathname === '/' || url.pathname === '') file = path.join(engineDir, 'index.html')
    if (!file.startsWith(path.resolve(engineDir))) {
      res.writeHead(403).end()
      return
    }
    fs.stat(file, (err, st) => {
      if (err !== null || !st.isFile()) {
        res.writeHead(404).end('not found')
        return
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Content-Length': st.size,
        ...COOP,
        'Cache-Control': 'no-cache'
      })
      fs.createReadStream(file).pipe(res)
    })
  })
})

await new Promise((resolve) => server.listen(webPort, resolve))
console.log(`▶ dev: HMR + engine server on http://localhost:${webPort} (engine: ${engineDir})`)

// Scene code runs in the engine's sandbox, not the page — it CAN'T hot-swap like
// the React UI. Its `sdk-commands` watcher rebuilds bin/index.js; when it does, we
// notify the page (custom HMR event), which reloads ONLY the editor scene in the
// engine via `/reload <hash>` — no engine reboot, no page reload (see dev-hmr.ts).
// It falls back to a full page reload if that doesn't take.
const sceneBin = path.join(root, 'packages', 'scene', 'bin')
fs.mkdirSync(sceneBin, { recursive: true }) // may not exist until first build; watch the dir
let reloadTimer = null
fs.watch(sceneBin, (_e, file) => {
  if (file !== null && !file.startsWith('index.js')) return
  if (reloadTimer !== null) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    console.log('↻ dev: editor scene rebuilt — reloading editor scene in place')
    vite.ws.send({ type: 'custom', event: 'editor:reload-scene' })
  }, 400)
})
console.log(`▶ dev: watching ${sceneBin} → in-place editor-scene reload on rebuild`)

// launch the app; it reuses our server (port busy) and points its window here
console.log('▶ dev: launching desktop app (DEV=1, HMR on)\n')
const app = spawn('npm', ['run', 'app', '-w', '@dcl-editor/desktop'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DEV: '1' }
})

const stop = () => {
  try {
    app.kill('SIGTERM')
  } catch {
    /* gone */
  }
  void vite.close()
  server.close()
}
process.on('SIGINT', () => {
  stop()
  process.exit(0)
})
app.on('exit', () => {
  stop()
  process.exit(0)
})
