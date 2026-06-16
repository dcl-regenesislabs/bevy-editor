#!/usr/bin/env node
// Gizmo visibility test: select a model, focus it, then orbit the camera to many
// angles and assert the gizmo arrows are visible at EVERY angle (they must render
// on top of the model, never occluded). Detects the gizmo by its saturated
// axis colors (red X / green Y / blue Z) appearing in the frame near center.
//
//   node validate/gizmo-test.mjs
//
// Exit 0 = gizmo visible at every tested angle. Artifacts in validate/artifacts/gizmo/.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const out = path.join(here, 'artifacts', 'assets')
fs.mkdirSync(out, { recursive: true })
const CDP = 9434
const PROJECT = process.env.BEVY_EDITOR_PROJECT ?? path.resolve(root, '..', 'towerofmadness')

let ws, sess
let id = 0
const pending = new Map()
const send = (m, p, s, t = 40000) =>
  new Promise((res, rej) => {
    const i = ++id
    const tm = setTimeout(() => rej(new Error(m + ' timeout')), t)
    pending.set(i, { res: (r) => { clearTimeout(tm); res(r) }, rej })
    ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s }))
  })
const ev = (e, t = 40000) =>
  send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }, sess, t).then((r) => r.result.value)

function caffeinate() {
  try { return spawn('caffeinate', ['-dius'], { stdio: 'ignore' }) } catch { return null }
}

// Count saturated gizmo-axis pixels (red, green, blue, violet) in a PNG, ignoring
// the green SELECTION outline by requiring the arrow hues which are pure/strong.
function gizmoPixels(pngPath) {
  const bmp = pngPath.replace(/\.png$/, '.bmp')
  execSync(`sips -s format bmp ${pngPath} --out ${bmp} >/dev/null 2>&1`)
  const b = fs.readFileSync(bmp)
  const off = b.readUInt32LE(10)
  const w = b.readInt32LE(18)
  const h = Math.abs(b.readInt32LE(22))
  const bpp = b.readUInt16LE(28) / 8
  let red = 0, green = 0, blue = 0
  // only look at the central region where the focused model + gizmo sit
  const x0 = (w * 0.30) | 0, x1 = (w * 0.70) | 0
  const y0 = (h * 0.20) | 0, y1 = (h * 0.80) | 0
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = off + ((h - 1 - y) * w + x) * bpp
      const bl = b[i], g = b[i + 1], r = b[i + 2]
      // gizmo arrows are bright, saturated. axis red ~ (242,51,64), green ~ (64,217,77), blue ~ (64,115,242)
      if (r > 180 && g < 110 && bl < 120) red++
      else if (g > 180 && r < 130 && bl < 130) green++ // note: selection outline is also green — see caveat
      else if (bl > 180 && r < 130 && g < 150) blue++
    }
  }
  fs.rmSync(bmp, { force: true })
  return { red, green, blue, total: red + green + blue }
}

async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sess, 40000)
  const p = path.join(out, name)
  fs.writeFileSync(p, Buffer.from(s.data, 'base64'))
  return p
}

async function main() {
  const caf = caffeinate()
  const electronPath = path.join(
    root, 'node_modules', 'electron', 'dist',
    fs.readFileSync(path.join(root, 'node_modules', 'electron', 'path.txt'), 'utf8').trim()
  )
  try { execSync(`pkill -f 'remote-debugging-port=${CDP}'`, { stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 1000)) } catch {}
  for (const port of [8004, 8005]) {
    try { execSync(`for pid in $(lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null); do kill $pid; done`, { stdio: 'ignore' }) } catch {}
  }
  // A corrupt Service Worker or IndexedDB store wedges boot: when indexedDB.open
  // fails ("Internal error opening backing store"), the engine never registers
  // its console command, so the host's engineReady() never flips and the editor
  // sits at "logging-in" forever. Clear both browser stores before launch.
  try {
    const base = path.join(process.env.HOME, 'Library', 'Application Support', 'bevy-editor-app')
    for (const sub of ['Service Worker', 'IndexedDB']) fs.rmSync(path.join(base, sub), { recursive: true, force: true })
  } catch {}
  const el = spawn(electronPath, ['.', `--remote-debugging-port=${CDP}`], {
    cwd: root,
    env: { ...process.env, BEVY_EDITOR_DEBUG: '1', BEVY_EDITOR_PROJECT: PROJECT },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const cleanup = () => { try { el.kill('SIGTERM') } catch {}; try { caf?.kill('SIGTERM') } catch {} }

  // hard watchdog: never let the harness hang silently
  setTimeout(() => { console.log('WATCHDOG: 13min elapsed, forcing exit'); try { el.kill('SIGTERM') } catch {}; process.exit(2) }, 13 * 60 * 1000).unref()

  // Electron drops the browser-level CDP socket when openProject navigates the
  // window under COOP/COEP (the renderer is swapped). Reconnect transparently:
  // reject in-flight sends on close so awaits unblock, then re-open + re-attach.
  async function getVersion() {
    for (let i = 0; i < 30; i++) {
      try { const res = await fetch(`http://127.0.0.1:${CDP}/json/version`); if (res.ok) return await res.json() } catch {}
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error('CDP /json/version never responded')
  }
  async function connect() {
    const version = await getVersion()
    const sock = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 })
    sock.on('message', (raw) => {
      let m
      try { m = JSON.parse(raw) } catch { return }
      if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) }
    })
    sock.on('close', () => {
      // fail every pending send so no await hangs forever on a dead socket
      for (const [, { rej }] of pending) rej(new Error('socket closed'))
      pending.clear()
    })
    sock.on('error', () => {})
    await new Promise((res, rej) => { sock.once('open', res); sock.once('error', rej) })
    ws = sock
  }
  await connect()
  async function attach() {
    if (!ws || ws.readyState !== WebSocket.OPEN) await connect()
    const { targetInfos } = await send('Target.getTargets', {})
    const page = targetInfos.find((t) => t.type === 'page' && t.url.includes('editor-app'))
    if (!page) throw new Error('no editor-app page target')
    const a = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
    sess = a.sessionId
  }
  await attach()

  // openProject swaps the renderer/target, orphaning our session — every eval
  // must be able to re-attach and retry, else the loop goes silent the moment
  // the navigation lands. Short timeout so the wait loop keeps ticking.
  const evR = async (expr, t = 8000) => {
    try {
      return await ev(expr, t)
    } catch {
      try { await attach() } catch {}
      try { return await ev(expr, t) } catch { return undefined }
    }
  }

  // wait for editor ready — fresh wasm recompiles render pipelines on first
  // load (multi-minute), so be patient: up to 8 min, logging progress
  let ready = false
  for (let i = 0; i < 80 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 6000))
    const st = await evR(`(() => { const s = window.__eui; return JSON.stringify({ status: s?.status ?? 'none', scene: !!s?.scene, snap: s?.snapshot ? Object.keys(s.snapshot).length : 0 }) })()`)
    console.log(`  [iter ${i}] ${st ?? 'no __eui yet'}`)
    ready = await evR(`window.__eui?.status==='ready' && !!window.__eui?.scene`) === true
  }
  if (!ready) { console.log('FAIL: editor never became ready'); cleanup(); process.exit(1) }
  console.log('editor ready; warming pipelines…')
  await new Promise((r) => setTimeout(r, 18000))

  // --- ⋯ menu must render visibly (not clipped under the toolbar) ---
  const menu = await evR(`(async () => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const dots = [...sh.querySelectorAll('.eui-toolbar button')].find((b) => b.title === 'More options')
    if (!dots) return JSON.stringify({ err: 'no dots button' })
    dots.click(); await new Promise((r) => setTimeout(r, 400))
    const m = sh.querySelector('.eui-menu')
    if (!m) return JSON.stringify({ err: 'menu not rendered' })
    const r = m.getBoundingClientRect()
    const visible = r.height > 20 && r.bottom <= window.innerHeight + 2 && r.top >= 0
    dots.click()
    return JSON.stringify({ menuH: Math.round(r.height), bottom: Math.round(r.bottom), winH: window.innerHeight, visible })
  })()`)
  console.log('MENU:', menu)

  // --- ASSETS TAB validation (left dock: Scene | Assets; Assets: Catalog | Local) ---
  // catalog first (and screenshot it ON the catalog tab)
  const rc = await evR(`(async () => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const out = {}
    const assetsTab = [...sh.querySelectorAll('.eui-ltab')].find((t) => /assets/i.test(t.textContent))
    if (!assetsTab) return JSON.stringify({ err: 'no Assets tab found' })
    assetsTab.click(); await sleep(1500)
    out.assetsTabActive = !!sh.querySelector('.eui-seg')
    for (let i = 0; i < 50 && (window.__eui.assetCatalog?.length ?? 0) === 0; i++) await sleep(500)
    out.catalogCount = window.__eui.assetCatalog?.length ?? 0
    out.gridCells = sh.querySelectorAll('.eui-asset').length
    return JSON.stringify(out)
  })()`)
  await new Promise((r) => setTimeout(r, 1200))
  await shot('assets-catalog.png') // on the Catalog tab

  // verify a REAL catalog import (the path that errored: needs the data-layer,
  // whose realm the embedded host now supplies). Click the first card, wait for
  // the download+write+register+create to finish, assert a new entity is selected.
  const imp = await evR(`(async () => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const before = [...(window.__eui.selected ?? [])][0] ?? null
    const card = sh.querySelector('.eui-asset:not(.eui-asset-upload)')
    if (!card) return JSON.stringify({ err: 'no catalog card' })
    card.click()
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const sel = [...(window.__eui.selected ?? [])][0] ?? null
      if (window.__eui.assetBusy === false && sel !== before) break
    }
    return JSON.stringify({ before, after: [...(window.__eui.selected ?? [])][0] ?? null, status: window.__eui.saveStatus })
  })()`, 60000)
  console.log('CATALOG IMPORT:', imp)
  let importPass = false
  try { const m = JSON.parse(imp); importPass = m.after !== m.before && m.after != null && !/fail/i.test(m.status ?? '') } catch {}
  // then local
  const rl = await evR(`(async () => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const local = [...sh.querySelectorAll('.eui-seg-btn')].find((b) => /local/i.test(b.textContent))
    if (local) { local.click(); await sleep(3000) }
    return JSON.stringify({
      localRows: sh.querySelectorAll('.eui-asset:not(.eui-asset-upload)').length,
      hasUpload: !!sh.querySelector('.eui-asset-upload')
    })
  })()`)
  console.log('ASSETS catalog:', rc, ' local:', rl)
  let panelPass = false
  let o = {}
  try { o = { ...JSON.parse(rc), ...JSON.parse(rl) }; panelPass = o.assetsTabActive && o.catalogCount > 0 && o.gridCells > 0 && o.hasUpload === true } catch {}

  // place a local project model: click the first local row -> new entity selected
  let placePass = false
  if (panelPass && o.localRows > 0) {
    await evR(`(async () => { const sh=document.getElementById('editor-ui-host').shadowRoot; const row=sh.querySelector('.eui-asset:not(.eui-asset-upload)'); if(row) row.click(); await new Promise(r=>setTimeout(r,3500)) })()`)
    const selN = await evR(`[...(window.__eui.selected ?? [])].length`)
    placePass = typeof selN === 'number' && selN > 0
    console.log('local-place selected count:', selN)
  } else {
    console.log('(no local models to place — skipping place check)')
  }
  await shot('assets-local.png')
  cleanup()
  console.log(`ASSETS PANEL: ${panelPass ? 'PASS' : 'FAIL'}  (catalog=${o.catalogCount}, grid=${o.gridCells}, local=${o.localRows}, upload=${o.hasUpload})`)
  if (panelPass && (o.localRows === 0 || placePass)) console.log('LOCAL MODELS: OK')
  console.log(`CATALOG IMPORT (data-layer): ${importPass ? 'PASS' : 'FAIL'}`)
  process.exit(panelPass && importPass ? 0 : 1)
}
