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
// crossOriginIsolated editor pages refuse — proxy it same-origin instead.
const OPENDCL_ORIGIN = 'https://models.dclregenesislabs.xyz'

function proxyOpendcl(url: URL, res: http.ServerResponse): void {
  if (url.pathname === '/opendcl/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }).end('ok')
    return
  }
  const target = OPENDCL_ORIGIN + url.pathname.slice('/opendcl'.length) + url.search
  fetch(target)
    .then(async (r) => {
      res.writeHead(r.status, {
        'Content-Type': r.headers.get('content-type') ?? 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'public, max-age=86400'
      })
      const buf = Buffer.from(await r.arrayBuffer())
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
  const isUiAsset = (p: string): boolean => /^\/editor-(app\.html|app\.js|ui\.js)(\.map)?$/.test(p)
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
    if (url.pathname.startsWith('/opendcl/')) {
      proxyOpendcl(url, res)
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

// Free a port by killing only its LISTENER (lsof -sTCP:LISTEN) — never clients
// with an established connection (the comms server, the engine), since killing
// those breaks login. Used to clear a stray squatter from a crashed run so we
// can bind; we don't otherwise depend on anything external.
function killListener(port: number): void {
  try {
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
  let ok = false
  try {
    execSync(`grep -rq "no-client" node_modules/@dcl/sdk-commands/dist/commands/start`, {
      cwd: projectDir,
      stdio: 'ignore'
    })
    ok = true
  } catch {
    ok = false
  }
  noClientSupport.set(projectDir, ok)
  return ok
}

function killChild(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM')
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
const managed = new Map<number, ChildProcess>()

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
  if (prev !== undefined && !restart && prev.exitCode === null) {
    onLog(`● port ${port}: reusing the process we already started`)
    return
  }
  if (prev !== undefined) {
    onLog(`✖ port ${port}: stopping the previous scene process`)
    killChild(prev)
    managed.delete(port)
  }
  killListener(port) // clear a stray squatter (crashed/detached run) so we can bind
  for (let i = 0; i < 20; i++) {
    if (!(await probe(`http://localhost:${port}/about`, 600))) break
    await new Promise((r) => setTimeout(r, 400))
  }

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
  onLog(`▶ port ${port}: starting "npm ${args.join(' ')}"  (cwd ${projectDir})`)
  const child = spawn('npm', args, {
    cwd: projectDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true // own process group so killChild reaps sdk-commands' children
  })
  managed.set(port, child)
  child.stdout?.on('data', (d: Buffer) => onLog(String(d).trimEnd()))
  child.stderr?.on('data', (d: Buffer) => onLog(String(d).trimEnd()))
  child.on('error', (e) => onLog(`✖ port ${port}: failed to spawn npm — ${e.message}`))

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
  for (const c of managed.values()) killChild(c)
  managed.clear()
}
