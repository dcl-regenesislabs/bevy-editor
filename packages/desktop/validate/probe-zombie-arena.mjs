// Proof probe: the zombie arena of concept-final.md §2 builds, boots and plays.
//
// It materialises ONE fixture — packages/ui/src/prefabs/fixtures/zombie-arena/,
// the same one zombie-arena.test.ts golden-tests — into a real scene created from
// the shipped blank (multiplayer) template, opens it in the editor, presses Play,
// and reads back what the running game says about itself.
//
// LOCAL PREVIEW: local Play DOES boot a Multiplayer Server — but only for a
// scene whose own node_modules carry the auth-server SDK and toolchain
// (@dcl/sdk and @dcl/sdk-commands from the auth-server channel, which
// packages/desktop/src/sdk-capability.ts installs on first kit placement). That
// toolchain's `start` spawns the server on every local run and takes no flag to
// suppress it, so isServer() is true on the copy it runs. A scene left on the
// standard SDK has no server at all, and the server-authored claims
// (server-boot, ledger, rejoin) are unreachable there — they are reported as
// SKIP, not as PASS. Deploy the scene to a world and re-run with
// ARENA_PROBE_REQUIRE_SERVER=1 to hold the gate to the full set.
//
// Six claims, each the thing that would silently be false otherwise:
//
//   build          sdk-commands bundles the generated registry, the config
//                  accessor, four prefab folders and their carried modules.
//   server-boot    the Multiplayer Server ran the same bundle headless.
//   tuple          the Round Loop published {seed, phase, phaseStartMs,
//                  configVersion} and the config version is the authored one.
//   plan           two INDEPENDENT reconstructions of the wave plan from that
//                  tuple — the Wave Director's and the probe's — agree entry for
//                  entry, and a neighbouring seed does not.
//   ledger         a reported hit reaches the server's validator, is clamped to
//                  the config's damage, comes back as a broadcast entry, and the
//                  fourth one kills the clone. Nothing here is client-decided.
//   rejoin         a client holding only the tuple and the ledger history
//                  reconstructs the same alive-set, minus the corpse.
//
// The probe never reads a server log to decide anything: a validated outcome
// coming back over the wire is what proves the server side ran.
//
// Needs a built app: run after `npm run build`. `--emit <dir>` materialises the
// fixture scene without booting Electron, which is how you typecheck it or look
// at what the probe actually writes.
//
// Reuses the CDP pattern of probe-auth-server.mjs / probe-script-runner.mjs.
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
const fixtures = path.join(here, 'fixtures', 'zombie-arena')
const goldens = path.join(repoRoot, 'packages/ui/src/prefabs/fixtures/zombie-arena')
const builtinPrefabs = path.join(repoRoot, 'packages/desktop/prefabs')
const mastersDir = path.join(repoRoot, 'packages/desktop/runtime-modules')

const CDP_PORT = 9435
const PROBE_SCRIPT = 'src/scripts/arena-probe.ts'

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
  // The scene's dev server is still flushing into the scratch as Electron dies,
  // so a plain rmSync races it and throws ENOTEMPTY — which would turn a passing
  // run into a harness failure. Retry a little, then leave it to the OS.
  try {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  } catch {
    /* tmp is reaped by the OS; a leftover scratch is not a probe result */
  }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

// What the fixture's own Game Config says the run should look like. Derived
// rather than pinned: an edited table must move the expectation with it, or the
// probe would keep asserting numbers the scene no longer uses.
function expectations() {
  const value = readJson(path.join(goldens, 'game-config.json')).value
  const keyed = (table, key) => {
    const found = (value.tables ?? []).find((t) => t.name === table)
    const row = (found?.rows ?? []).find((r) => r.key === key)
    return Number(row?.cells?.[0] ?? Number.NaN)
  }
  const hp = keyed('zombie', 'hp')
  const damage = keyed('weapons', 'gunDamage')
  return { configVersion: Number(value.version), hp, damage, hitsToKill: Math.ceil(hp / damage) }
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

const readMaster = (rel) => {
  const p = path.join(mastersDir, rel)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}

// Byte-identical carriage, the same rule scripts/sync-runtime-modules.mjs applies
// to a prefab folder: an installing operation carries the modules it needs.
function carry(dest, entries, targetDir) {
  const modules = transitiveModules(entries, readMaster)
  for (const rel of modules) write(dest, path.join(targetDir, rel), readMaster(rel))
  return modules
}

/** Writes the whole walkthrough — prefab folders, generated files, composite. */
export function materialize(dest) {
  const manifest = readJson(path.join(goldens, 'prefabs.json'))
  const sceneScripts = readJson(path.join(goldens, 'scene-scripts.json')).scripts
  const carried = []

  for (const entry of manifest.prefabs) {
    if (entry.builtin !== undefined) {
      // placement copies the kit folder verbatim, carried modules included
      copyTree(path.join(builtinPrefabs, entry.builtin), path.join(dest, entry.folder))
      continue
    }
    write(dest, path.join(entry.folder, 'data.json'), JSON.stringify(entry.data, null, 2) + '\n')
    write(dest, path.join(entry.folder, 'composite.json'), JSON.stringify(entry.composite, null, 2) + '\n')
    for (const rel of entry.scripts ?? []) {
      const key = `${entry.folder}/${rel}`
      const text = sceneScripts[key]
      if (text === undefined) throw new Error(`scene-scripts.json has no text for ${key}`)
      write(dest, path.join(entry.folder, rel), text)
    }
    for (const asset of entry.assets ?? []) {
      const source = path.join(fixtures, asset)
      if (!fs.existsSync(source)) throw new Error(`fixture asset missing: ${path.relative(repoRoot, source)}`)
      fs.mkdirSync(path.dirname(path.join(dest, entry.folder, asset)), { recursive: true })
      fs.copyFileSync(source, path.join(dest, entry.folder, asset))
    }
    if ((entry.runtimeModules ?? []).length > 0) {
      carried.push(...carry(dest, entry.runtimeModules, path.join(entry.folder, 'scripts/runtime')))
    }
  }

  // The two committed generated files, byte-for-byte what the editor's own
  // renderers produce — zombie-arena.test.ts is what keeps them that way.
  write(dest, 'src/scripts/spawnables.ts', fs.readFileSync(path.join(goldens, 'spawnables.expected.txt'), 'utf8'))
  write(dest, 'src/scripts/game-config.ts', fs.readFileSync(path.join(goldens, 'game-config.expected.txt'), 'utf8'))
  // the registry's own dependency is the canonical copy, never a prefab folder's
  carried.push(...carry(dest, ['spawner.ts'], 'src/scripts/runtime'))
  write(dest, PROBE_SCRIPT, fs.readFileSync(path.join(fixtures, 'arena-probe.ts'), 'utf8'))

  // The registry now carries `import './game-config'` itself (codegen.ts), which
  // is what pulls the accessor into the bundle and publishes
  // __dclGameConfig_v1 — without it every kit prefab silently runs on its
  // hard-coded defaults. The `tuple` assertion below is the guard: it compares
  // the version the scene reports against the one the fixture authored, so this
  // regressing fails the probe rather than quietly changing the game's numbers.
  const registry = fs.readFileSync(path.join(dest, 'src/scripts/spawnables.ts'), 'utf8')
  if (!registry.includes("import './game-config'")) {
    throw new Error(
      "spawnables.expected.txt does not import './game-config' — the accessor would never enter the bundle"
    )
  }

  mergeComposite(dest, readJson(path.join(goldens, 'scene-composite.json')))
  mergeComposite(dest, readJson(path.join(fixtures, 'composite-fragment.json')))
  return { prefabs: manifest.prefabs.length, modules: [...new Set(carried)].length }
}

// --- record collection ------------------------------------------------------

function writeArtifact(observed) {
  const artifacts = path.join(here, 'artifacts')
  fs.mkdirSync(artifacts, { recursive: true })
  const file = path.join(artifacts, 'zombie-arena-observed.json')
  fs.writeFileSync(file, JSON.stringify({ observedAt: new Date().toISOString(), ...observed }, null, 2) + '\n')
  console.log(`RECORD artifact — ${path.relative(repoRoot, file)}`)
}

const RECORD_RE = /\[ZOMBIE-ARENA\]\s*(\{.*)$/

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
    const key = `${r.tag}:${r.seq ?? r.phase ?? ''}:${r.server ?? ''}`
    if (!seen.has(key)) seen.set(key, r)
  }
  return [...seen.values()]
}

const of = (records, tag) => records.filter((r) => r.tag === tag)

// --- run --------------------------------------------------------------------

async function main() {
  const emitAt = process.argv.indexOf('--emit')
  if (emitAt >= 0) {
    const dest = path.resolve(process.argv[emitAt + 1] ?? '')
    fs.mkdirSync(dest, { recursive: true })
    const summary = materialize(dest)
    console.log(`EMIT ${dest} — ${summary.prefabs} prefab folder(s), ${summary.modules} runtime module(s)`)
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

  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-probe-'))
  const env = {
    ...process.env,
    BEVY_EDITOR_DEBUG: '1',
    BEVY_EDITOR_USER_DATA: path.join(scratch, 'user-data'),
    BEVY_WEB_PORT: '3112',
    SCENE_PORT: '8108',
    EDITOR_SCENE_PORT: '8109'
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

  const expect = expectations()
  const fail = (step, detail) => {
    console.log(`FAIL ${step} — ${detail}`)
    keepScratch = true
    console.log(`scratch kept for inspection: ${scratch}`)
    cleanup()
    process.exit(1)
  }
  const pass = (step, detail) => console.log(`PASS ${step}${detail ? ` — ${detail}` : ''}`)
  const skip = (step, detail) => console.log(`SKIP ${step} — ${detail}`)
  const note = (what, detail) => console.log(`RECORD ${what} — ${detail}`)

  // 1. a real scene from the shipped multiplayer starter
  await waitFor('picker', () => evalIn(`!!window.editorShell`), 60000, 1000)
  const dest = await evalIn(`window.editorShell.createScene(${JSON.stringify(scratch)}, 'Zombie Arena', 'blank')`, 30000)
  if (!dest || typeof dest !== 'string') fail('create-scene', `createScene returned ${JSON.stringify(dest)}`)
  const sceneJson = readJson(path.join(dest, 'scene.json'))
  if (sceneJson.authoritativeMultiplayer !== true) fail('create-scene', 'the starter is not an authoritative-multiplayer scene')
  pass('create-scene', dest)

  // 2. overlay the walkthrough BEFORE the first build
  let summary
  try {
    summary = materialize(dest)
  } catch (error) {
    fail('materialize', error.message)
  }
  pass('materialize', `${summary.prefabs} prefab folders, ${summary.modules} carried runtime modules, composite merged`)

  // 3. open — npm install + sdk-commands build the overlaid scene
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
  const bundle = path.join(dest, 'bin', 'index.js')
  await waitFor('bundle', async () => (fs.existsSync(bundle) ? 'yes' : null), 180000, 2000).catch(() => null)
  if (!fs.existsSync(bundle)) {
    const logs = await evalIn(`window.editorShell.getState().then((s) => s.logs.slice(-40).join('\\n'))`).catch((e) => e.message)
    console.log('DIAGNOSTIC LOGS:\n' + logs)
    fail('build', 'bin/index.js was never produced — the fixture scene does not compile')
  }
  const bundleText = fs.readFileSync(bundle, 'utf8')
  for (const marker of ['ZombieBrain', 'WaveDirector', 'ArenaProbe']) {
    if (!bundleText.includes(marker)) fail('build', `${marker} is missing from bin/index.js — the registry did not pull it into the bundle`)
  }
  pass('build', `bin/index.js carries the registry's static imports (${(bundleText.length / 1024).toFixed(0)} KB)`)

  // 4. Play — scripts do not run in edit mode
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

  // 5. collect. The CRDT TextShape set is written once per record; the client log
  // ring and the editor's own log (which carries the server's console) fill in.
  const readCrdt = () =>
    evalIn(`(async () => {
      const r = await window.__euiCmd('crdt_snapshot', [])
      const s = JSON.parse(r)
      const out = []
      for (const comps of Object.values(s)) {
        const t = comps.TextShape?.text
        if (typeof t === 'string' && t.includes('[ZOMBIE-ARENA]')) out.push(t)
      }
      return out.join('\\n')
    })()`).catch(() => '')
  const readSceneLogs = () => evalIn(`window.__euiCmd('scene_logs', ['400'])`).catch(() => '')
  const readShellLogs = () =>
    evalIn(`window.editorShell.getState().then((s) => s.logs.slice(-400).join('\\n'))`).catch(() => '')

  let records = []
  let shellRecords = []
  let sceneLogText = ''
  // With a Multiplayer Server the run ends at the rejoin reconstruction; without
  // one (local preview — see arena-probe.ts's header) the last reachable claim is
  // the plan diff, and waiting five minutes for a ledger entry that can never
  // arrive just makes the gate slow.
  const done = (rs) =>
    of(rs, 'rejoin').length > 0 ||
    (of(rs, 'plan').some((r) => r.count > 0) &&
      of(rs, 'determinism').length > 0 &&
      of(rs, 'tuple').some((r) => r.serverTuple === false))
  const deadline = Date.now() + 300000
  for (;;) {
    const crdt = await readCrdt()
    sceneLogText = await readSceneLogs()
    const shellText = await readShellLogs()
    shellRecords = dedupe(parseRecords(shellText))
    records = dedupe([...parseRecords(crdt), ...parseRecords(sceneLogText)])
    if (done(records)) break
    if (Date.now() > deadline) break
    await sleep(3000)
  }

  const diagnose = () => {
    console.log('DIAGNOSTIC records:', JSON.stringify(records))
    console.log('DIAGNOSTIC scene logs:\n' + String(sceneLogText).split('\n').slice(-40).join('\n'))
  }

  // 6. server boot. The direct sighting is the server's own boot line in the
  // editor's log; the proof that cannot be faked is a validated outcome coming
  // back, which only the server can produce.
  const serverBoot = [...shellRecords, ...records].find((r) => r.tag === 'boot' && r.server === true)
  const clientBoot = records.find((r) => r.tag === 'boot' && r.server === false)
  if (!clientBoot) {
    diagnose()
    fail('server-boot', 'the probe script never started on the client — the scene did not run')
  }

  // 7. the tuple
  const tuple = of(records, 'tuple')[0]
  if (!tuple) {
    diagnose()
    fail('tuple', 'no {seed, phase, phaseStartMs, configVersion} was ever reconstructed — the scene never reached the Wave Director')
  }
  if (!(tuple.phaseStartMs > 0) || typeof tuple.seed !== 'number' || typeof tuple.phase !== 'number') {
    fail('tuple', `malformed tuple: ${JSON.stringify(tuple)}`)
  }
  if (tuple.configVersion !== expect.configVersion) {
    fail(
      'tuple',
      `the phase pinned config version ${tuple.configVersion}; the fixture's Game Config is version ${expect.configVersion} — the accessor never reached the bundle, so the kit is running on its defaults`
    )
  }
  const serverAuthored = tuple.serverTuple === true
  pass(
    'tuple',
    `seed ${tuple.seed}, phase ${tuple.phase}, config v${tuple.configVersion}, wave ${tuple.wave}` +
      (serverAuthored ? ' (published by the Round Loop server branch)' : ' (free-running: no Multiplayer Server answered this run)')
  )

  // 8. the plan — two independent reconstructions of the same four numbers
  const determinism = of(records, 'determinism')[0]
  if (!determinism) fail('plan', 'the probe never rebuilt the plan')
  if (determinism.sameSeedIdentical !== true) fail('plan', 'the same tuple produced two different spawn lists')
  if (determinism.otherSeedDiffers !== true) fail('plan', 'a different seed produced the same spawn list — the plan ignores the seed')
  const plan = of(records, 'plan').find((r) => r.count > 0)
  if (!plan) {
    diagnose()
    fail('plan', 'the plan was empty in every phase observed')
  }
  if (plan.compared !== plan.count || (plan.mismatched ?? []).length > 0) {
    fail(
      'plan',
      `the Wave Director and the probe disagree on ${plan.count - plan.compared + (plan.mismatched ?? []).length} of ${plan.count} entries (${JSON.stringify(plan.mismatched)})`
    )
  }
  pass('plan', `${plan.count} entries, reconstructed identically by both sides; another seed differs`)

  // 9. hit → ledger → died. A phase boundary can abandon one attempt and start
  // another, so the run that matters is the one belonging to the clone that died.
  //
  // Reachable ONLY against a Multiplayer Server. A scene carrying the auth-server
  // SDK and toolchain gets one on every local run; a scene left on the standard
  // SDK spawns nothing, so isServer() is false everywhere and outcomes() rides rpc
  // to a validator that does not exist. Deploy the scene to a world, or install the
  // auth-server packages in it, and re-run with ARENA_PROBE_REQUIRE_SERVER=1 to hold
  // the gate to the full set.
  const requireServer = process.env.ARENA_PROBE_REQUIRE_SERVER === '1'
  if (!serverAuthored && !requireServer) {
    const why =
      'no Multiplayer Server answered this run — the likeliest cause is that this emitted scene carries only the standard SDK, which spawns no server, so isServer() is false everywhere and the ledger has no validator. Install @dcl/sdk@auth-server and @dcl/sdk-commands@auth-server in the scene, or deploy to a world, and re-run with ARENA_PROBE_REQUIRE_SERVER=1.'
    skip('server-boot', why)
    skip('ledger', why)
    skip('rejoin', why)
    note('phase', `wave ${tuple.wave} of the waves table, ${plan.count} zombies planned, stride ${plan.stride}`)
    writeArtifact({ tuple, determinism, plan, records })
    console.log('ZOMBIE ARENA CONFIRMED (client-side claims; server-side claims skipped)')
    cleanup()
    process.exit(0)
  }
  const allHits = of(records, 'hit')
  if (allHits.length === 0) {
    diagnose()
    fail('ledger', 'no hit ever came back from the server — the validator was not armed, or rpc did not reach it')
  }
  const died = of(records, 'died')[0]
  if (!died) {
    diagnose()
    const last = allHits.sort((a, b) => a.seq - b.seq)[allHits.length - 1]
    fail('ledger', `the clone never reached zero after ${allHits.length} accepted hit(s) — last value ${last.value}`)
  }
  const hits = allHits.filter((h) => h.instanceId === died.instanceId).sort((a, b) => a.seq - b.seq)
  for (let i = 1; i < hits.length; i++) {
    if (hits[i].value >= hits[i - 1].value) {
      fail('ledger', `hit points did not fall: seq ${hits[i - 1].seq}=${hits[i - 1].value} then seq ${hits[i].seq}=${hits[i].value}`)
    }
  }
  if (hits[hits.length - 1].value !== 0) fail('ledger', `the death entry carried ${hits[hits.length - 1].value} hit points, not 0`)
  if (hits.length < expect.hitsToKill) {
    fail(
      'ledger',
      `${hits.length} accepted hit(s) emptied a ${expect.hp} hp clone; at the config's ${expect.damage} damage it takes ${expect.hitsToKill} — the server is taking the reporter's number instead of its own`
    )
  }
  pass(
    'ledger',
    `${hits.length} server-validated hits on a ${expect.hp} hp clone at ${expect.damage} damage: ${hits.map((h) => h.value).join('→')}, then died (instance ${died.instanceId})`
  )
  pass(
    'server-boot',
    serverBoot
      ? `the Multiplayer Server ran the same bundle (boot record, entity ${serverBoot.entity})`
      : 'inferred: only the server can produce a validated outcome, and it produced ' + hits.length
  )

  // 10. rejoin
  const rejoin = of(records, 'rejoin')[0]
  if (!rejoin) fail('rejoin', 'the alive-set was never reconstructed')
  if (rejoin.excludesTarget !== true) fail('rejoin', 'the reconstructed alive-set still contains the clone the ledger killed')
  if (!(rejoin.alive < rejoin.aliveIgnoringLedger)) {
    fail('rejoin', `fast-forwarding the ledger changed nothing: ${rejoin.alive} alive with it, ${rejoin.aliveIgnoringLedger} without`)
  }
  pass(
    'rejoin',
    `a joiner holding only the tuple + ${rejoin.ledgerEntries} ledger entries reconstructs ${rejoin.alive} alive of ${rejoin.planned} planned (${rejoin.aliveIgnoringLedger} before fast-forward)`
  )

  note('phase', `wave ${tuple.wave} of the waves table, ${plan.count} zombies planned, stride ${plan.stride}`)

  writeArtifact({ tuple, determinism, plan, hits, died, rejoin, records })

  console.log('ZOMBIE ARENA CONFIRMED')
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
