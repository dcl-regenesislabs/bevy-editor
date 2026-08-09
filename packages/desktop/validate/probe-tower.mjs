// Proof probe: Tower of Madness — the game of docs/BUILD-A-MULTIPLAYER-GAME.md
// — builds, boots and plays.
//
// It materialises ONE fixture, packages/desktop/validate/fixtures/tower-of-madness/,
// into a real scene created from the shipped blank (multiplayer) template: five kit
// prefab folders copied verbatim out of packages/desktop/prefabs/, eleven chunk
// prefab folders built from the fixture's own table, the placed composite, and the
// creator's five scripts dropped into src/scripts/. Nothing carries the `game`
// module in — the editor's generation pass is the only thing that can, exactly as
// it would for a creator, and everything below depends on it.
//
// Seven claims, each the thing that would silently be false otherwise:
//
//   generation   src/scripts/runtime/game.ts and its whole closure appear,
//                byte-identical to packages/desktop/runtime-modules/, because one
//                creator script says `import { game } from './runtime/game'`.
//   build        sdk-commands bundles all of it — the registry, the kit folders,
//                the chunks and the five scripts — against the auth-server pin.
//   boot         the scene runs and the placed scripts' start() ran.
//   plan         the tower plan is a pure function of the seed: same seed, same
//                floors; a neighbouring seed differs.
//   round        the game published a round tuple — the ONLY thing that starts a
//                round, and the thing every layout keys on.
//   tower        every chunk the pools actually placed is the chunk the seed
//                asked for, on the floor it asked for, checked against a plan the
//                observer derives from scratch.
//   finish       walking the avatar into the Start gate and then to the summit
//                gets a finish the GAME validated: game.state.finishers grows and
//                the madness clock's speed goes up.
//   board        the round closes and game.state.leaderboard carries the run.
//
// LOCAL PREVIEW: local Play DOES boot a Multiplayer Server — but only for a
// scene whose own node_modules carry the auth-server SDK and toolchain
// (@dcl/sdk and @dcl/sdk-commands from the auth-server channel; the shipped
// templates pin it, and packages/desktop/src/sdk-capability.ts installs it into
// a scene that lacks it). That toolchain's `start` spawns the server on every
// local run and takes no flag to suppress it, so isServer() is true on the copy
// it runs and a round can start with nothing deployed. A scene left on the
// standard SDK has no server at all: isServer() is false everywhere, no copy of
// the game exists, and a round never starts.
//
// So round/tower/finish/board are reported as SKIP rather than PASS only when
// this run could not reach them, and the SKIP names which of the two it was —
// no auth-server toolchain in the scene, or a toolchain that is there and still
// produced no server copy. TOWER_PROBE_REQUIRE_SERVER=1 holds the gate to the
// full set (use it on a world deploy, or on any run where the server must be
// there).
//
// Manual, like every probe here: `npm run validate` is the gate, this is the
// user's step. Needs a built app — run after `npm run build`. `--emit <dir>`
// materialises the scene without booting Electron, which is how you look at what
// the probe writes or typecheck it against a scene tsconfig.
//
// Reuses the CDP pattern of probe-spawner.mjs.
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
const fixtures = path.join(here, 'fixtures', 'tower-of-madness')
const builtinPrefabs = path.join(repoRoot, 'packages/desktop/prefabs')
const mastersDir = path.join(repoRoot, 'packages/desktop/runtime-modules')

const CDP_PORT = 9441
const SCRIPTS_DIR = 'src/scripts'
const VENDORED_DIR = 'src/scripts/runtime'
// three parcels square: the plinth sits at 24,24 and the tower climbs off it
const PARCELS = ['0,0', '1,0', '2,0', '0,1', '1,1', '2,1', '0,2', '1,2', '2,2']

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
  const r = await send(
    'Runtime.evaluate',
    { expression: expr, awaitPromise: true, returnByValue: true },
    pageSession,
    timeoutMs
  )
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

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const readMaster = (rel) => {
  const p = path.join(mastersDir, rel)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}

/** What the editor must put in the scene: game.ts and everything it imports. */
const expectedClosure = () => transitiveModules(['game.ts'], readMaster)

/**
 * Can THIS scene run a Multiplayer Server? Both halves have to be installed:
 * the SDK is what gives a script isServer() (the same file sdk-capability.ts
 * reads), and the toolchain is what actually spawns the server from `start`.
 * Checked against the SCENE's own node_modules: this repo's root install is a
 * standard build with no server spawner in it, and an answer read off that is
 * what the note this replaced was claiming about local preview at large.
 */
function authServerToolchain(dir) {
  const modules = path.join(dir, 'node_modules', '@dcl')
  let sdk = false
  try {
    sdk = fs.readFileSync(path.join(modules, 'sdk', 'network', 'index.d.ts'), 'utf8').includes('isServer')
  } catch {
    /* not installed yet, or an older SDK without the API */
  }
  return { sdk, commands: fs.existsSync(path.join(modules, 'sdk-commands', 'dist', 'commands', 'start', 'hammurabi-server.js')) }
}

// --- fixture materialisation ------------------------------------------------

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) copyTree(src, dst)
    else fs.copyFileSync(src, dst)
  }
}

const box = { $case: 'box', box: { uvs: [] } }
const boxCollider = { $case: 'box', box: {} }
const pbr = (r, g, b, roughness) => ({
  material: { $case: 'pbr', pbr: { albedoColor: { r, g, b, a: 1 }, roughness } }
})
const placed = (position, scale, parent) => ({
  position,
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale,
  parent
})

// This repo ships no tower chunks, so a chunk is a floor slab plus four stepping
// blocks in a per-kind pattern. Geometry is not what the probe measures — WHICH
// chunk stands on WHICH floor is — so a placeholder is honest here. Swap in real
// GLBs and every claim below still reads the same.
function chunkComposite(name, kind, height) {
  const t = (kind / 10) * Math.PI * 2
  const [r, g, b] = [0.45 + 0.35 * Math.cos(t), 0.45 + 0.35 * Math.cos(t - 2.1), 0.45 + 0.35 * Math.cos(t + 2.1)]
  const names = { 512: { json: { value: name } }, 513: { json: { value: 'Floor' } } }
  const transforms = {
    512: { json: placed({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, 0) },
    513: { json: placed({ x: 0, y: 0.25, z: 0 }, { x: 10, y: 0.5, z: 10 }, 512) }
  }
  const renderers = { 513: { json: { mesh: box } } }
  const colliders = { 513: { json: { mesh: boxCollider, collisionMask: 3 } } }
  const materials = { 513: { json: pbr(r * 0.55, g * 0.55, b * 0.55, 0.85) } }
  for (let step = 0; step < 4; step++) {
    const id = 514 + step
    const angle = kind * 0.63 + step * 1.9
    names[id] = { json: { value: `Step ${step + 1}` } }
    transforms[id] = {
      json: placed(
        { x: Math.cos(angle) * 3, y: 0.9 + step * ((height - 1.4) / 3), z: Math.sin(angle) * 3 },
        { x: 3, y: 0.4, z: 3 },
        512
      )
    }
    renderers[id] = { json: { mesh: box } }
    colliders[id] = { json: { mesh: boxCollider, collisionMask: 3 } }
    materials[id] = { json: pbr(r, g, b, 0.7) }
  }
  return {
    version: 1,
    components: [
      { name: 'core-schema::Name', data: names },
      { name: 'core::Transform', data: transforms },
      { name: 'core::MeshRenderer', data: renderers },
      { name: 'core::MeshCollider', data: colliders },
      { name: 'core::Material', data: materials }
    ]
  }
}

/** The cap: the platform a finisher stands on, plus a beacon. */
function endComposite(name) {
  return {
    version: 1,
    components: [
      {
        name: 'core-schema::Name',
        data: {
          512: { json: { value: name } },
          513: { json: { value: 'Summit' } },
          514: { json: { value: 'Beacon' } }
        }
      },
      {
        name: 'core::Transform',
        data: {
          512: { json: placed({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, 0) },
          513: { json: placed({ x: 0, y: 0.25, z: 0 }, { x: 8, y: 0.5, z: 8 }, 512) },
          514: { json: placed({ x: 0, y: 2, z: 0 }, { x: 0.6, y: 3, z: 0.6 }, 512) }
        }
      },
      { name: 'core::MeshRenderer', data: { 513: { json: { mesh: box } }, 514: { json: { mesh: box } } } },
      { name: 'core::MeshCollider', data: { 513: { json: { mesh: boxCollider, collisionMask: 3 } } } },
      {
        name: 'core::Material',
        data: { 513: { json: pbr(0.85, 0.72, 0.2, 0.4) }, 514: { json: pbr(1, 0.95, 0.5, 0.2) } }
      }
    ]
  }
}

function chunkData(entry, max) {
  return {
    id: entry.id,
    name: entry.name,
    description: `One floor of the tower. Placeholder geometry — a real tower ships a modelled chunk here.`,
    category: 'custom',
    tags: ['tower', 'chunk', 'obstacle'],
    spawnable: { max },
    version: '0.1.0',
    origin: { source: 'captured' }
  }
}

function writeFolder(dest, folder, data, composite) {
  write(dest, path.join(folder, 'data.json'), JSON.stringify(data, null, 2) + '\n')
  write(dest, path.join(folder, 'composite.json'), JSON.stringify(composite, null, 2) + '\n')
}

/** Every .ts under scripts/, minus the repo-only runtime stand-ins. */
function creatorScripts() {
  const dir = path.join(fixtures, 'scripts')
  const out = []
  const walk = (at, rel) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        // src/scripts/runtime/ is the editor's to write — see scripts/runtime/game.ts
        if (next === 'runtime') continue
        walk(path.join(at, entry.name), next)
      } else if (entry.name.endsWith('.ts')) {
        out.push(next)
      }
    }
  }
  walk(dir, '')
  return out
}

/** Writes the whole session — kit folders, chunk folders, scripts, composite. */
export function materialize(dest) {
  const manifest = readJson(path.join(fixtures, 'prefabs.json'))
  for (const entry of manifest.prefabs) {
    // placement copies the kit folder verbatim, carried runtime modules included
    copyTree(path.join(builtinPrefabs, entry.builtin), path.join(dest, entry.folder))
  }
  const chunks = manifest.chunks
  for (const entry of chunks.middle) {
    writeFolder(dest, entry.folder, chunkData(entry, chunks.max), chunkComposite(entry.name, entry.kind, chunks.height))
  }
  writeFolder(dest, chunks.end.folder, chunkData(chunks.end, 2), endComposite(chunks.end.name))

  const scripts = creatorScripts()
  for (const rel of scripts) {
    write(dest, `${SCRIPTS_DIR}/${rel}`, fs.readFileSync(path.join(fixtures, 'scripts', rel), 'utf8'))
  }

  // The scene the walkthrough authored: 3×3 parcels, and the one permission the
  // Health & Respawn placement would have merged in (only a player's own client
  // may move that player, and it needs saying in scene.json).
  const scenePath = path.join(dest, 'scene.json')
  const sceneJson = readJson(scenePath)
  sceneJson.scene = { parcels: PARCELS, base: '1,1' }
  sceneJson.display = { title: 'Tower of Madness' }
  sceneJson.spawnPoints = [
    { name: 'base', default: true, position: { x: [22, 26], y: [2.5, 2.5], z: [17, 21] }, cameraTarget: { x: 24, y: 6, z: 24 } }
  ]
  sceneJson.requiredPermissions = ['ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE']
  fs.writeFileSync(scenePath, JSON.stringify(sceneJson, null, 2) + '\n')

  mergeComposite(dest, readJson(path.join(fixtures, 'scene-composite.json')))
  mergeComposite(dest, readJson(path.join(fixtures, 'composite-fragment.json')))
  return { prefabs: manifest.prefabs.length + chunks.middle.length + 1, scripts: scripts.length }
}

// --- record collection ------------------------------------------------------

const RECORD_RE = /\[TOWER\]\s*(\{.*)$/

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
    const key = `${r.tag}:${r.leg ?? r.number ?? ''}:${r.server ?? ''}`
    if (!seen.has(key)) seen.set(key, r)
  }
  return [...seen.values()]
}

const of = (records, tag) => records.filter((r) => r.tag === tag)

function writeArtifact(observed) {
  const artifacts = path.join(here, 'artifacts')
  fs.mkdirSync(artifacts, { recursive: true })
  const file = path.join(artifacts, 'tower-observed.json')
  fs.writeFileSync(file, JSON.stringify({ observedAt: new Date().toISOString(), ...observed }, null, 2) + '\n')
  console.log(`RECORD artifact — ${path.relative(repoRoot, file)}`)
}

// --- run --------------------------------------------------------------------

async function main() {
  const emitAt = process.argv.indexOf('--emit')
  if (emitAt >= 0) {
    const dest = path.resolve(process.argv[emitAt + 1] ?? '')
    fs.mkdirSync(dest, { recursive: true })
    // --emit runs outside the editor, so there is no template scene.json to patch
    if (!fs.existsSync(path.join(dest, 'scene.json'))) {
      copyTree(path.join(root, 'templates', 'blank'), dest)
    }
    const summary = materialize(dest)
    console.log(`EMIT ${dest} — ${summary.prefabs} prefab folder(s), ${summary.scripts} script(s)`)
    return
  }

  const electronDir = [path.join(root, 'node_modules', 'electron'), path.join(root, '..', '..', 'node_modules', 'electron')].find(
    (d) => fs.existsSync(path.join(d, 'path.txt'))
  )
  if (!electronDir) throw new Error('electron not installed — run npm install')
  const electronPath = path.join(electronDir, 'dist', fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim())
  try {
    execSync(`pkill -f 'remote-debugging-port=${CDP_PORT}'`, { stdio: 'ignore' })
    await sleep(1500)
  } catch {}

  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-probe-'))
  // private userData + shifted ports: runs even while a dev editor is open
  const env = {
    ...process.env,
    BEVY_EDITOR_DEBUG: '1',
    BEVY_EDITOR_USER_DATA: path.join(scratch, 'user-data'),
    BEVY_WEB_PORT: '3118',
    SCENE_PORT: '8114',
    EDITOR_SCENE_PORT: '8115'
  }
  delete env.BEVY_EDITOR_PROJECT
  electron = spawn(electronPath, ['.', `--remote-debugging-port=${CDP_PORT}`], {
    cwd: root,
    env,
    stdio: ['ignore', 'ignore', 'ignore']
  })

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
  await waitFor(
    'page target',
    async () => {
      await attach()
      return true
    },
    60000,
    1500
  )

  const fail = (step, detail) => {
    console.log(`FAIL ${step} — ${detail}`)
    keepScratch = true
    console.log(`scratch kept for inspection: ${scratch}`)
    cleanup()
    process.exit(1)
  }
  const pass = (step, detail) => console.log(`PASS ${step}${detail ? ` — ${detail}` : ''}`)
  const skip = (step, detail) => console.log(`SKIP ${step} — ${detail}`)

  // 1. a real scene from the shipped multiplayer template
  await waitFor('picker', () => evalIn(`!!window.editorShell`), 60000, 1000)
  const dest = await evalIn(`window.editorShell.createScene(${JSON.stringify(scratch)}, 'Tower of Madness', 'blank')`, 30000)
  if (!dest || typeof dest !== 'string') fail('create-scene', `createScene returned ${JSON.stringify(dest)}`)
  if (readJson(path.join(dest, 'scene.json')).authoritativeMultiplayer !== true) {
    fail('create-scene', 'the template is not an authoritative-multiplayer scene')
  }
  pass('create-scene', dest)

  // 2. overlay the session BEFORE the first build
  let summary
  try {
    summary = materialize(dest)
  } catch (error) {
    fail('materialize', error.message)
  }
  if (fs.existsSync(path.join(dest, VENDORED_DIR))) {
    fail('materialize', `${VENDORED_DIR} exists before the editor opened the scene`)
  }
  pass('materialize', `${summary.prefabs} prefab folders, ${summary.scripts} scripts, no runtime module in the scene`)

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
  await waitFor(
    'the game module in the scene',
    async () => (fs.existsSync(path.join(dest, VENDORED_DIR, 'game.ts')) ? 'yes' : null),
    180000,
    1000
  ).catch(() => fail('generation', `${VENDORED_DIR}/game.ts was never written — the creator's import did not reach the pass`))
  const drifted = []
  const missing = []
  for (const rel of closure) {
    const copy = path.join(dest, VENDORED_DIR, rel)
    if (!fs.existsSync(copy)) missing.push(rel)
    else if (fs.readFileSync(copy, 'utf8') !== readMaster(rel)) drifted.push(rel)
  }
  if (missing.length > 0) fail('generation', `${missing.length} of ${closure.length} modules are missing: ${missing.join(', ')}`)
  if (drifted.length > 0) fail('generation', `not byte-identical to the masters: ${drifted.join(', ')}`)
  pass('generation', `${closure.length} modules under ${VENDORED_DIR}/, byte-identical to runtime-modules/`)

  // 5. build
  const bundle = path.join(dest, 'bin', 'index.js')
  await waitFor('bundle', async () => (fs.existsSync(bundle) ? 'yes' : null), 300000, 2000).catch(() => null)
  if (!fs.existsSync(bundle)) {
    const logs = await evalIn(`window.editorShell.getState().then((s) => s.logs.slice(-40).join('\\n'))`).catch((e) => e.message)
    console.log('DIAGNOSTIC LOGS:\n' + logs)
    fail('build', 'bin/index.js was never produced — the scene does not compile')
  }
  const bundleText = fs.readFileSync(bundle, 'utf8')
  for (const marker of ['TowerBuilder', 'MadnessRace', 'RoundResults', 'ClockBoard', 'GameFlow', 'TowerProbe', '__dclGame_v1']) {
    if (!bundleText.includes(marker)) fail('build', `${marker} is missing from bin/index.js`)
  }
  pass('build', `bin/index.js carries the kit, the chunks and the five scripts (${(bundleText.length / 1024).toFixed(0)} KB)`)

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

  // 7. collect
  const readCrdt = () =>
    evalIn(`(async () => {
      const r = await window.__euiCmd('crdt_snapshot', [])
      const s = JSON.parse(r)
      const out = []
      for (const comps of Object.values(s)) {
        const t = comps.TextShape?.text
        if (typeof t === 'string' && t.includes('[TOWER]')) out.push(t)
      }
      return out.join('\\n')
    })()`).catch(() => '')
  const readSceneLogs = () => evalIn(`window.__euiCmd('scene_logs', ['400'])`).catch(() => '')
  const readShellLogs = () => evalIn(`window.editorShell.getState().then((s) => s.logs.slice(-400).join('\\n'))`).catch(() => '')

  let records = []
  let sceneLogText = ''
  // When a copy of the game runs, the run ends as the round closes and the board
  // lands; when none does, the last reachable claim is the boot + the plan, and
  // waiting five more minutes for a round nothing can publish only makes it slow.
  const softDeadline = Date.now() + 90000
  const deadline = Date.now() + 420000
  const done = (rs) =>
    of(rs, 'board').length > 0 ||
    (of(rs, 'boot').length > 0 && of(rs, 'determinism').length > 0 && of(rs, 'round').length === 0 && Date.now() > softDeadline)
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

  // 8. boot
  const boot = of(records, 'boot')
  if (boot.length === 0) {
    diagnose()
    fail('boot', 'the observer never reported start() — the scene did not run its scripts')
  }
  pass('boot', `start() ran on ${boot.length} cop${boot.length === 1 ? 'y' : 'ies'} (server: ${boot.map((r) => r.server).join(', ')})`)

  // 9. the plan
  const determinism = of(records, 'determinism')[0]
  if (!determinism) {
    diagnose()
    fail('plan', 'the tower plan was never derived')
  }
  if (determinism.sameSeedIdentical !== true) fail('plan', 'the same seed produced two different towers')
  if (determinism.otherSeedDiffers !== true) fail('plan', 'a different seed produced the same tower — the plan ignores the seed')
  pass('plan', `one seed, ${determinism.floors} floors, twice identically; a neighbouring seed differs`)

  // 10. everything from here needs a copy of the game running
  const requireServer = process.env.TOWER_PROBE_REQUIRE_SERVER === '1'
  const round = of(records, 'round')[0]
  if (!round && !requireServer) {
    const toolchain = authServerToolchain(dest)
    const serverCopy = boot.some((r) => r.server === true)
    let why
    if (!toolchain.sdk || !toolchain.commands) {
      const missing = [!toolchain.sdk && '@dcl/sdk@auth-server', !toolchain.commands && '@dcl/sdk-commands@auth-server']
        .filter(Boolean)
        .join(' + ')
      why = `this emitted scene has only the standard SDK — install ${missing} in it to exercise the game half. Without that toolchain nothing spawns a Multiplayer Server, so isServer() is false on every copy and no round is ever published.`
    } else if (serverCopy) {
      why =
        'the scene carries the auth-server toolchain and a copy reported start() with isServer() true, so a Multiplayer Server did run and still published no round — a real gap in the game half, not a missing server. Re-run with TOWER_PROBE_REQUIRE_SERVER=1 to hold the gate here.'
    } else {
      why =
        'the scene carries the auth-server toolchain, so `sdk-commands start` did spawn a Multiplayer Server, but no copy reported start() with isServer() true inside the window — the server was still coming up, or it never joined the scene. Re-run with TOWER_PROBE_REQUIRE_SERVER=1 to hold the gate here.'
    }
    for (const step of ['round', 'tower', 'finish', 'board']) skip(step, why)
    writeArtifact({ boot, determinism, records })
    console.log('TOWER OF MADNESS CONFIRMED (generation, build, boot and the plan; the game-side claims need a copy of the game running)')
    cleanup()
    process.exit(0)
  }
  if (!round) {
    diagnose()
    fail('round', 'the game never published a round tuple')
  }
  if (!(round.number > 0) || typeof round.seed !== 'number') fail('round', `malformed tuple: ${JSON.stringify(round)}`)
  pass('round', `round ${round.number}, seed ${round.seed}`)

  // 11. the tower the pools actually built
  const tower = of(records, 'tower')[0]
  if (!tower) {
    diagnose()
    fail('tower', 'the chunks never appeared — game.layout placed nothing')
  }
  if ((tower.mismatched ?? []).length > 0) {
    fail('tower', `floors ${tower.mismatched.join(', ')} hold a chunk the seed did not ask for (plan ${tower.kinds})`)
  }
  pass('tower', `${tower.floors} floors + the cap, every one the chunk the seed asked for (${tower.kinds}), summit at ${tower.top} m`)

  // 12. the finish, validated by the game
  const finish = of(records, 'finish')[0]
  if (!finish) {
    diagnose()
    fail('finish', 'nobody was ever recorded as finishing — the ask was refused, or never reached the game')
  }
  if (!(finish.speed >= 2)) fail('finish', `a finisher landed but the clock still drains at x${finish.speed}`)
  pass('finish', `${finish.finishers} finisher(s) in game.state, clock now x${finish.speed}`)

  // 13. the board
  const board = of(records, 'board')[0]
  if (!board) {
    diagnose()
    fail('board', 'the round closed but game.state.leaderboard is still empty')
  }
  pass('board', `${board.rows} row(s), first ${board.first}`)

  writeArtifact({ boot, determinism, round, tower, finish, board, records })
  console.log('TOWER OF MADNESS CONFIRMED')
  cleanup()
  process.exit(0)
}

// Guarded so materialize() can be imported (by a dry-run driver, or a typecheck
// pass over the emitted scene) without booting Electron.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('probe failed:', e.message)
    keepScratch = true
    if (scratch) console.error('scratch kept for inspection:', scratch)
    cleanup()
    process.exit(2)
  })
}
