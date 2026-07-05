// Local stack management: the static bevy web server (with the COOP/COEP
// headers wasm threads require) and the two scene dev servers. If a port is
// already serving the right thing (a dev terminal session), it is reused.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execSync, type ChildProcess } from 'node:child_process'

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
}

// The opendcl model catalog CDN lacks CORS/CORP headers, which the
// crossOriginIsolated editor pages refuse — proxy it same-origin instead. The
// target origin is pinned, so this can only ever reach the catalog CDN (not a
// general-purpose proxy); the bounds below just stop a slow/huge upstream
// response from hanging a socket or exhausting memory.
const OPENDCL_ORIGIN = 'https://models.dclregenesislabs.xyz'
const PROXY_TIMEOUT_MS = 20_000
const PROXY_MAX_BYTES = 256 * 1024 * 1024 // generous vs real GLBs (~tens of MB); a DoS backstop

function proxyOpendcl(url: URL, res: http.ServerResponse, method = 'GET'): void {
  if (url.pathname === '/opendcl/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }).end('ok')
    return
  }
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('method not allowed')
    return
  }
  const target = OPENDCL_ORIGIN + url.pathname.slice('/opendcl'.length) + url.search
  fetch(target, { method, signal: AbortSignal.timeout(PROXY_TIMEOUT_MS) })
    .then(async (r) => {
      const declared = Number(r.headers.get('content-length') ?? '0')
      if (declared > PROXY_MAX_BYTES) {
        res.writeHead(413, { 'Content-Type': 'text/plain' }).end('upstream payload too large')
        return
      }
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.byteLength > PROXY_MAX_BYTES) {
        res.writeHead(413, { 'Content-Type': 'text/plain' }).end('upstream payload too large')
        return
      }
      res.writeHead(r.status, {
        'Content-Type': r.headers.get('content-type') ?? 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'public, max-age=86400'
      })
      res.end(buf)
    })
    .catch((e) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' }).end(`proxy error: ${e}`)
    })
}

// Serve TWO roots under ONE origin so the host UI page and the engine iframe are
// same-origin (required for the host's console-RPC into iframe.contentWindow):
//   - our own editor UI bundles (editor-app.html/js, editor-ui.js) from `uiDir`
//   - everything else (engine index.html, wasm, pkg/) from the external `webDir`
// This keeps the UI build self-contained in the monorepo — nothing is written
// into the engine checkout.
export function serveBevyWeb(webDir: string, uiDir: string, port: number): Promise<http.Server | null> {
  // Our UI (Vite output): the host pages + their hashed module chunks. Everything
  // else (/engine/* incl. the wasm, /service_worker.js, /bridge-scene) comes from
  // the engine dir. The engine package ships its own /assets (the react-web HUD's
  // chunks) but the editor never loads that app, so /assets stays ours.
  const isUiAsset = (p: string): boolean =>
    p === '/editor-app.html' ||
    p === '/engine.html' ||
    p === '/design-system.html' ||
    p.startsWith('/assets/')
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
    if (url.pathname.startsWith('/opendcl/')) {
      proxyOpendcl(url, res, req.method ?? 'GET')
      return
    }
    const root = isUiAsset(url.pathname) ? uiDir : webDir
    let file = path.join(root, decodeURIComponent(url.pathname))
    if (url.pathname === '/' || url.pathname === '') file = path.join(webDir, 'index.html')
    if (!file.startsWith(path.resolve(root))) {
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
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'no-cache'
      })
      fs.createReadStream(file).pipe(res)
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) =>
      e.code === 'EADDRINUSE' ? resolve(null) : reject(e)
    )
    server.listen(port, () => resolve(server))
  })
}

async function probe(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctl.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

// Free a port by killing only its LISTENER — never clients with an established
// connection (the comms server, the engine), since killing those breaks login.
// Used to clear a stray squatter from a crashed run so we can bind; we don't
// otherwise depend on anything external. POSIX uses `lsof -sTCP:LISTEN`; Windows
// uses `netstat -ano` (LISTENING rows) + taskkill.
function killListener(port: number): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano -p tcp`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
      const pids = new Set<string>()
      for (const line of out.split('\n')) {
        // ...  TCP  0.0.0.0:<port>  ...  LISTENING  <pid>
        const m = line.match(/:(\d+)\s+\S+\s+LISTENING\s+(\d+)/)
        if (m !== null && m[1] === String(port)) pids.add(m[2])
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
        } catch {
          /* already gone */
        }
      }
      return
    }
    const pids = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM')
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* nothing listening */
  }
}

// `--no-client` (suppress the native Explorer) exists only in newer
// sdk-commands and is rejected as an unknown option by older ones, which differ
// between project installs. Detect support from the installed source (it isn't
// listed in --help) and pass it only where accepted. Cached per dir.
const noClientSupport = new Map<string, boolean>()
function supportsNoClient(projectDir: string): boolean {
  const cached = noClientSupport.get(projectDir)
  if (cached !== undefined) return cached
  // Cross-platform recursive scan (replaces `grep -rq`, which Windows lacks):
  // does the installed sdk-commands `start` command mention "no-client"?
  const scan = (dir: string): boolean => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (scan(full)) return true
      } else {
        try {
          if (fs.readFileSync(full, 'utf8').includes('no-client')) return true
        } catch {
          /* unreadable — skip */
        }
      }
    }
    return false
  }
  const startDir = path.join(projectDir, 'node_modules', '@dcl', 'sdk-commands', 'dist', 'commands', 'start')
  // Not installed yet (sdk-commands installs deps only AFTER it starts) — the
  // scan can't know, so don't poison the per-dir cache with a false negative;
  // the caller installs deps first so this path shouldn't normally be hit.
  if (!fs.existsSync(startDir)) return false
  const ok = scan(startDir)
  noClientSupport.set(projectDir, ok)
  return ok
}

// First open of a project: its deps may not be installed yet. `sdk-commands
// start` would install them itself, but only AFTER the --no-client decision has
// been made from the (missing) install — and the native Explorer client pops
// over the editor. Install up front so flag detection sees the real files.
async function ensureProjectDeps(projectDir: string, onLog: (line: string) => void): Promise<void> {
  if (fs.existsSync(path.join(projectDir, 'node_modules', '@dcl', 'sdk-commands'))) return
  onLog(`● installing project dependencies in ${projectDir}…`)
  await new Promise<void>((resolve) => {
    const child = spawn('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: projectDir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout?.on('data', (d: Buffer) => onLog(String(d).trimEnd()))
    child.stderr?.on('data', (d: Buffer) => onLog(String(d).trimEnd()))
    child.on('error', (e) => {
      onLog(`✖ npm install failed to spawn — ${e.message}`)
      resolve() // sdk-commands start will retry the install itself
    })
    child.on('exit', (code) => {
      if (code !== 0) onLog(`✖ npm install exited with ${code} (sdk-commands start will retry)`)
      resolve()
    })
  })
}

// Stop a scene process and its children. POSIX kills the whole process group
// (negative pid); Windows has no process groups, so taskkill /T walks the tree.
function killChild(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' })
    } catch {
      /* already gone */
    }
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
}

// The scene-server process we own per port. The app never reuses or depends on
// an external process — it spawns its own and owns the output (the logs drawer).
// `stopping` distinguishes an intentional kill (replace/quit) from a crash, so
// the exit watchdog only auto-restarts genuine crashes; `restarts` bounds that.
type Managed = { child: ChildProcess; stopping: boolean; restarts: number }
const managed = new Map<number, Managed>()
const MAX_SCENE_RESTARTS = 3

/**
 * Spawn `sdk-commands start` and own the process. `restart` (default true) means
 * a process we previously spawned for this port is stopped and a fresh one
 * started — that's "entering a scene." `restart: false` reuses the process we
 * already own (e.g. the editor system scene, started once). We never probe to
 * reuse an external process; build/server output streams to `onLog`.
 * `--no-browser --no-client` keep sdk-commands from opening a browser tab or the
 * native Explorer.
 */
export async function startSceneServer(
  projectDir: string,
  port: number,
  extraArgs: string[],
  onLog: (line: string) => void,
  restart = true
): Promise<void> {
  const prev = managed.get(port)
  if (prev !== undefined && !restart && prev.child.exitCode === null) {
    onLog(`● port ${port}: reusing the process we already started`)
    // the reused process may still be installing/building (a rapid re-open) —
    // servers-ready must not fire before it actually serves, or the engine's
    // one-shot systemScene fetch hits a refused connection
    for (let i = 0; i < 120; i++) {
      if (await probe(`http://localhost:${port}/about`)) return
      if (prev.child.exitCode !== null) break // crashed — fall through to restart
      await new Promise((r) => setTimeout(r, 1000))
    }
    if (prev.child.exitCode === null) {
      throw new Error(`reused scene server on :${port} did not come up within 120s`)
    }
  }
  if (prev !== undefined) {
    onLog(`✖ port ${port}: stopping the previous scene process`)
    prev.stopping = true // intentional — the exit watchdog must not restart it
    killChild(prev.child)
    managed.delete(port)
  }
  killListener(port) // clear a stray squatter (crashed/detached run) so we can bind
  for (let i = 0; i < 20; i++) {
    if (!(await probe(`http://localhost:${port}/about`, 600))) break
    await new Promise((r) => setTimeout(r, 400))
  }

  await ensureProjectDeps(projectDir, onLog)

  const args = [
    'exec',
    '--',
    'sdk-commands',
    'start',
    '--port',
    String(port),
    '--no-browser', // no browser tab
    ...(supportsNoClient(projectDir) ? ['--no-client'] : []), // no native Explorer (newer sdk-commands only)
    ...extraArgs
  ]

  // Spawn + wire stdio and the crash watchdog. Reused for auto-restart: a genuine
  // crash (non-zero exit we didn't initiate) respawns up to MAX_SCENE_RESTARTS
  // with linear backoff; a clean exit or an intentional stop does not.
  const launch = (): ChildProcess => {
    onLog(`▶ port ${port}: starting "npm ${args.join(' ')}"  (cwd ${projectDir})`)
    const child = spawn('npm', args, {
      cwd: projectDir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // POSIX: own process group so killChild reaps sdk-commands' children.
      // Windows has no process groups (taskkill /T handles the tree instead).
      detached: process.platform !== 'win32'
    })
    const rec = managed.get(port) ?? { child, stopping: false, restarts: 0 }
    rec.child = child
    rec.stopping = false
    managed.set(port, rec)
    child.stdout?.on('data', (d: Buffer) => onLog(String(d).trimEnd()))
    child.stderr?.on('data', (d: Buffer) => onLog(String(d).trimEnd()))
    child.on('error', (e) => onLog(`✖ port ${port}: failed to spawn npm — ${e.message}`))
    child.on('exit', (code, signal) => {
      const r = managed.get(port)
      if (r === undefined || r.child !== child || r.stopping) return // replaced or intentional
      if (code === 0) {
        onLog(`● port ${port}: scene server exited cleanly`)
        managed.delete(port)
        return
      }
      if (r.restarts >= MAX_SCENE_RESTARTS) {
        onLog(`✖ port ${port}: scene server crashed (${code ?? signal}); exceeded ${MAX_SCENE_RESTARTS} restarts — giving up`)
        managed.delete(port)
        return
      }
      r.restarts++
      const delay = 1000 * r.restarts
      onLog(`⟳ port ${port}: scene server crashed (${code ?? signal}); restart ${r.restarts}/${MAX_SCENE_RESTARTS} in ${delay}ms`)
      setTimeout(() => {
        const cur = managed.get(port)
        if (cur !== undefined && !cur.stopping) launch()
      }, delay)
    })
    return child
  }
  const child = launch()

  for (let i = 0; i < 120; i++) {
    if (await probe(`http://localhost:${port}/about`)) {
      onLog(`✓ port ${port}: server is up`)
      return
    }
    if (child.exitCode !== null) {
      throw new Error(`scene server for ${projectDir} exited with code ${child.exitCode} (see Build / Server log)`)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`scene server on :${port} did not come up within 120s (see Build / Server log)`)
}

export function stopAll(): void {
  for (const rec of managed.values()) {
    rec.stopping = true // mark before killing so the exit watchdog won't restart
    killChild(rec.child)
  }
  managed.clear()
}
