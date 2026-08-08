// Proof probe: `game` is reachable from a scene the creator only wrote a script in.
//
// Create a scene from the shipped blank template, drop ONE creator-authored file
// into src/scripts/ that imports './runtime/game', attach it through the composite,
// and open it. Nothing carries the module in — the editor's generation pass is the
// only thing that can put it there, and everything downstream depends on it:
//
//   generation   src/scripts/runtime/game.ts appears with its whole dependency
//                closure, byte-identical to packages/desktop/runtime-modules.
//   build        sdk-commands bundles all of it — 28 modules against the scene's
//                auth-server pin, from one import in one creator file.
//   boot         the scene runs, the script's start() ran, and registering a
//                handler + asking the game threw nothing.
//   round-trip   the ask reached the game's handler and its reply came back.
//
// LOCAL PREVIEW: `sdk-commands start` has no option that boots a Multiplayer
// Server, so isServer() is false in every local run and `round-trip` is
// unreachable — it is reported as SKIP, not as PASS. Deploy the scene to a world
// and re-run with GAME_PROBE_REQUIRE_SERVER=1 to hold the gate to the full set.
//
// Manual, like every probe here: `npm run validate` is the gate, this is the
// user's step. Needs a built app — run after `npm run build`.
//
// Reuses the CDP pattern of probe-server-clock.mjs / probe-zombie-arena.mjs.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { transitiveModules } from '../../../scripts/sync-runtime-modules.mjs'
import { mergeComposite, write } from './probe-script-runner.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const repoRoot = path.resolve(here, '../../..')
const fixtures = path.join(here, 'fixtures', 'game-probe')
const mastersDir = path.join(repoRoot, 'packages/desktop/runtime-modules')

const CDP_PORT = 9438
const PROBE_SCRIPT = 'src/scripts/game-probe.ts'
const VENDORED_DIR = 'src/scripts/runtime'

let msgId = 0
const pending = new Map()
let ws = null
let pageSession = null
let electron = null
let scratch = null
let keepScratch = false

function send(method, params, sessionId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    const t = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${method} timeout`))
    }, timeoutMs)
    pending.set(id, {
      resolve: (r) => {
        clearTimeout(t)
        resolve(r)
      },
      reject
    })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}

async function attach() {
  const targets = await send('Target.getTargets', {})
  const page = targets.targetInfos.find((t) => t.type === 'page' && t.url.includes('editor-app'))
  if (!page) throw new Error('no editor page target')
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
  pageSession = sessionId
  await send('Runtime.enable', {}, pageSession).catch(() => {})
}

async function evalIn(expr, timeoutMs = 30000) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, pageSession, timeoutMs)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}

async function waitFor(label, fn, timeoutMs, intervalMs = 2000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`)
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function cleanup() {
  electron?.kill()
  if (scratch === null || keepScratch) return
  // the scene's dev server is still flushing as Electron dies, so a plain rmSync
  // races it and throws ENOTEMPTY — which would turn a pass into a harness failure
  try {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  } catch {
    /* tmp is reaped by the OS; a leftover scratch is not a probe result */
  }
}

const readMaster = (rel) => {
  const p = path.join(mastersDir, rel)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}

/** What the editor must put in the scene: game.ts and everything it imports. */
function expectedClosure() {
  return transitiveModules(['game.ts'], readMaster)
}

const RECORD_RE = /\[GAME-PROBE\]\s*(\{.*)$/

function parseRecords(text) {
  const out = []
  for (const line of String(text ?? '').split('\n')) {
    const m = RECORD_RE.exec(line)
    if (!m) continue
    try {
      out.push(JSON.parse(m[1].trim()))
    } catch {
      /* a truncated ring-buffer line — the CRDT channel carries the same record */
    }
  }
  return out
}

function dedupe(records) {
  const seen = new Map()
  for (const r of records) {
    const key = `${r.tag}:${r.n ?? r.now ?? ''}:${r.server ?? ''}`
    if (!seen.has(key)) seen.set(key, r)
  }
  return [...seen.values()]
}

const of = (records, tag) => records.filter((r) => r.tag === tag)

async function main() {
  const electronDir = [path.join(root, 'node_modules', 'electron'), path.join(root, '..', '..', 'node_modules', 'electron')].find(
    (d) => fs.existsSync(path.join(d, 'path.txt'))
  )
  if (!electronDir) throw new Error('electron not installed — run npm install')
  const electronPath = path.join(electronDir, 'dist', fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim())
  try {
    execSync(`pkill -f 'remote-debugging-port=${CDP_PORT}'`, { stdio: 'ignore' })
    await sleep(1500)
  } catch {}

  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'game-probe-'))
  // private userData + shifted ports: runs even while a dev editor is open
  const env = {
    ...process.env,
    BEVY_EDITOR_DEBUG: '1',
    BEVY_EDITOR_USER_DATA: path.join(scratch, 'user-data'),
    BEVY_WEB_PORT: '3116',
    SCENE_PORT: '8112',
    EDITOR_SCENE_PORT: '8113'
  }
  delete env.BEVY_EDITOR_PROJECT
  electron = spawn(electronPath, ['.', `--remote-debugging-port=${CDP_PORT}`], { cwd: root, env, stdio: ['ignore', 'ignore', 'ignore'] })

  const version = await waitFor(
    'CDP endpoint',
    async () => {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      return res.ok ? res.json() : null
    },
    30000,
    1000
  )
  ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 })
  ws.on('message', (raw) => {
    const m = JSON.parse(raw)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
    }
  })
  await new Promise((r) => ws.on('open', r))
  await waitFor('page target', async () => {
    await attach()
    return true
  }, 60000, 1500)

  const fail = (step, detail) => {
    console.log(`FAIL ${step} — ${detail}`)
    keepScratch = true
    console.log(`scratch kept for inspection: ${scratch}`)
    cleanup()
    process.exit(1)
  }
  const pass = (step, detail) => console.log(`PASS ${step}${detail ? ` — ${detail}` : ''}`)
  const skip = (step, detail) => console.log(`SKIP ${step} — ${detail}`)

  // 1. a fresh scene from the shipped template
  await waitFor('picker', () => evalIn(`!!window.editorShell`), 60000, 1000)
  const dest = await evalIn(`window.editorShell.createScene(${JSON.stringify(scratch)}, 'Game Probe', 'blank')`, 30000)
  if (!dest || typeof dest !== 'string') fail('create-scene', String(dest))

  // 2. the creator's file, and its Script row — nothing else. No prefab is placed,
  // so the scene holds no carried copy of anything.
  write(dest, PROBE_SCRIPT, fs.readFileSync(path.join(fixtures, 'game-probe.ts'), 'utf8'))
  mergeComposite(dest, JSON.parse(fs.readFileSync(path.join(fixtures, 'composite-fragment.json'), 'utf8')))
  if (fs.existsSync(path.join(dest, VENDORED_DIR))) fail('authoring', `${VENDORED_DIR} exists before the editor opened the scene`)
  pass('authoring', `${PROBE_SCRIPT} written, attached to entity 528, no runtime module in the scene`)

  // 3. open — npm install + the generation pass + sdk-commands build
  await evalIn(`(window.editorShell.openProject(${JSON.stringify(dest)}), true)`)
  await sleep(3000)
  await attach()
  await waitFor(
    'editor ready',
    async () => {
      try {
        return await evalIn(`(() => { const s = window.__eui; return s && s.status === 'ready' ? 'ready' : null })()`)
      } catch {
        await attach().catch(() => {})
        return null
      }
    },
    420000,
    5000
  )
  pass('open', dest)

  // 4. generation: the whole closure, byte-identical to the masters
  const closure = expectedClosure()
  const gameModule = path.join(dest, VENDORED_DIR, 'game.ts')
  await waitFor('the game module in the scene', async () => (fs.existsSync(gameModule) ? 'yes' : null), 180000, 1000).catch(() =>
    fail('generation', `${VENDORED_DIR}/game.ts was never written — one import in ${PROBE_SCRIPT} did not reach the generation pass`)
  )
  const missing = []
  const drifted = []
  for (const rel of closure) {
    const copy = path.join(dest, VENDORED_DIR, rel)
    if (!fs.existsSync(copy)) missing.push(rel)
    else if (fs.readFileSync(copy, 'utf8') !== readMaster(rel)) drifted.push(rel)
  }
  if (missing.length > 0) fail('generation', `${missing.length} of ${closure.length} modules are missing: ${missing.join(', ')}`)
  if (drifted.length > 0) fail('generation', `not byte-identical to the masters: ${drifted.join(', ')}`)
  pass('generation', `${closure.length} modules under ${VENDORED_DIR}/, byte-identical to runtime-modules/`)

  // 5. build: the bundle carries all of it
  const bundle = path.join(dest, 'bin', 'index.js')
  await waitFor('bundle', async () => (fs.existsSync(bundle) ? 'yes' : null), 300000, 2000).catch(() => null)
  if (!fs.existsSync(bundle)) {
    const logs = await evalIn(`window.editorShell.getState().then((s) => s.logs.slice(-40).join('\\n'))`).catch((e) => e.message)
    console.log('DIAGNOSTIC LOGS:\n' + logs)
    fail('build', 'bin/index.js was never produced — the scene does not compile with the generated module')
  }
  const bundleText = fs.readFileSync(bundle, 'utf8')
  for (const marker of ['GameProbe', '__dclGame_v1']) {
    if (!bundleText.includes(marker)) fail('build', `${marker} is missing from bin/index.js`)
  }
  pass('build', `bin/index.js carries the script and the game module (${(bundleText.length / 1024).toFixed(0)} KB)`)

  // 6. Play — scripts do not run in edit mode
  await sleep(5000)
  const played = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const btn = sh.querySelector('button[data-tip="Run the scene"]')
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!played) fail('play', 'Run the scene button not found')
  pass('play', 'entered play mode')

  // 7. collect. The CRDT TextShape set is written once per record; the client log
  // ring and the editor's own log (which carries the server's console) fill in.
  const readCrdt = () =>
    evalIn(`(async () => {
      const r = await window.__euiCmd('crdt_snapshot', [])
      const s = JSON.parse(r)
      const out = []
      for (const comps of Object.values(s)) {
        const t = comps.TextShape?.text
        if (typeof t === 'string' && t.includes('[GAME-PROBE]')) out.push(t)
      }
      return out.join('\\n')
    })()`).catch(() => '')
  const readSceneLogs = () => evalIn(`window.__euiCmd('scene_logs', ['400'])`).catch(() => '')
  const readShellLogs = () => evalIn(`window.editorShell.getState().then((s) => s.logs.slice(-400).join('\\n'))`).catch(() => '')

  let records = []
  let sceneLogText = ''
  // Without a Multiplayer Server the last reachable record is the client's own
  // ask failing; waiting five minutes for a reply that can never arrive only
  // makes the probe slow.
  const done = (rs) => of(rs, 'round-trip').length > 0 || (of(rs, 'boot').length > 0 && of(rs, 'ask-failed').length > 0)
  const deadline = Date.now() + 240000
  for (;;) {
    sceneLogText = await readSceneLogs()
    records = dedupe([...parseRecords(await readCrdt()), ...parseRecords(sceneLogText), ...parseRecords(await readShellLogs())])
    if (done(records)) break
    if (Date.now() > deadline) break
    await sleep(3000)
  }

  const diagnose = () => {
    console.log('DIAGNOSTIC records:', JSON.stringify(records))
    console.log('DIAGNOSTIC scene logs:\n' + String(sceneLogText).split('\n').slice(-40).join('\n'))
  }

  // 8. boot: start() ran, which means the import resolved and every module-scope
  // registration in the closure survived the engine's seal.
  const boot = of(records, 'boot')
  if (boot.length === 0) {
    diagnose()
    fail('boot', 'the script never reported start() — the scene did not run it')
  }
  pass('boot', `start() ran on ${boot.length} cop${boot.length === 1 ? 'y' : 'ies'} (server: ${boot.map((r) => r.server).join(', ')})`)

  const clock = of(records, 'clock')[0]
  if (clock) pass('clock', `game.now() answered ${clock.now}`)
  else skip('clock', 'the shared clock never answered — no game replied to the sync exchange')

  // 9. the ask. Reachable ONLY against a Multiplayer Server: the green handler
  // lives on the copy running in the game, and local preview has no such copy.
  const requireServer = process.env.GAME_PROBE_REQUIRE_SERVER === '1'
  const trip = of(records, 'round-trip')[0]
  const green = of(records, 'green')[0]
  if (!trip && !requireServer) {
    const failed = of(records, 'ask-failed')[0]
    if (!failed) {
      diagnose()
      fail('boot', 'the ask neither resolved nor rejected — game.send never settled')
    }
    skip(
      'round-trip',
      `no Multiplayer Server in local preview — sdk-commands start serves the scene to a client only, so isServer() is false and no green handler exists. The ask rejected as it must: ${failed.error}. Deploy to a world and re-run with GAME_PROBE_REQUIRE_SERVER=1.`
    )
    console.log('GAME MODULE CONFIRMED (generation, build and boot; the round trip needs a Multiplayer Server)')
    cleanup()
    process.exit(0)
  }
  if (!trip) {
    diagnose()
    fail('round-trip', 'the ask never came back from the game — the handler was not armed, or rpc did not reach it')
  }
  if (trip.pong !== 7) fail('round-trip', `the game replied ${JSON.stringify(trip.pong)}, not the 7 the screen asked with`)
  if (!green) fail('round-trip', 'a reply came back but no copy reported running the handler — the reply did not come from the game')
  if (green.server !== true) fail('round-trip', 'the handler ran on a screen, not in the game')
  pass('round-trip', `game.send('probeAsk', { n: 7 }) → the game's handler (player ${green.player}) → { pong: 7 }`)

  console.log('GAME MODULE CONFIRMED')
  cleanup()
  process.exit(0)
}

main().catch((e) => {
  console.error('probe failed:', e.message)
  keepScratch = true
  console.error('scratch kept for inspection:', scratch)
  cleanup()
  process.exit(2)
})
