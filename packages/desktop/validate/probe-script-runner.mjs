// Proof probe: the SDK's script runner and our clone runner agree.
//
// The scene the editor builds dispatches a Script two ways. A PLACED entity's
// script is constructed by @dcl/sdk-commands/dist/logic/runtime-script.js; a
// CLONE's script is constructed by packages/desktop/runtime-modules/spawner.ts,
// a shadow copy of that file's runScripts(). Divergence between them is a silent
// gameplay bug — the same prefab behaving differently placed than spawned — and
// never a build error, so it needs a running scene to catch.
//
// This probe puts ONE fixture script through BOTH paths inside ONE scene and
// diffs the records field for field: `src`, every param value, the synthesised
// 'action' callback's observable effect, and callScriptMethod() reachability.
//
// It also carries the standing fingerprint gate: the sha256 of the scene's own
// installed runtime-script.js against validate/runner-fingerprint.json. That
// file's `notes` says what to do on a mismatch — the answer is never "update the
// hash".
//
// Ordering (impl-plan D2) is RECORDED, not asserted — the probe's job is to
// report what the runner actually did on this pin, not to bake in a belief. Two
// things the last verified run observed, both counter-intuitive:
//   start()  — priority 0 ran BEFORE priority -100 ('0' is an integer-index key
//              and JS enumerates those before the string key '-100').
//   update() — priority -100 ticked LAST, not first: @dcl/ecs sorts systems
//              `b.priority - a.priority`, so a lower number runs later.
// spawnables.ts publishes its snapshot table at module scope precisely so that
// nothing depends on either answer.
//
// Reuses the validate.mjs / probe-server-clock.mjs CDP pattern.
// Needs a built app: run after `npm run build`.
import { spawn, execSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { transitiveModules } from '../../../scripts/sync-runtime-modules.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const repoRoot = path.resolve(here, '../../..')
const fixtures = path.join(here, 'fixtures', 'runner-contract')
const mastersDir = path.join(repoRoot, 'packages/desktop/runtime-modules')

const CDP_PORT = 9434
const PLACED_ENTITY = 512
const SCRIPT_PATH = 'src/scripts/contract-probe.ts'
const PREFAB_ID = '5f0d2c31-8a44-4f2b-9c07-6d1e3a90b7c2'
const PING_ARG = 41

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
  if (scratch && !keepScratch) fs.rmSync(scratch, { recursive: true, force: true })
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

// --- fixture overlay -------------------------------------------------------

export function write(dest, rel, text) {
  const target = path.join(dest, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text)
}

// Merge the fixture composite into the scene's main.composite (the blank
// template ships none, so this normally creates it). Components merge by name,
// entity data by id, fixture wins.
export function mergeComposite(dest, fragment) {
  const rel = 'assets/scene/main.composite'
  const target = path.join(dest, rel)
  const base = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : { version: 1, components: [] }
  const byName = new Map((base.components ?? []).map((c) => [c.name, c]))
  for (const comp of fragment.components) {
    const existing = byName.get(comp.name)
    if (existing === undefined) byName.set(comp.name, JSON.parse(JSON.stringify(comp)))
    else existing.data = { ...existing.data, ...comp.data }
  }
  write(dest, rel, JSON.stringify({ version: 1, components: [...byName.values()] }))
}

// Carry spawner.ts and everything it imports into the scene, byte-identical to
// the masters — the same rule a placed prefab's scripts/runtime/ copies follow.
export function carryRuntimeModules(dest) {
  const read = (rel) => {
    const p = path.join(mastersDir, rel)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  }
  if (read('spawner.ts') === null) {
    return { modules: [], missing: 'packages/desktop/runtime-modules/spawner.ts does not exist (WP-A2 not landed)' }
  }
  const modules = transitiveModules(['spawner.ts'], read)
  for (const rel of modules) write(dest, path.join('src/scripts/runtime', rel), read(rel))
  return { modules, missing: null }
}

// The editor's generated src/scripts/spawnables.ts, hand-rendered to impl-plan
// §3.3: snapshot table published at MODULE SCOPE, exactly one function-valued
// export, and the clone's script spec carrying the SAME layout string as the
// placed entity's composite row — which is what makes the diff meaningful.
export function renderSpawnables(layout) {
  return `// GENERATED by packages/desktop/validate/probe-script-runner.mjs.
import { type Entity } from '@dcl/sdk/ecs'
import { registerSpawnables, pool, type PrefabSnapshot } from './runtime/spawner'
import * as script_src_scripts_contract_probe from './contract-probe'

export type PrefabRef = string & { readonly __prefabRef: unique symbol }

export const Spawnables = {
  ContractProbe: '${PREFAB_ID}' as unknown as PrefabRef
} as const

const SNAPSHOTS: PrefabSnapshot[] = [
  {
    prefab: '${PREFAB_ID}',
    alias: 'ContractProbe',
    max: 4,
    entities: [
      {
        localId: 0,
        parent: null,
        components: [
          {
            name: 'core::Transform',
            json: {
              position: { x: 10, y: 1, z: 8 },
              scale: { x: 1, y: 1, z: 1 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              parent: 0
            }
          }
        ]
      }
    ],
    scripts: [
      {
        localId: 0,
        path: ${JSON.stringify(SCRIPT_PATH)},
        priority: 0,
        layout: ${JSON.stringify(layout)},
        module: script_src_scripts_contract_probe
      }
    ]
  }
]

registerSpawnables(SNAPSHOTS)

interface ProbeShared {
  order: number
  updateOrder: number
  clone: number | null
  publish: (record: Record<string, unknown>) => void
}

function shared(): ProbeShared | null {
  return (globalThis as unknown as { __RUNNER_PROBE__?: ProbeShared }).__RUNNER_PROBE__ ?? null
}

export class SpawnableRegistry {
  private ticked = false

  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start(): void {
    const probe = shared()
    if (probe !== null) {
      probe.publish({ tag: 'registry-start', src: this.src, entity: Number(this.entity), order: ++probe.order })
    }
    try {
      const clones = pool(Spawnables.ContractProbe, 'seeded')
      const clone = clones.acquire()
      if (probe !== null) {
        probe.clone = clone === null ? null : Number(clone)
        probe.publish({ tag: 'registry-acquire', clone: probe.clone, alive: clones.alive().length })
      }
    } catch (error) {
      probe?.publish({ tag: 'registry-error', error: String(error) })
    }
  }

  update(_dt: number): void {
    if (this.ticked) return
    this.ticked = true
    const probe = shared()
    if (probe === null) return
    probe.publish({ tag: 'registry-update', entity: Number(this.entity), order: ++probe.updateOrder })
  }
}
`
}

// The entrypoint is the one place '~sdk/script-utils' can be imported without a
// cycle (the virtual module imports the SCRIPTS, never the entrypoint), so the
// callScriptMethod reachability check lives here — it must reach the clone
// through the REAL runner's helper, not through our own registry.
export function renderIndex() {
  return `// GENERATED by packages/desktop/validate/probe-script-runner.mjs.
import { engine } from '@dcl/sdk/ecs'
import { callScriptMethod } from '~sdk/script-utils'

interface ProbeShared {
  clone: number | null
  publish: (record: Record<string, unknown>) => void
}

function call(entity: number): string {
  try {
    return String(callScriptMethod(entity as never, ${JSON.stringify(SCRIPT_PATH)}, 'ping', ${PING_ARG}))
  } catch (error) {
    return \`threw: \${String(error)}\`
  }
}

export function main(): void {
  let done = false
  engine.addSystem(() => {
    if (done) return
    const probe = (globalThis as unknown as { __RUNNER_PROBE__?: ProbeShared }).__RUNNER_PROBE__
    if (probe === undefined || probe.clone === null) return
    done = true
    probe.publish({
      tag: 'callScriptMethod',
      placed: { entity: ${PLACED_ENTITY}, result: call(${PLACED_ENTITY}) },
      clone: { entity: probe.clone, result: call(probe.clone) }
    })
  })
}
`
}

// --- record collection -----------------------------------------------------

const RECORD_RE = /\[RUNNER-CONTRACT\]\s*(\{.*)$/

function parseRecords(text) {
  const out = []
  for (const line of String(text ?? '').split('\n')) {
    const m = RECORD_RE.exec(line)
    if (!m) continue
    try {
      out.push(JSON.parse(m[1]))
    } catch {
      /* a truncated ring-buffer line — the CRDT channel carries the same record */
    }
  }
  return out
}

// First record per (tag, entity) wins: a scene rebuild replays the whole set
// with the counters reset, and mixing two runs would corrupt the ordering.
function dedupe(records) {
  const seen = new Map()
  for (const r of records) {
    const key = `${r.tag}:${r.entity ?? r.clone?.entity ?? ''}`
    if (!seen.has(key)) seen.set(key, r)
  }
  return [...seen.values()]
}

function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (typeof a !== 'object') return false
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false
  return ka.every((k) => deepEqual(a[k], b[k]))
}

function fieldDiff(a, b) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort()
  return keys
    .filter((k) => !deepEqual(a?.[k], b?.[k]))
    .map((k) => `${k}: placed=${JSON.stringify(a?.[k])} clone=${JSON.stringify(b?.[k])}`)
}

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

  const fingerprint = JSON.parse(fs.readFileSync(path.join(here, 'runner-fingerprint.json'), 'utf8'))
  const fragment = JSON.parse(fs.readFileSync(path.join(fixtures, 'composite-fragment.json'), 'utf8'))
  const probeSource = fs.readFileSync(path.join(fixtures, 'contract-probe.ts'), 'utf8')
  const scriptRow = fragment.components
    .find((c) => c.name === 'asset-packs::Script')
    .data[String(PLACED_ENTITY)].json.value.find((v) => v.path === SCRIPT_PATH)
  const layout = scriptRow.layout

  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-probe-'))
  const env = {
    ...process.env,
    BEVY_EDITOR_DEBUG: '1',
    BEVY_EDITOR_USER_DATA: path.join(scratch, 'user-data'),
    BEVY_WEB_PORT: '3111',
    SCENE_PORT: '8106',
    EDITOR_SCENE_PORT: '8107'
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
  const record = (what, detail) => console.log(`RECORD ${what} — ${detail}`)

  // 1. create a scene from the blank template through the real shell API
  await waitFor('picker', () => evalIn(`!!window.editorShell`), 60000, 1000)
  const dest = await evalIn(`window.editorShell.createScene(${JSON.stringify(scratch)}, 'Runner Contract', 'blank')`, 30000)
  if (!dest || typeof dest !== 'string') fail('create-scene', `createScene returned ${JSON.stringify(dest)}`)
  pass('create-scene', dest)

  // 2a. fingerprint gate, part one: the pin, before the six-minute install
  const scenePkg = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'))
  const pin = scenePkg.devDependencies?.['@dcl/sdk-commands'] ?? '(absent)'
  if (pin !== fingerprint.pin) {
    fail(
      'runner-fingerprint',
      `the SDK script runner changed; re-verify packages/desktop/runtime-modules/spawner.ts against it, then update this file — packages/desktop/validate/runner-fingerprint.json pins ${fingerprint.pin}, the scene template installs ${pin}`
    )
  }
  pass('runner-fingerprint-pin', pin)

  // 3. overlay the fixture BEFORE the first build, so sdk-commands bundles it
  write(dest, SCRIPT_PATH, probeSource)
  write(dest, 'src/scripts/spawnables.ts', renderSpawnables(layout))
  write(dest, 'src/index.ts', renderIndex())
  const carried = carryRuntimeModules(dest)
  if (carried.missing !== null) fail('carry-runtime-modules', carried.missing)
  mergeComposite(dest, fragment)
  pass('overlay', `${carried.modules.length} runtime module(s) carried, composite merged (placed ${PLACED_ENTITY} @0, registry entity 0 @-100)`)

  // 4. open — npm install + sdk-commands start build the overlaid scene
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
    360000,
    5000
  )
  pass('open', 'editor ready on the overlaid scene')

  // 2b. fingerprint gate, part two: the installed runner's bytes
  const runnerFile = path.join(dest, fingerprint.file)
  if (!fs.existsSync(runnerFile)) fail('runner-fingerprint', `${fingerprint.file} not found in the installed scene`)
  const observedSha = sha256(runnerFile)
  if (observedSha !== fingerprint.sha256) {
    fail(
      'runner-fingerprint',
      `the SDK script runner changed; re-verify packages/desktop/runtime-modules/spawner.ts against it, then update this file — expected ${fingerprint.sha256}, got ${observedSha}`
    )
  }
  pass('runner-fingerprint', `${fingerprint.file} sha256 ${observedSha.slice(0, 16)}… matches ${fingerprint.pin}`)

  // 5. the scene is frozen in edit mode — scripts only run in Play
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

  // 6. collect. The CRDT TextShape is a single-run set and is preferred; the log
  // ring is the fallback and the diagnostic dump.
  const readCrdt = () =>
    evalIn(`(async () => {
      const r = await window.__euiCmd('crdt_snapshot', [])
      const s = JSON.parse(r)
      const out = []
      for (const comps of Object.values(s)) {
        const t = comps.TextShape?.text
        if (typeof t === 'string' && t.includes('[RUNNER-CONTRACT]')) out.push(t)
      }
      return out.join('\\n')
    })()`).catch(() => '')
  const readLogs = () => evalIn(`window.__euiCmd('scene_logs', ['300'])`).catch(() => '')

  let records = []
  let logText = ''
  const complete = (rs) =>
    rs.filter((r) => r.tag === 'start').length >= 2 && rs.some((r) => r.tag === 'callScriptMethod') && rs.filter((r) => r.tag === 'update').length >= 2
  const deadline = Date.now() + 150000
  for (;;) {
    const crdt = await readCrdt()
    logText = await readLogs()
    const fromCrdt = dedupe(parseRecords(crdt))
    records = fromCrdt.filter((r) => r.tag === 'start').length >= 2 ? fromCrdt : dedupe([...fromCrdt, ...parseRecords(logText)])
    if (complete(records)) break
    if (Date.now() > deadline) break
    await sleep(2000)
  }

  const starts = records.filter((r) => r.tag === 'start')
  if (starts.length < 2) {
    console.log('DIAGNOSTIC records:', JSON.stringify(records))
    console.log('DIAGNOSTIC scene logs:\n' + String(logText).split('\n').slice(-40).join('\n'))
    fail('dispatch', `expected 2 start records (placed + clone), got ${starts.length}`)
  }
  const placed = starts.find((r) => r.entity === PLACED_ENTITY)
  const clone = starts.find((r) => r.entity !== PLACED_ENTITY)
  if (!placed) fail('dispatch', `no start record for the placed entity ${PLACED_ENTITY}`)
  if (!clone) fail('dispatch', 'no start record for a cloned entity — the spawner never constructed the script')
  pass('dispatch', `placed entity ${placed.entity} (SDK runner) and clone entity ${clone.entity} (spawner) both ran start()`)

  if (!records.some((r) => r.tag === 'registry-start')) {
    fail('entity-0-script', 'the entity-0 registry script at priority -100 never started — spawnables.ts installation is broken')
  }
  pass('entity-0-script', 'the priority -100 registry script on entity 0 ran')

  // 7. field-for-field parity
  if (placed.src !== clone.src) fail('parity-src', `placed src=${JSON.stringify(placed.src)} clone src=${JSON.stringify(clone.src)}`)
  if (placed.src !== 'src/scripts') fail('parity-src', `src is the script's DIRECTORY; expected 'src/scripts', got ${JSON.stringify(placed.src)}`)
  if (placed.path !== clone.path) fail('parity-path', `placed=${placed.path} clone=${clone.path}`)
  pass('parity-src', `both constructed with src=${JSON.stringify(placed.src)}, path=${JSON.stringify(placed.path)}`)

  const diff = fieldDiff(placed.params, clone.params)
  if (diff.length > 0) fail('parity-params', diff.join(' | '))
  if (placed.params.onHit !== 'function') fail('parity-action', `the 'action' param was not turned into a callback: ${JSON.stringify(placed.params.onHit)}`)
  if (placed.params.onHitEmits !== 1 || clone.params.onHitEmits !== 1) {
    fail('parity-action', `calling the action callback must emit exactly once on both paths — placed=${placed.params.onHitEmits} clone=${clone.params.onHitEmits}`)
  }
  if (placed.params.onHitError !== '' || clone.params.onHitError !== '') {
    fail('parity-action', `action callback threw — placed=${JSON.stringify(placed.params.onHitError)} clone=${JSON.stringify(clone.params.onHitError)}`)
  }
  pass('parity-params', `all ${Object.keys(placed.params).length} param fields identical (number, boolean, string, entity, enum, action, PrefabRef, PrefabRef[])`)

  const reach = records.find((r) => r.tag === 'callScriptMethod')
  if (!reach) fail('call-script-method', 'the entrypoint never resolved a clone to call — spawner did not publish one')
  const expected = `pong:contract:${PING_ARG}`
  if (reach.placed.result !== expected) fail('call-script-method', `placed path: expected ${expected}, got ${JSON.stringify(reach.placed.result)}`)
  if (reach.clone.result !== expected) {
    fail('call-script-method', `the SDK's own callScriptMethod cannot reach the clone's @action method: expected ${expected}, got ${JSON.stringify(reach.clone.result)}`)
  }
  pass('call-script-method', `callScriptMethod reaches the @action method identically on both paths (${JSON.stringify(expected)})`)

  // 8. ordering — recorded, never asserted (impl-plan D2)
  const startOrder = records
    .filter((r) => typeof r.order === 'number' && (r.tag === 'start' || r.tag === 'registry-start'))
    .sort((a, b) => a.order - b.order)
    .map((r) => `${r.tag === 'registry-start' ? 'registry(priority -100)' : `script(priority 0, entity ${r.entity})`}#${r.order}`)
  const updateOrder = records
    .filter((r) => typeof r.order === 'number' && (r.tag === 'update' || r.tag === 'registry-update'))
    .sort((a, b) => a.order - b.order)
    .map((r) => `${r.tag === 'registry-update' ? 'registry(priority -100)' : `script(priority 0, entity ${r.entity})`}#${r.order}`)
  record('start-order', startOrder.join(' → ') || '(none)')
  record('update-order', updateOrder.join(' → ') || '(none)')
  const placedStartedFirst = startOrder.length >= 2 && startOrder[0].startsWith('script(priority 0')
  record(
    'D2',
    placedStartedFirst
      ? "priority 0 start() ran BEFORE priority -100 start() — matches D2: '0' is an integer-index key, '-100' a string key"
      : "priority -100 start() ran first on this pin — D2's rationale no longer holds; nothing breaks (spawnables.ts registers at module scope), but re-read decision D2 before relying on either order"
  )
  const registryUpdatedLast = updateOrder.length >= 2 && updateOrder[updateOrder.length - 1].startsWith('registry(')
  record(
    'D2-update',
    registryUpdatedLast
      ? 'the priority -100 update system ticked LAST, not first — @dcl/ecs sorts systems `b.priority - a.priority` (descending, default SYSTEMS_REGULAR_PRIORITY 100000), so a LOWER priority number runs LATER. Priority -100 buys "after everything", not "before everything".'
      : 'the priority -100 update system ticked before the priority 0 ones on this pin — the engine sorted systems ascending, the opposite of what the last verified run observed; re-read @dcl/ecs engine/systems.js before relying on update order'
  )

  const artifacts = path.join(here, 'artifacts')
  fs.mkdirSync(artifacts, { recursive: true })
  fs.writeFileSync(
    path.join(artifacts, 'runner-contract-observed.json'),
    JSON.stringify(
      { pin: fingerprint.pin, sha256: observedSha, observedAt: new Date().toISOString(), startOrder, updateOrder, records },
      null,
      2
    ) + '\n'
  )
  console.log(`RECORD artifact — ${path.relative(repoRoot, path.join(artifacts, 'runner-contract-observed.json'))}`)

  console.log('RUNNER CONTRACT CONFIRMED')
  cleanup()
  process.exit(0)
}

// Guarded so the overlay helpers above can be imported (by a dry-run driver, or
// by probe-zombie-arena) without booting Electron — same pattern as
// scripts/sync-runtime-modules.mjs.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('probe failed:', e.message)
    keepScratch = true
    if (scratch) console.error('scratch kept for inspection:', scratch)
    cleanup()
    process.exit(2)
  })
}
