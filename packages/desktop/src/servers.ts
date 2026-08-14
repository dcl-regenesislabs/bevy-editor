// Local stack management: the static bevy web server (with the COOP/COEP
// headers wasm threads require) and the two scene dev servers. If a port is
// already serving the right thing (a dev terminal session), it is reused.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

// Packaged images ship a Node runtime (with npm) at resources/node — see
// scripts/bundle-node.cjs. Users don't need Node installed, and a GUI-launched
// app's minimal PATH (no nvm/homebrew dirs) can't break us.
function bundledNodeDir(): string | null {
  const dir = path.join(process.resourcesPath ?? '', 'node')
  return fs.existsSync(dir) ? dir : null
}

// Run args on the bundled runtime (no shell). Children that sdk-commands spawns
// itself (`node`, `npm`, esbuild) must resolve to that same runtime, so its bin
// dir goes on PATH.
function spawnBundledNode(nodeDir: string, args: string[], opts: SpawnOptions): ChildProcess {
  const win = process.platform === 'win32'
  const nodeBin = win ? path.join(nodeDir, 'node.exe') : path.join(nodeDir, 'bin', 'node')
  const binDir = win ? nodeDir : path.join(nodeDir, 'bin')
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env) }
  // env var names are case-insensitive on Windows ('Path') — replace in place
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  env[pathKey] = binDir + path.delimiter + (env[pathKey] ?? '')
  return spawn(nodeBin, args, { ...opts, env })
}

// Spawn npm — bundled runtime when packaged, system npm in dev. (Also used by
// publish.ts.) With the bundled runtime we invoke npm-cli.js via its node
// directly (no shell).
// Dev fallback on Windows: npm is `npm.cmd`, which Node only runs through a
// shell (CVE-2024-27980) — quote each arg for cmd.exe ourselves.
export function spawnNpm(args: string[], opts: SpawnOptions): ChildProcess {
  const win = process.platform === 'win32'
  const nodeDir = bundledNodeDir()
  if (nodeDir !== null) {
    const npmCli = win
      ? path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    return spawnBundledNode(nodeDir, [npmCli, ...args], opts)
  }
  if (!win) return spawn('npm', args, opts)
  const quoted = args.map((a) => (/^[\w.,:/=@-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`))
  return spawn('npm.cmd', quoted, { ...opts, shell: true })
}

// Run a JS entry point on the runtime we already have — no npm in between.
function spawnNode(args: string[], opts: SpawnOptions): ChildProcess {
  const nodeDir = bundledNodeDir()
  if (nodeDir !== null) return spawnBundledNode(nodeDir, args, opts)
  // Dev has no bundled runtime: run on Electron's own Node rather than
  // trusting PATH. Children sdk-commands forks inherit the flag and the
  // same binary, which is what fork() would have picked anyway.
  const env = { ...(opts.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' }
  return spawn(process.execPath, args, { ...opts, env })
}

// Where a project's sdk-commands actually lives. Deps may be hoisted to a parent
// (the editor's own scene is a monorepo workspace), so walk up like Node does.
function resolveSdkCommands(projectDir: string): string | null {
  let dir = path.resolve(projectDir)
  for (;;) {
    const pkgDir = path.join(dir, 'node_modules', '@dcl', 'sdk-commands')
    if (fs.existsSync(path.join(pkgDir, 'dist', 'index.js'))) return pkgDir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

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
  // resolve like Node does — a workspace scene's deps live in a parent dir
  const pkgDir = resolveSdkCommands(projectDir)
  const startDir = path.join(pkgDir ?? projectDir, 'dist', 'commands', 'start')
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
// (Also used by publish.ts before `sdk-commands deploy`.)
export async function ensureProjectDeps(projectDir: string, onLog: (line: string) => void): Promise<void> {
  if (fs.existsSync(path.join(projectDir, 'node_modules', '@dcl', 'sdk-commands'))) return
  onLog(`● installing project dependencies in ${projectDir}…`)
  await new Promise<void>((resolve) => {
    const child = spawnNpm(['install', '--no-audit', '--no-fund'], {
      cwd: projectDir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const emit = (line: string): void => {
      const text = line.trimEnd()
      if (text !== '') onLog(text)
    }
    const out = lineReader(emit)
    const err = lineReader(emit)
    child.stdout?.on('data', (d: Buffer) => out.push(d))
    child.stderr?.on('data', (d: Buffer) => err.push(d))
    child.stdout?.on('end', () => out.flush())
    child.stderr?.on('end', () => err.flush())
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

// The editor's own scene (packages/scene) is a monorepo WORKSPACE: its deps are
// hoisted to the repo-root node_modules, so `packages/scene/node_modules` never
// exists. Both our ensureProjectDeps AND sdk-commands' own build step check for a
// local node_modules and, finding none, run `npm install` on EVERY launch — pure
// wasted time (the deps are already at root; the install is a no-op "up to date").
// A single marker file makes sdk-commands' `needsDependencies` (dir exists &&
// non-empty) return false, so it skips its install; node module resolution still
// walks up to the root node_modules for the real packages, so the build is
// unaffected. Idempotent; recreated if the dir was cleaned.
function ensureHoistedMarker(projectDir: string, onLog: (line: string) => void): void {
  const nm = path.join(projectDir, 'node_modules')
  try {
    if (fs.existsSync(nm) && fs.readdirSync(nm).length > 0) return
    fs.mkdirSync(nm, { recursive: true })
    fs.writeFileSync(
      path.join(nm, '.dcl-editor-hoisted'),
      'Deps are hoisted to the repo-root node_modules (workspace). This marker\n' +
        'stops sdk-commands from reinstalling on every launch. See servers.ts.\n'
    )
  } catch (e) {
    onLog(`● could not write hoisted-deps marker (${String(e)}) — sdk-commands may reinstall`)
  }
}

// Stop a scene process and its children. POSIX kills the whole process group
// (negative pid); Windows has no process groups, so taskkill /T walks the tree.
// We first detach the stdout/stderr forwarders so the dying server's shutdown
// chatter (well-known-components deprecation warnings etc.) stops reaching the
// log drawer / terminal. `signal` defaults to a graceful SIGTERM; app teardown
// passes SIGKILL so shutdown is instant and silent (no graceful-stop logs).
// (Also used by publish.ts to stop a deploy job.)
export function killChild(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  child.stdout?.removeAllListeners('data')
  child.stderr?.removeAllListeners('data')
  // 'end' carries the line reader's flush — detach it too, or the last partial
  // line of shutdown chatter still reaches the drawer after the kill.
  child.stdout?.removeAllListeners('end')
  child.stderr?.removeAllListeners('end')
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
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      /* already gone */
    }
  }
}

// The scene-server process we own per port. The app never reuses or depends on
// an external process — it spawns its own and owns the output (the logs drawer).
// `stopping` distinguishes an intentional kill (replace/quit) from a crash, so
// the exit watchdog only auto-restarts genuine crashes; `restarts` bounds that.
// `lastOutputAt` is the liveness signal the startup wait watches (see below) and
// `restartPending` tells it a dead child is about to be replaced by the watchdog
// rather than gone for good.
type Managed = {
  child: ChildProcess
  stopping: boolean
  restarts: number
  lastOutputAt: number
  restartPending: boolean
}
const managed = new Map<number, Managed>()
const MAX_SCENE_RESTARTS = 3

// A cold Windows start — npm install, esbuild bundle, then tsc over the whole
// scene, on a slow disk — routinely passes two minutes, so a fixed deadline
// fails servers that were about to come up. Wait on PROGRESS instead: the clock
// resets on every line the child prints, and only real silence fails. The gap
// between "Starting preview server" and the port actually listening is the
// quiet stretch to survive; the hard cap is the backstop for a wedged process.
const SCENE_SILENT_MS = 150_000
const SCENE_HARD_CAP_MS = 900_000

// Thrown when a newer startSceneServer for the same port replaced the process
// this call was waiting on (the user picked another scene mid-launch). Not a
// failure — the caller drops it rather than showing "the scene failed to start".
export class SceneStartSuperseded extends Error {
  constructor(port: number) {
    super(`scene start on :${port} was superseded by a newer launch`)
    this.name = 'SceneStartSuperseded'
  }
}

// Poll /about until the server answers. Returns false (instead of throwing) if
// the child died for good, so the reuse path can fall through to a fresh spawn.
async function waitForScene(port: number, initial: ChildProcess, rec: Managed): Promise<boolean> {
  const startedAt = Date.now()
  let child = initial
  for (;;) {
    if (await probe(`http://localhost:${port}/about`)) return true
    // The crash watchdog respawned it — adopt the new process and keep waiting.
    // First, so a completed restart is never mistaken for the death below.
    if (rec.child !== child) {
      child = rec.child
      continue
    }
    // Dead with nobody coming to replace it (the watchdog gave up, the build
    // failed, or it exited on its own) — a genuine failure. Checked before the
    // supersede test, because giving up also drops the record.
    if (child.exitCode !== null && !rec.restartPending && !rec.stopping) return false
    // Someone else took the port: another scene launch replaced our process, or
    // the user left the scene. That kill is intentional, so it must never be
    // reported as a crash of the scene we were opening.
    if (rec.stopping || managed.get(port) !== rec) throw new SceneStartSuperseded(port)
    const now = Date.now()
    if (now - rec.lastOutputAt > SCENE_SILENT_MS) {
      throw new Error(
        `scene server on :${port} printed nothing for ${Math.round(SCENE_SILENT_MS / 1000)}s and never came up (see Build / Server log)`
      )
    }
    if (now - startedAt > SCENE_HARD_CAP_MS) {
      throw new Error(`scene server on :${port} did not come up within ${SCENE_HARD_CAP_MS / 60_000} minutes (see Build / Server log)`)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}

/**
 * Spawn `sdk-commands start` and own the process. `restart` (default true) means
 * a process we previously spawned for this port is stopped and a fresh one
 * started — that's "entering a scene." `restart: false` reuses the process we
 * already own (e.g. the editor system scene, started once). We never probe to
 * reuse an external process; build/server output streams to `onLog`.
 * `--no-browser --no-client` keep sdk-commands from opening a browser tab or the
 * native Explorer.
 *
 * `workspaceDeps: true` marks a monorepo-workspace scene (the editor's own
 * packages/scene) whose deps are hoisted to the repo root — skip the per-launch
 * install and just drop a marker so sdk-commands doesn't reinstall either.
 */
// sdk-commands ≥7.22 prints a terminal QR ("scan to preview on mobile") on every
// start — mobile mode DEFAULTS ON and its only off-switches (--ci / CI env) also
// flip bevyWeb off, which would make this version try to launch the native
// Explorer. So the banner can't be disabled at the source; drop it at the relay
// instead. The app's own Preview → Phone builds the same deep link on demand.
//
// Each QR row is wrapped in colour escapes (\e[47m\e[30m…), so the glyph test
// has to run on the de-coloured text — otherwise ~20 lines of block art land in
// the log drawer on every start and push real build errors out of the tail the
// error card shows.
const ANSI = /\u001b\[[0-9;]*m/g
function isMobileQrLine(line: string): boolean {
  const t = line.replace(ANSI, '').trim()
  if (t.startsWith('Scan to preview on mobile')) return true
  if (t.startsWith('This QR redirects to')) return true
  // the QR art itself: lines of block glyphs (with their inverse spaces)
  return t.length > 10 && /^[▄▀█ ]+$/.test(t)
}

export interface LineReader {
  push: (chunk: Buffer) => void
  /** emit whatever the stream ended on, unterminated */
  flush: () => void
}

// A child's stdout/stderr 'data' events are byte chunks, NOT lines: one chunk can
// end mid-line and the rest of that line arrives in the next event. Splitting each
// chunk on its own therefore cuts lines in two — and a `[server]` tag sliced across
// the cut is a line the editor's Game tab can no longer recognise. So keep the
// trailing fragment and prepend it to the next chunk: everything `emit` receives
// is one whole line, and the last unterminated one comes out on flush().
//
// A chunk boundary also cuts multi-byte characters in half, so the bytes go
// through a StringDecoder rather than String(chunk): the decoder holds the
// partial sequence back until the rest of it arrives, where decoding each
// Buffer on its own would turn one accented letter into two U+FFFD.
export function lineReader(emit: (line: string) => void): LineReader {
  const decoder = new StringDecoder('utf8')
  let residual = ''
  return {
    push(chunk) {
      residual += decoder.write(chunk)
      const parts = residual.split(/\r?\n/)
      residual = parts.pop() ?? '' // a lone trailing '\r' waits here for its '\n'
      for (const line of parts) emit(line)
    },
    flush() {
      residual += decoder.end() // whatever the stream ended mid-sequence on
      if (residual === '') return
      const last = residual
      residual = ''
      emit(last)
    }
  }
}

export async function startSceneServer(
  projectDir: string,
  port: number,
  extraArgs: string[],
  onLog: (line: string) => void,
  restart = true,
  workspaceDeps = false
): Promise<void> {
  const prev = managed.get(port)
  if (prev !== undefined && !restart && prev.child.exitCode === null) {
    onLog(`● port ${port}: reusing the process we already started`)
    // the reused process may still be installing/building (a rapid re-open) —
    // servers-ready must not fire before it actually serves, or the engine's
    // one-shot systemScene fetch hits a refused connection
    if (await waitForScene(port, prev.child, prev)) return
    // crashed — fall through to a fresh spawn
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

  if (workspaceDeps) ensureHoistedMarker(projectDir, onLog)
  else await ensureProjectDeps(projectDir, onLog)

  const startArgs = [
    'start',
    '--port',
    String(port),
    '--no-browser', // no browser tab
    ...(supportsNoClient(projectDir) ? ['--no-client'] : []), // no native Explorer (newer sdk-commands only)
    ...extraArgs
  ]
  // `npm exec` boots npm — itself a large JS program — on every scene start,
  // just to resolve a bin whose path we can compute. That overhead is paid per
  // launch and is far worse on Windows, where an unsigned app's files go
  // through Defender on every read. Run the CLI entry point directly when it's
  // installed where we expect; `npm exec` stays the fallback.
  const cli = resolveSdkCommands(projectDir)
  const args = cli === null ? ['exec', '--', 'sdk-commands', ...startArgs] : [path.join(cli, 'dist', 'index.js'), ...startArgs]
  const shown = `${cli === null ? 'npm exec -- sdk-commands' : 'sdk-commands'} ${startArgs.join(' ')}`
  const spawnCli = cli === null ? spawnNpm : spawnNode

  // Spawn + wire stdio and the crash watchdog. Reused for auto-restart: a genuine
  // crash (non-zero exit we didn't initiate) respawns up to MAX_SCENE_RESTARTS
  // with linear backoff; a clean exit or an intentional stop does not.
  const launch = (): ChildProcess => {
    onLog(`▶ port ${port}: starting "${shown}"  (cwd ${projectDir})`)
    const spawnedAt = Date.now()
    const child = spawnCli(args, {
      cwd: projectDir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // POSIX: own process group so killChild reaps sdk-commands' children.
      // Windows has no process groups (taskkill /T handles the tree instead).
      detached: process.platform !== 'win32'
    })
    const rec = managed.get(port) ?? {
      child,
      stopping: false,
      restarts: 0,
      lastOutputAt: Date.now(),
      restartPending: false
    }
    rec.child = child
    rec.stopping = false
    rec.restartPending = false
    rec.lastOutputAt = Date.now()
    managed.set(port, rec)
    // A crash caused by the scene's own code failing to build is deterministic —
    // the same file produces the same failure, so restarting is 3 attempts of
    // pure noise before the same error card. Track the marker per child; a
    // successful bundle clears it (watch-mode rebuild failures print the same
    // line without killing the server).
    let sawBuildFailure = false
    // The Multiplayer Server runs inside this process tree, so the shared copy's
    // `[server]` lines arrive here and the editor's Game tab reads the tag off the
    // START of each relayed line. lineReader is what makes that safe: every call
    // to onLog is exactly one whole line, reassembled across chunk boundaries.
    //
    // The precondition, because it is easy to get backwards: this happens only
    // when the SCENE has the auth-server SDK and toolchain installed
    // (@dcl/sdk + @dcl/sdk-commands from the auth-server channel — the shipped
    // templates pin it, and sdk-capability.ts installs it into scenes that lack
    // it). That toolchain's `start` command spawns the Multiplayer Server on
    // every local run, with no flag to suppress it, so a local Play does have a
    // server and isServer() is true on that copy. A scene still on the standard
    // SDK has no server at all and never prints a `[server]` line here.
    // Blank lines collapse to at most one so a spaced-out build report stays
    // readable without padding the drawer's backlog.
    let blank = true
    const onLine = (line: string): void => {
      if (/Build failed with \d+ errors?/.test(line)) sawBuildFailure = true
      else if (line.includes('Bundle saved')) sawBuildFailure = false
      if (isMobileQrLine(line)) return
      const text = line.trimEnd()
      if (text === '') {
        if (blank) return
        blank = true
      } else blank = false
      onLog(text)
    }
    const out = lineReader(onLine)
    const err = lineReader(onLine)
    // Liveness and the boot timing are read off the BYTES, not the lines the
    // reader emits: a chunk that ends mid-line is still the process talking, and
    // holding its fragment back until the newline arrives would read as silence.
    let sawOutput = false
    const onData = (reader: LineReader) => (d: Buffer): void => {
      const now = Date.now()
      // Time to the CLI's first byte separates "the runtime and sdk-commands
      // were still loading" from "the scene was building" — without it a slow
      // start is one opaque number. Only worth saying when it's pathological.
      if (!sawOutput) {
        sawOutput = true
        const boot = (now - spawnedAt) / 1000
        if (boot > 10) onLog(`● port ${port}: sdk-commands took ${boot.toFixed(1)}s to produce output (runtime + CLI startup)`)
      }
      rec.lastOutputAt = now // liveness for waitForScene
      reader.push(d)
    }
    child.stdout?.on('data', onData(out))
    child.stderr?.on('data', onData(err))
    child.stdout?.on('end', () => out.flush())
    child.stderr?.on('end', () => err.flush())
    child.on('error', (e) => onLog(`✖ port ${port}: failed to spawn the scene server — ${e.message}`))
    child.on('exit', (code, signal) => {
      const r = managed.get(port)
      if (r === undefined || r.child !== child || r.stopping) return // replaced or intentional
      // A process that dies mid-line leaves its last line in the reader, and
      // that line is usually the one that says why it died — 'end' on the pipes
      // is not ordered against 'exit', so flush here before the exit is judged.
      // flush() is idempotent, so the later 'end' emits nothing twice.
      //
      // Below the return on purpose: killChild detaches the pipes' own flush
      // exactly so a stopped server's last partial line of shutdown chatter
      // stays out of the drawer, and flushing here would put it back.
      out.flush()
      err.flush()
      if (code === 0) {
        onLog(`● port ${port}: scene server exited cleanly`)
        managed.delete(port)
        return
      }
      if (sawBuildFailure) {
        onLog(`✖ port ${port}: the scene's code failed to build — fix the error, then try again (not restarting)`)
        managed.delete(port)
        return
      }
      if (r.restarts >= MAX_SCENE_RESTARTS) {
        onLog(`✖ port ${port}: scene server crashed (${code ?? signal}); exceeded ${MAX_SCENE_RESTARTS} restarts — giving up`)
        managed.delete(port)
        return
      }
      r.restarts++
      r.restartPending = true // a waiting startSceneServer must not call this dead yet
      const delay = 1000 * r.restarts
      onLog(`⟳ port ${port}: scene server crashed (${code ?? signal}); restart ${r.restarts}/${MAX_SCENE_RESTARTS} in ${delay}ms`)
      setTimeout(() => {
        const cur = managed.get(port)
        if (cur !== undefined && !cur.stopping) launch()
      }, delay)
    })
    return child
  }
  const startedAt = Date.now()
  const child = launch()
  const rec = managed.get(port)
  if (rec === undefined) throw new SceneStartSuperseded(port) // stopped before we could wait

  if (await waitForScene(port, child, rec)) {
    onLog(`✓ port ${port}: server is up (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`)
    return
  }
  throw new Error(`scene server for ${projectDir} exited with code ${child.exitCode} (see Build / Server log)`)
}

// App teardown: SIGKILL every managed server (and its group) at once. Forceful,
// not graceful — on quit we don't need the servers to shut down cleanly, and
// SIGKILL skips their noisy graceful-shutdown logs entirely.
export function stopAll(): void {
  for (const rec of managed.values()) {
    rec.stopping = true // mark before killing so the exit watchdog won't restart
    killChild(rec.child, 'SIGKILL')
  }
  managed.clear()
}

// Stop just the process we own on `port` (and its children — the dev server,
// its build watcher, and the auth-server it spawns). Used when leaving a scene
// back to the picker so the project's sdk-commands process doesn't linger.
export function stopSceneServer(port: number): void {
  const rec = managed.get(port)
  if (rec === undefined) return
  rec.stopping = true // intentional — the exit watchdog must not restart it
  killChild(rec.child)
  managed.delete(port)
}
