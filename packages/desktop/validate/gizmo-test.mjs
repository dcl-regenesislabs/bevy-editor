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
const out = path.join(here, 'artifacts', 'gizmo')
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
  // surface scene-server / recovery / error lines so a boot wedge is diagnosable
  el.stdout.on('data', (d) => String(d).split('\n').forEach((l) => { if (/⟳|recover|✖|❌|RemoteError|server is up|scene-ready|did not come up|error/i.test(l)) console.log('[main]', l.slice(0, 160)) }))
  el.stderr.on('data', (d) => String(d).split('\n').forEach((l) => { if (/indexeddb|leveldb|quota|panic/i.test(l)) console.log('[main:err]', l.slice(0, 140)) }))
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
  await new Promise((r) => setTimeout(r, 30000))

  // Select via a hierarchy DOM click (the bus path that reliably lands — the
  // raw `await __euiCmd` round-trip intermittently hangs), then fire-and-forget
  // the focus (its console response can hang even though the bus queues it).
  const sel = await evR(`(async () => {
    const s = window.__eui, NAME = 'core-schema::Name'
    const named = Object.keys(s.snapshot).filter((id) => s.snapshot[id]?.[NAME] !== undefined && Number(id) >= 512)
    const pick = named.find((id) => /duck|drone|santa|bed|podium|leader/i.test(s.snapshot[id][NAME]?.value ?? '')) ?? named[0]
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const wanted = (s.snapshot[pick][NAME]?.value ?? '').trim()
    const row = [...sh.querySelectorAll('.eui-panel-body *')].find((e) => e.children.length === 0 && e.textContent.trim() === wanted)
    if (row) row.click()
    else window.__euiCmd('editor_send', ['scene', JSON.stringify({ type: 'set-selection', selected: [pick], active: pick })])
    await new Promise((r) => setTimeout(r, 1200))
    // the transform gizmo only spawns for a transform tool — hierarchy select
    // leaves the tool on 'select' (only a viewport click auto-switches), so set
    // translate explicitly, then focus the camera on the selection.
    window.__euiCmd('editor_send', ['scene', JSON.stringify({ type: 'set-tool', tool: 'translate' })])
    await new Promise((r) => setTimeout(r, 600))
    window.__euiCmd('editor_send', ['scene', JSON.stringify({ type: 'focus', entity: pick })])
    await new Promise((r) => setTimeout(r, 2800))
    return JSON.stringify({ pick, name: wanted, viaRow: !!row, selected: [...(s.selected ?? [])] })
  })()`).catch((e) => 'select-error: ' + e.message)
  console.log('selected', sel)

  // --- CLICK-TO-SELECT + AUTO-GIZMO validation (the focused model is centered) ---
  // Reset to the select tool and clear the selection, so a single viewport click
  // must do BOTH: select the model under the cursor AND auto-switch to the move
  // gizmo (editor scene's pickAtPointer behaviour).
  await evR(`(async () => {
    window.__euiCmd('editor_send', ['scene', JSON.stringify({ type: 'set-tool', tool: 'select' })])
    window.__euiCmd('editor_send', ['scene', JSON.stringify({ type: 'set-selection', selected: [], active: null })])
    await new Promise((r) => setTimeout(r, 900))
    return true
  })()`)
  // a real left click at the centered model (press+release same point = tap)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 750, y: 470, button: 'left', buttons: 1, clickCount: 1 }, sess).catch(() => {})
  await new Promise((r) => setTimeout(r, 120))
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 750, y: 470, button: 'left', buttons: 0, clickCount: 1 }, sess).catch(() => {})
  await new Promise((r) => setTimeout(r, 2500))
  const click = await evR(`JSON.stringify({ selected: [...(window.__eui.selected ?? [])], tool: window.__eui.activeAction })`)
  console.log('after viewport click:', click)
  let clickPass = false
  try { const c = JSON.parse(click); clickPass = c.selected.length > 0 && c.tool === 'translate' } catch {}
  console.log(clickPass ? 'CLICK-SELECT + AUTO-GIZMO: PASS' : 'CLICK-SELECT + AUTO-GIZMO: FAIL')

  // --- SWITCH SELECTION (faithful: gizmo stays up, click a DIFFERENT on-screen
  // model found by probing /pointer_target — NO re-focus, exactly like real use) ---
  const aId = await evR(`[...(window.__eui.selected ?? [])][0]`)
  const editorHash = await evR(`window.__eui.scene?.hash ?? null`)
  console.log('editor scene hash:', editorHash)
  let target = null
  // Only a DIFFERENT model IN THE EDITOR'S OWN SCENE that resolves to a named,
  // selectable entity is a valid switch target — pickAtPointer rejects hits in
  // neighbouring scenes (the stack renders other parcels) and unnamed meshes,
  // so accepting those would make this a false negative.
  for (const y of [380, 440, 510, 580]) {
    if (target) break
    for (const x of [560, 660, 850, 960, 1050]) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 }, sess).catch(() => {})
      await new Promise((r) => setTimeout(r, 220))
      const info = await evR(`(async()=>{try{
        const r=await window.__euiCmd('pointer_target'); const t=JSON.parse(r)
        if(!t||t.entity==null) return null
        const s=window.__eui, NAME='core-schema::Name'
        const hash=s.scene?.hash
        // resolve to nearest named ancestor (pickAtPointer's rule)
        let cur=String(t.entity), named=null
        while(cur&&cur!=='0'){ if(s.snapshot[cur]?.[NAME]!==undefined){named=cur;break} cur=String((s.snapshot[cur]?.Transform?.parent)??0) }
        return JSON.stringify({scene:t.scene,entity:String(t.entity),sameScene:t.scene===hash,named,inSnap:String(t.entity) in s.snapshot})
      }catch(e){return null}})()`)
      const t = info ? JSON.parse(info) : null
      if (t) console.log('  probe', x, y, '->', info)
      if (t && t.sameScene && t.named && t.named !== aId) { target = { x, y, pt: t.named }; break }
    }
  }
  console.log('probe (A=' + aId + ') found different SAME-SCENE named model at ' + JSON.stringify(target))
  if (target) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1 }, sess).catch(() => {})
    await new Promise((r) => setTimeout(r, 120))
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 }, sess).catch(() => {})
    await new Promise((r) => setTimeout(r, 2200))
    const after = await evR(`[...(window.__eui.selected ?? [])][0]`)
    const switched = after != null && after !== aId
    console.log('SWITCH-SELECT (real): ' + (switched ? 'PASS' : 'FAIL') + ' (was ' + aId + ', clicked near ' + target.pt + ', now ' + after + ')')
  } else {
    console.log('SWITCH-SELECT (real): INCONCLUSIVE — no 2nd on-screen model found')
  }
  await new Promise((r) => setTimeout(r, 1000))

  // orbit to several angles via the engine's orbit camera; at each, screenshot +
  // count gizmo pixels. We drive orbit with right-drag on the viewport.
  const results = []
  const W = 1500
  const angles = 8
  for (let k = 0; k < angles; k++) {
    // right-button drag to rotate the orbit camera a step
    const y = 480
    for (const [type, btn] of [['mousePressed', 'right'], ['mouseMoved', 'right'], ['mouseReleased', 'right']]) {
      const x = type === 'mouseMoved' ? 750 + 140 : 750
      await send('Input.dispatchMouseEvent', { type, x, y, button: btn, buttons: 2, clickCount: type === 'mousePressed' ? 1 : 0 }, sess)
      await new Promise((r) => setTimeout(r, 80))
    }
    await new Promise((r) => setTimeout(r, 1200))
    const p = await shot(`angle-${k}.png`)
    const px = gizmoPixels(p)
    const visible = px.red + px.blue > 40 // red+blue axes are unambiguous (green collides with selection outline)
    results.push({ angle: k, ...px, visible })
    console.log(`angle ${k}: red=${px.red} green=${px.green} blue=${px.blue} -> ${visible ? 'VISIBLE' : 'NOT VISIBLE'}`)
  }

  const visibleCount = results.filter((r) => r.visible).length
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
  console.log(`\n${visibleCount}/${angles} angles show the gizmo`)
  cleanup()
  const pass = visibleCount === angles
  console.log(pass ? 'GIZMO TEST PASSED' : 'GIZMO TEST FAILED')
  process.exit(pass ? 0 : 1)
}

main().catch((e) => { console.error('harness error', e); process.exit(1) })
