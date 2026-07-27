// App auto-update. One UX on every platform: silent background check +
// download, a passive "Restart to update" affordance once the new version is
// staged, and a silent install on the next natural quit if it's ignored.
//
// Windows rides electron-updater's NSIS flow (which works unsigned; the
// installer relaunches the app itself). macOS can't: Squirrel.Mac refuses to
// install into an unsigned app, so the install step is ours — download the
// release zip, verify it against latest-mac.yml's sha512, pre-extract it, and
// on restart/quit rename the running .app aside and the staged one into place.
// Because this process downloads the zip itself, the new bundle never gets the
// Gatekeeper quarantine flag. If the app is ever code-signed, delete the mac
// branch and let electron-updater handle both platforms — the contract and UI
// stay exactly as they are.
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UpdateStatus } from '@dcl-editor/contract'

// keep in sync with electron-builder.yml's publish block. `releases/latest`
// always resolves the newest published (non-draft, non-prerelease) release.
const GITHUB_REPO = 'dcl-regenesislabs/bevy-editor'
const FEED_BASE = `https://github.com/${GITHUB_REPO}/releases/latest/download`
export const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`

const FIRST_CHECK_MS = 30_000 // off the startup critical path
const RECHECK_MS = 4 * 60 * 60 * 1000

let status: UpdateStatus = { state: 'idle' }
let emit: (s: UpdateStatus) => void = () => {}
let logLine: (line: string) => void = () => {}
let installed = false // the staged update was applied (guards double-install)

// a fully extracted, checksum-verified .app waiting to be swapped in
interface MacStaged {
  version: string
  appDir: string
}
let macStaged: MacStaged | null = null

function set(s: UpdateStatus): void {
  status = s
  emit(s)
}

export function updateStatus(): UpdateStatus {
  return status
}

export function initUpdater(emitFn: (s: UpdateStatus) => void, log: (line: string) => void): void {
  emit = emitFn
  logLine = log
  if (!app.isPackaged) {
    status = { state: 'unsupported', reason: 'dev' }
    return
  }
  if (process.platform === 'darwin' && process.execPath.includes('/AppTranslocation/')) {
    // running straight from the DMG image — read-only, nothing to swap
    status = { state: 'unsupported', reason: 'translocated' }
    return
  }
  if (process.platform === 'win32') initWin()
  else macRecoverStaged()
  setTimeout(() => void backgroundCheck(), FIRST_CHECK_MS)
  setInterval(() => void backgroundCheck(), RECHECK_MS)
}

async function backgroundCheck(): Promise<void> {
  if (status.state !== 'idle') return
  try {
    if (process.platform === 'win32') await autoUpdater.checkForUpdates()
    else await macCheck()
  } catch (e) {
    // silent in the UI — retried at the next interval; visible in the log drawer
    logLine(`✖ update check failed: ${String(e)}`)
  }
}

// User-initiated check (Account card / native menu): resolves with the outcome
// so the caller can give explicit "up to date" / error closure.
export async function manualCheck(): Promise<UpdateStatus> {
  if (status.state !== 'idle' && status.state !== 'error') return status
  set({ state: 'checking' })
  try {
    if (process.platform === 'win32') {
      await autoUpdater.checkForUpdates() // update-available flips state to downloading
      if (updateStatus().state === 'checking') set({ state: 'idle' })
    } else {
      await macCheck()
    }
  } catch (e) {
    set({ state: 'error', message: String(e) })
  }
  return status
}

// User clicked Restart: install now and relaunch into the new version. The
// caller (main.ts) tears the local stack down first.
export function installAndRestart(): void {
  try {
    if (process.platform === 'win32') {
      autoUpdater.quitAndInstall(true, true) // silent install + relaunch (Windows-only args)
      return
    }
    macInstall()
    app.relaunch() // process.execPath's path now holds the new bundle
    app.exit(0)
  } catch (e) {
    logLine(`✖ update install failed: ${String(e)}`)
    set({ state: 'error', message: String(e) })
  }
}

// Natural quit with a staged update: apply it silently, no relaunch. Windows is
// covered by autoInstallOnAppQuit; this is the macOS parity hook (main.ts calls
// it from before-quit).
export function installOnQuit(): void {
  if (process.platform !== 'darwin' || status.state !== 'downloaded') return
  try {
    macInstall()
  } catch (e) {
    logLine(`✖ update install on quit failed: ${String(e)}`)
  }
}

// ---- Windows: stock electron-updater ----

function initWin(): void {
  autoUpdater.autoDownload = false // we call downloadUpdate() ourselves — manual + background checks share one path
  autoUpdater.autoInstallOnAppQuit = true // an ignored update installs on the next natural quit
  autoUpdater.logger = null
  autoUpdater.on('update-available', (info) => {
    set({ state: 'downloading', version: info.version, percent: 0 })
    autoUpdater.downloadUpdate().catch((e) => {
      logLine(`✖ update download failed: ${String(e)}`)
      set({ state: 'idle' }) // retry at the next interval
    })
  })
  autoUpdater.on('download-progress', (p) => {
    if (status.state === 'downloading') set({ ...status, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => set({ state: 'downloaded', version: info.version }))
  autoUpdater.on('update-not-available', () => {
    if (status.state === 'checking') set({ state: 'idle' })
  })
  autoUpdater.on('error', (e) => {
    logLine(`✖ updater: ${String(e)}`)
    if (status.state === 'checking' || status.state === 'downloading') set({ state: 'error', message: String(e) })
  })
}

// ---- macOS: manual zip flow (no code signature to satisfy Squirrel.Mac) ----

interface MacFeed {
  version: string
  assets: Array<{ name: string; sha512: string }>
}

// latest-mac.yml is generated by electron-builder with a fixed shape — this is
// a targeted extraction, not a yaml parser
function parseFeed(text: string): MacFeed {
  const version = /^version:\s*(\S+)/m.exec(text)?.[1]
  if (version === undefined) throw new Error('update feed: no version field')
  const assets: MacFeed['assets'] = []
  const re = /-\s*url:\s*(\S+)\s*\n\s*sha512:\s*(\S+)/g
  for (let m = re.exec(text); m !== null; m = re.exec(text)) assets.push({ name: m[1], sha512: m[2] })
  return { version, assets }
}

function isNewer(remote: string, local: string): boolean {
  const norm = (v: string): number[] =>
    v.replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0)
  const a = norm(remote)
  const b = norm(local)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

function updatesRoot(): string {
  return path.join(app.getPath('userData'), 'updates')
}

async function macCheck(): Promise<void> {
  const res = await fetch(`${FEED_BASE}/latest-mac.yml`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
  if (res.status === 404) {
    // no published release carries update metadata yet
    if (status.state === 'checking') set({ state: 'idle' })
    return
  }
  if (!res.ok) throw new Error(`update feed: HTTP ${res.status}`)
  const feed = parseFeed(await res.text())
  if (!isNewer(feed.version, app.getVersion())) {
    if (status.state === 'checking') set({ state: 'idle' })
    return
  }
  if (macStaged !== null && macStaged.version === feed.version) {
    set({ state: 'downloaded', version: feed.version })
    return
  }
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const asset = feed.assets.find((a) => a.name.endsWith(`-mac-${arch}.zip`))
  if (asset === undefined) throw new Error(`update feed: no mac ${arch} zip in v${feed.version}`)
  await macDownload(feed.version, asset)
}

async function macDownload(version: string, asset: { name: string; sha512: string }): Promise<void> {
  set({ state: 'downloading', version, percent: 0 })
  const root = updatesRoot()
  fs.rmSync(root, { recursive: true, force: true }) // one pending update at a time
  const dir = path.join(root, version)
  fs.mkdirSync(dir, { recursive: true })
  const zipPath = path.join(dir, asset.name)
  try {
    const res = await fetch(`${FEED_BASE}/${asset.name}`, { signal: AbortSignal.timeout(30 * 60_000) })
    if (!res.ok || res.body === null) throw new Error(`update download: HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length') ?? 0)
    const hash = crypto.createHash('sha512')
    let got = 0
    let lastPct = -1
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb): void {
        hash.update(chunk)
        got += chunk.length
        const pct = total > 0 ? Math.floor((got / total) * 100) : 0
        if (pct !== lastPct && status.state === 'downloading') {
          lastPct = pct
          set({ state: 'downloading', version, percent: pct })
        }
        cb(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), meter, fs.createWriteStream(zipPath))
    if (hash.digest('base64') !== asset.sha512) throw new Error('update rejected: checksum mismatch')
    // ditto preserves symlinks/permissions and never applies quarantine
    const extractDir = path.join(dir, 'extract')
    await new Promise<void>((resolve, reject) => {
      execFile('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir], (err) => (err !== null ? reject(err) : resolve()))
    })
    const appName = fs.readdirSync(extractDir).find((n) => n.endsWith('.app'))
    if (appName === undefined) throw new Error('update zip had no .app inside')
    fs.rmSync(zipPath, { force: true }) // keep only the extracted bundle
    macStaged = { version, appDir: path.join(extractDir, appName) }
    fs.writeFileSync(path.join(dir, 'staged.json'), JSON.stringify(macStaged))
    set({ state: 'downloaded', version })
  } catch (e) {
    fs.rmSync(root, { recursive: true, force: true })
    throw e
  }
}

// Re-adopt a staged-but-not-installed update from a previous run, and clear
// anything stale (already applied, superseded, or half-downloaded).
function macRecoverStaged(): void {
  let entries: string[]
  try {
    entries = fs.readdirSync(updatesRoot())
  } catch {
    return
  }
  for (const e of entries) {
    const dir = path.join(updatesRoot(), e)
    try {
      const st = JSON.parse(fs.readFileSync(path.join(dir, 'staged.json'), 'utf8')) as MacStaged
      if (isNewer(st.version, app.getVersion()) && fs.existsSync(st.appDir)) {
        macStaged = st
        status = { state: 'downloaded', version: st.version } // pre-window: pulled, not pushed
        continue
      }
    } catch {
      /* not a valid staged dir */
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// …/Bevy Scene Editor.app/Contents/MacOS/<bin> → the .app root
function bundleDir(): string {
  const parts = process.execPath.split(path.sep)
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].endsWith('.app')) return parts.slice(0, i + 1).join(path.sep)
  }
  throw new Error('not running from an .app bundle')
}

// Swap the staged bundle into place. Renaming a running .app is legal on
// macOS (open files live on by inode), which is what makes self-update
// possible without a helper process.
function macInstall(): void {
  if (macStaged === null || installed) return
  const target = bundleDir()
  fs.accessSync(path.dirname(target), fs.constants.W_OK) // e.g. non-admin user + /Applications
  const aside = `${target}.previous` // same dir ⇒ same volume ⇒ rename can't EXDEV
  fs.rmSync(aside, { recursive: true, force: true })
  fs.renameSync(target, aside)
  try {
    try {
      fs.renameSync(macStaged.appDir, target)
    } catch {
      // userData and the install dir on different volumes — copy instead
      execFileSync('/usr/bin/ditto', [macStaged.appDir, target])
    }
    installed = true
    fs.rmSync(updatesRoot(), { recursive: true, force: true }) // consumed
    fs.rmSync(aside, { recursive: true, force: true }) // our inodes stay alive until exit
  } catch (e) {
    try {
      fs.renameSync(aside, target) // roll back — never leave the user with no app
    } catch {
      logLine(`✖ update rollback failed — previous version is at ${aside}`)
    }
    throw e
  }
}
