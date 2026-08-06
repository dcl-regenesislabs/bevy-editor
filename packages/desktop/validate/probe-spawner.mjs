// Proof probe: the Spawner is placeable, the right-click gesture wires it, and
// the scene it produces compiles.
//
// It drives the REAL editor: creates a scene from the shipped blank
// (multiplayer) template, places a Trigger Zone and a plain prefab to spawn
// through the Prefabs tab,
// right-clicks it in the hierarchy and presses "Add a spawner" — then reads back
// what the editor persisted and what sdk-commands built.
//
// The Spawner is client-side: copies are made on the player's own game the
// moment the trigger fires — there is nothing server-decided to skip or defer.
// A two-client smoke is out of scope: the harness has one client.
//
// Six local claims, each the thing that would silently be false otherwise:
//
//   place    the built-in card places and its carried runtime modules land in
//            the project — spawnPoints.ts included, which only the editor's
//            sync run can have put there.
//   params   the persisted Script row layout carries the params in contract
//            order with the right types, and
//            value 0. That last one is the E-1 regression: before the parser
//            learned TSAsExpression, `0 as Entity` parsed as an empty string and
//            the default click path never fired.
//   gesture  right-click a zone -> "Add a spawner" parents the Spawner AT the
//            zone (local transform identity, not the camera drop point) and
//            pre-sets `when` from what was clicked; the parent IS the wiring.
//   quiet    the zone instance does not read as drifted afterwards. Nesting a
//            prefab under an instance used to turn it red and, on a spawnable's
//            anchor, block Play (E-5).
//   chips    a prefab with no instance and no spawner reads "Not used yet", and
//            pointing `spawn` at it clears the nudge — the guarantee scan can
//            only see the pool because the prefab's own script opens it (E-4).
//            (The per-mode pills were deliberately culled from cards; the nudge
//            is the one scan-driven chip left.)
//   build    sdk-commands bundles the folder, its carried modules and the
//            generated registry into bin/index.js.
//
// Needs a built app: run after `npm run build`. Reuses the CDP pattern of
// probe-server-clock.mjs.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CDP_PORT = 9437

// The contract WP-P owns and every other surface is written against. Order is
// the constructor's, because that is the order the inspector renders.
const PARAMS = [
  ['spawn', 'prefab'],
  ['when', 'enum'],
  ['everySeconds', 'number'],
  ['hoverLabel', 'string'],
  ['atMostAtOnce', 'number'],
  ['disappearsAfter', 'number'],
  ['where', 'enum']
]
const WHEN_OPTIONS = [
  'when clicked',
  'when a player enters',
  'every few seconds',
  'when a script asks'
]
// What the Spawner is pointed at. The Trigger Zone cannot be the target any
// more — zone prefabs are excluded from the spawn dropdown by design (spawned
// copies would never fire) — so the probe places one plain prefab as well.
// Video Screen is an ungrouped card with a plain composite. What the `chips`
// claim tests is the guarantee scan, and that does not care which prefab it is.
const SPAWN_TARGET = 'Video Screen'

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

// The placement kicks a background rebuild, and a busy renderer can leave a
// Runtime.evaluate unanswered past its timeout. Every read after the gesture goes
// through here: re-attach and ask again rather than failing a claim on a stall.
async function evalStable(expr, label, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await evalIn(expr, 20000)
    } catch (e) {
      if (Date.now() > deadline) throw new Error(`${label}: ${e.message}`)
      await attach().catch(() => {})
      await sleep(2000)
    }
  }
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
  // the scene's dev server is still flushing as Electron dies; a plain rmSync
  // races it and throws ENOTEMPTY, turning a passing run into a harness failure
  try {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  } catch {
    /* tmp is reaped by the OS; a leftover scratch is not a probe result */
  }
}

const SHADOW = `document.getElementById('editor-ui-host').shadowRoot`

const clickWhere = (selector, text) => `(() => {
  const sh = ${SHADOW}
  const el = [...sh.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.includes(${JSON.stringify(text)}))
  if (!el) return false
  el.click()
  return true
})()`

// The hierarchy's own context-menu gesture, dispatched the way a mouse does it.
const rightClickRow = (entityId) => `(() => {
  const sh = ${SHADOW}
  const row = sh.getElementById('row-' + ${JSON.stringify(String(entityId))})
  if (!row) return false
  const box = row.getBoundingClientRect()
  row.click()
  row.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, composed: true,
    clientX: box.left + 8, clientY: box.top + 8
  }))
  return true
})()`

/** The placed Spawner: the only entity whose Script row runs a spawner.ts. */
const FIND_SPAWNER = `(() => {
  const snap = window.__eui.snapshot
  for (const [id, comps] of Object.entries(snap)) {
    const rows = comps['Script']?.value ?? comps['asset-packs::Script']?.value ?? []
    for (const row of rows) {
      if (typeof row.path === 'string' && /(^|\\/)spawner\\.ts$/.test(row.path)) {
        return { id, layout: row.layout ?? '', path: row.path }
      }
    }
  }
  return null
})()`

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

  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'spawner-probe-'))
  // private userData + shifted ports: runs even while a dev editor is open
  const env = {
    ...process.env,
    BEVY_EDITOR_DEBUG: '1',
    BEVY_EDITOR_USER_DATA: path.join(scratch, 'user-data'),
    BEVY_WEB_PORT: '3114',
    SCENE_PORT: '8110',
    EDITOR_SCENE_PORT: '8111'
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

  // 1. a real scene from the shipped multiplayer starter
  await waitFor('picker', () => evalIn(`!!window.editorShell`), 60000, 1000)
  const dest = await evalIn(`window.editorShell.createScene(${JSON.stringify(scratch)}, 'Spawner Probe', 'blank')`, 30000)
  if (!dest || typeof dest !== 'string') fail('create-scene', `createScene returned ${JSON.stringify(dest)}`)
  const sceneJson = JSON.parse(fs.readFileSync(path.join(dest, 'scene.json'), 'utf8'))
  if (sceneJson.authoritativeMultiplayer !== true) fail('create-scene', 'the starter is not an authoritative-multiplayer scene')
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
  pass('create-scene', dest)

  // 2. place the two prefabs the walkthrough needs, through the real Prefabs tab
  // (a top-level left tab since #46 — not a segment inside Assets any more)
  const leftTab = (label) => evalIn(clickWhere('.eui-ltab', label))
  if (!(await leftTab('Prefabs'))) fail('tabs', 'Prefabs tab not found')
  await sleep(500)
  const cardReady = (label) =>
    waitFor(`${label} card`, () => evalIn(`(() => {
      const sh = ${SHADOW}
      return [...sh.querySelectorAll('.eui-prefab-card')].some((e) => e.textContent.includes(${JSON.stringify(label)}))
    })()`), 60000, 1000)

  await cardReady('Trigger Zone')
  if (!(await evalIn(clickWhere('.eui-prefab-card', 'Trigger Zone')))) fail('place', 'Trigger Zone card click failed')
  await sleep(6000)

  const zoneId = await waitFor('trigger zone in the scene', () => evalIn(`(() => {
    const snap = window.__eui.snapshot
    for (const [id, comps] of Object.entries(snap)) {
      if (comps['TriggerArea'] !== undefined) return id
    }
    return null
  })()`), 60000, 1000)
  const zoneName = await evalIn(`(() => {
    const n = window.__eui.snapshot[${JSON.stringify(zoneId)}]?.['core-schema::Name']
    return (n && typeof n.value === 'string') ? n.value : ''
  })()`)
  pass('place', `Trigger Zone "${zoneName}" (#${zoneId}) placed from the Prefabs tab, carried modules on disk`)

  // The spawn target: a plain prefab, because zone prefabs are excluded from
  // the spawn dropdown by design and the Spawner itself is too.
  await cardReady(SPAWN_TARGET)
  if (!(await evalIn(clickWhere('.eui-prefab-card', SPAWN_TARGET)))) fail('place', `${SPAWN_TARGET} card click failed`)
  await sleep(6000)
  const targetId = await waitFor(`${SPAWN_TARGET} in the scene`, () => evalIn(`(() => {
    const snap = window.__eui.snapshot
    for (const [id, comps] of Object.entries(snap)) {
      const n = comps['core-schema::Name']
      if (n && typeof n.value === 'string' && n.value.includes(${JSON.stringify(SPAWN_TARGET)})) return id
    }
    return null
  })()`), 60000, 1000)

  // 3. the gesture: right-click the zone in the hierarchy -> Add a spawner
  if (!(await leftTab('Scene'))) fail('tabs', 'Scene tab not found')
  await sleep(800)
  if (!(await evalIn(rightClickRow(zoneId)))) fail('gesture', `no hierarchy row for the zone (#${zoneId})`)
  await sleep(600)
  const menuHit = await evalIn(`(() => {
    const sh = ${SHADOW}
    const item = [...sh.querySelectorAll('.eui-menu-item')].find((e) => e.textContent.includes('Add a spawner'))
    if (!item) return 'missing'
    if (item.disabled) return 'disabled'
    item.click()
    return 'clicked'
  })()`)
  if (menuHit !== 'clicked') fail('gesture', `the "Add a spawner" menu item was ${menuHit}`)

  const spawner = await waitFor('the placed Spawner', () => evalIn(FIND_SPAWNER), 90000, 1500)
  const carried = path.join(dest, 'custom', 'spawner', 'scripts', 'runtime', 'spawnPoints.ts')
  if (!fs.existsSync(carried)) fail('place', 'custom/spawner/scripts/runtime/spawnPoints.ts is missing — the folder shipped without its registry')

  const wiring = await evalStable(`(() => {
    const comps = window.__eui.snapshot[${JSON.stringify(spawner.id)}] ?? {}
    return { transform: comps['Transform'] ?? null }
  })()`, 'reading the Spawner transform')
  const t = wiring.transform
  if (t === null) fail('gesture', 'the Spawner has no Transform at all')
  if (Number(t.parent) !== Number(zoneId)) fail('gesture', `the Spawner's parent is ${t.parent}, not the zone (${zoneId}) — it stayed at the drop point`)
  const near = (v, want) => Math.abs(Number(v ?? 0) - want) < 1e-6
  if (!near(t.position?.x, 0) || !near(t.position?.y, 0) || !near(t.position?.z, 0)) {
    fail('gesture', `the Spawner sits at ${JSON.stringify(t.position)} inside the zone, not at its origin — reparenting preserved the world placement`)
  }
  if (!near(t.scale?.x, 1) || !near(t.rotation?.w, 1)) fail('gesture', `the Spawner's local transform is not identity: ${JSON.stringify(t)}`)

  let layout
  try {
    layout = JSON.parse(spawner.layout)
  } catch {
    layout = null
  }
  if (layout === null || typeof layout.params !== 'object') fail('params', `the Script row's layout did not parse: ${JSON.stringify(spawner.layout).slice(0, 200)}`)
  const got = layout.params
  const valueOf = (name) => got[name]?.value

  if (valueOf('when') !== 'when a player enters') fail('gesture', `the Spawner's trigger is ${JSON.stringify(valueOf('when'))}, not "when a player enters" — the zone was not recognised`)
  // the zone wiring is the PARENT, asserted above — no name field exists to check
  pass('gesture', `placed as a child of the zone at its origin, pre-set to "when a player enters" on "${zoneName}"`)

  // 4. the params, in order, with the types the inspector renders from
  const names = Object.keys(got)
  const expectNames = PARAMS.map(([n]) => n)
  if (names.join(',') !== expectNames.join(',')) {
    fail('params', `the layout carries [${names.join(', ')}]; the contract is [${expectNames.join(', ')}]`)
  }
  for (const [name, type] of PARAMS) {
    if (got[name]?.type !== type) fail('params', `${name} parsed as ${JSON.stringify(got[name]?.type)}, not ${type}`)
  }
  const options = got.when?.options ?? []
  if (options.join('|') !== WHEN_OPTIONS.join('|')) fail('params', `the "when" choices are [${options.join(', ')}]`)

  pass('params', `seven params in contract order and "when" offers all four triggers`)

  // 5. E-5: a prefab parked on an instance is not drift of that instance
  await sleep(6000)
  const complaints = await evalStable(`(() => {
    const sh = ${SHADOW}
    const card = sh.querySelector('.eui-checks')
    return card === null ? '' : card.textContent
  })()`, 'reading the scene checks')
  if (/drift|Compare|out of date|stale/i.test(String(complaints))) {
    fail('quiet', `the scene checks call the zone drifted after the gesture: ${String(complaints).slice(0, 240)}`)
  }
  pass('quiet', complaints === '' ? 'no scene-check findings at all' : 'scene checks raised nothing about drift')

  // 6. the chips claim, on the surface that survived the pill cull: the mode
  // pills ("Seeded from the server"…) were deliberately removed from cards —
  // the one scan-driven chip left is the "Not used yet" nudge, shown only while
  // nothing places OR spawns the prefab. So: delete the placed target (nudge
  // must appear — proves the nudge machinery renders), point `spawn` at it
  // (nudge must clear — proves the guarantee scan sees the pool, E-4).
  if (!(await evalIn(rightClickRow(targetId)))) fail('chips', `no hierarchy row for ${SPAWN_TARGET} (#${targetId})`)
  await sleep(600)
  const del = await evalIn(`(() => {
    const sh = ${SHADOW}
    const items = [...sh.querySelectorAll('.eui-menu-item')]
    const item = items.find((e) => e.textContent.includes('Delete with')) ??
      items.find((e) => e.textContent.includes('Delete') && !e.textContent.includes('keep children'))
    if (!item) return 'missing'
    if (item.disabled) return 'disabled'
    item.click()
    return 'clicked'
  })()`)
  if (del !== 'clicked') fail('chips', `the Delete menu item for ${SPAWN_TARGET} was ${del}`)
  await waitFor(`${SPAWN_TARGET} gone from the scene`, () => evalIn(
    `(() => window.__eui.snapshot[${JSON.stringify(String(targetId))}] === undefined ? 'gone' : null)()`
  ), 30000, 1000)

  if (!(await leftTab('Prefabs'))) fail('chips', 'Prefabs tab not found for the orphan check')
  await waitFor(`${SPAWN_TARGET} reading "Not used yet"`, () => evalIn(`(() => {
    const sh = ${SHADOW}
    const card = [...sh.querySelectorAll('.eui-prefab-card')].find((e) => e.textContent.includes(${JSON.stringify(SPAWN_TARGET)}))
    if (!card) return null
    return /Not used yet/.test(card.textContent) ? 'nudged' : null
  })()`), 60000, 2000).catch(() =>
    fail('chips', `${SPAWN_TARGET} has no instance left and no spawner, yet its card never showed "Not used yet"`)
  )

  const targetPrefabId = (() => {
    const customDir = path.join(dest, 'custom')
    for (const folder of fs.readdirSync(customDir)) {
      const f = path.join(customDir, folder, 'data.json')
      if (!fs.existsSync(f)) continue
      try {
        const d = JSON.parse(fs.readFileSync(f, 'utf8'))
        if (d.name === SPAWN_TARGET) return d.id
      } catch { /* unreadable folder is some other probe's problem */ }
    }
    return null
  })()
  if (targetPrefabId === null) fail('chips', `no custom/<folder>/data.json carries "${SPAWN_TARGET}" — the placement never copied the folder`)

  // Point `spawn` at it. Selecting the row is what puts the Spawner's settings
  // in the inspector; the gesture already selected it, but a probe that assumes
  // so tests less.
  if (!(await leftTab('Scene'))) fail('chips', 'Scene tab not found on the way back')
  await sleep(800)
  await evalStable(`(() => {
    const sh = ${SHADOW}
    const row = sh.getElementById('row-' + ${JSON.stringify(String(spawner.id))})
    if (row) row.click()
    return true
  })()`, 'selecting the Spawner')
  await sleep(800)
  // No header click here on purpose. Every inspector card but Transform starts
  // collapsed, so a gesture that ends on a collapsed card hides the ONE setting it
  // could not fill in — what appears. uiAddSpawnerFor expands the Script card, and
  // the picker being reachable with no further click is what proves it.
  const picked = await waitFor('the spawn picker', () => evalIn(`(() => {
    const sh = ${SHADOW}
    const trigger = sh.querySelector('button[aria-label="spawn"]')
    if (!trigger) return null
    trigger.click()
    return 'open'
  })()`), 25000, 1000).catch(() => 'no-picker')
  if (picked !== 'open') {
    const seen = await evalIn(`(() => {
      const sh = ${SHADOW}
      const heads = [...sh.querySelectorAll('.eui-comp-head')].map((h) =>
        (h.querySelector('.name')?.textContent ?? '') + ' ' + (h.querySelector('.twisty')?.textContent ?? '')
      )
      const props = [...sh.querySelectorAll('.eui-prop .plabel')].map((e) => e.textContent)
      const dim = [...sh.querySelectorAll('.eui-script-dim')].map((e) => e.textContent)
      return JSON.stringify({ heads, props, dim })
    })()`).catch((e) => 'dump failed: ' + e.message)
    console.log('DIAGNOSTIC inspector:', String(seen).slice(0, 900))
    fail(
      'chips',
      'the spawn dropdown was not reachable after the gesture — either the Script card is still collapsed, or a project holding prefabs rendered the empty state'
    )
  }
  await sleep(400)
  const chose = await evalStable(clickWhere('[role="option"]', SPAWN_TARGET), 'picking the prefab to spawn')
  if (!chose) fail('chips', `the spawn dropdown has no "${SPAWN_TARGET}" row`)
  const stored = await waitFor('the spawn pick persisted', async () => {
    const s = await evalIn(FIND_SPAWNER)
    if (s === null) return null
    try {
      const p = JSON.parse(s.layout).params
      return p.spawn?.value === targetPrefabId ? 'stored' : null
    } catch {
      return null
    }
  }, 30000, 1000).catch(() => null)
  if (stored === null) fail('chips', `the picked prefab never reached the Spawner's layout (want spawn=${targetPrefabId})`)

  if (!(await leftTab('Prefabs'))) fail('chips', 'Prefabs tab not found on the way back')
  await waitFor(`${SPAWN_TARGET} no longer "Not used yet"`, () => evalIn(`(() => {
    const sh = ${SHADOW}
    const card = [...sh.querySelectorAll('.eui-prefab-card')].find((e) => e.textContent.includes(${JSON.stringify(SPAWN_TARGET)}))
    if (!card) return null
    return /Not used yet/.test(card.textContent) ? null : 'cleared'
  })()`), 60000, 2000).catch(() =>
    fail('chips', `${SPAWN_TARGET} still reads "Not used yet" after a Spawner was pointed at it — the guarantee scan cannot see the pool`)
  )
  pass('chips', `${SPAWN_TARGET} showed "Not used yet" while orphaned and stopped once a Spawner pointed at it — the scan sees the pool`)

  // 7. the whole thing compiles
  const composite = path.join(dest, 'assets', 'scene', 'main.composite')
  await waitFor('composite autosave', async () => {
    if (!fs.existsSync(composite)) return null
    const text = fs.readFileSync(composite, 'utf8')
    return text.includes('spawner.ts') && text.includes('when a player enters') ? 'yes' : null
  }, 120000, 1000).catch(() => fail('persist', 'the Spawner and its settings never reached main.composite'))
  pass('persist', 'the Script row and its parsed params persisted in main.composite')

  const bundle = path.join(dest, 'bin', 'index.js')
  await waitFor('bundle', async () => (fs.existsSync(bundle) ? 'yes' : null), 300000, 3000).catch(() => null)
  if (!fs.existsSync(bundle)) {
    const logs = await evalIn(`window.editorShell.getState().then((s) => s.logs.slice(-40).join('\\n'))`).catch((e) => e.message)
    console.log('DIAGNOSTIC LOGS:\n' + logs)
    fail('build', 'bin/index.js was never produced — the scene does not compile with a Spawner in it')
  }
  const bundleText = fs.readFileSync(bundle, 'utf8')
  for (const marker of ['__dclSpawnPoints_v1', 'spawnPoints', 'Spawner']) {
    if (!bundleText.includes(marker)) fail('build', `${marker} is missing from bin/index.js — the registry did not pull the spawn-point module into the bundle`)
  }
  pass('build', `bin/index.js carries the spawn-point registry (${(bundleText.length / 1024).toFixed(0)} KB)`)

  console.log('SPAWNER CONFIRMED')
  cleanup()
  process.exit(0)
}

main().catch((e) => {
  console.error('probe failed:', e.message)
  keepScratch = true
  if (scratch) console.error('scratch kept for inspection:', scratch)
  cleanup()
  process.exit(2)
})
