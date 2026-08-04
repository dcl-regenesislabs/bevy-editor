// Repro probe for where a from-scratch entity lands.
//
//   BEVY_EDITOR_PROJECT=/path/to/scene node validate/probe-new-entity-drop.mjs
//
// A new ROOT entity used to be written at 0,0,0 while an imported model went to
// the camera drop point, so creating one often put it out of sight under the
// parcel corner. A CHILD is different: its Transform is local, so 0,0,0 means
// "on its parent" and is correct. This drives both through the real UI (the
// hierarchy's New-entity button and its dialog) and reads the Transform back
// out of the scene's own CRDT snapshot.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const CDP_PORT = 9435
let msgId = 0
const pending = new Map()
let ws = null
let pageSession = null
let electron = null
const PROJECT = process.env.BEVY_EDITOR_PROJECT
const results = []
const record = (step, ok, detail) => {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail ? ` — ${detail}` : ''}`)
}

function send(method, params, sessionId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    const t = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${method} timeout`))
    }, timeoutMs)
    pending.set(id, { resolve: (r) => { clearTimeout(t); resolve(r) }, reject })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}

async function attach() {
  const { targetInfos } = await send('Target.getTargets', {})
  const page = targetInfos.find((t) => t.type === 'page' && t.url.includes('editor-app'))
  if (!page) throw new Error('no editor page target')
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
  pageSession = sessionId
  await send('Runtime.enable', {}, pageSession).catch(() => {})
  return sessionId
}

async function evalIn(expr, timeoutMs = 30000) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, pageSession, timeoutMs)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

async function waitFor(label, fn, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`)
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const clickTip = (tip) =>
  evalIn(`(() => {
    const root = document.getElementById('editor-ui-host')?.shadowRoot
    const hit = [...(root?.querySelectorAll('[data-tip]') ?? [])].find((e) =>
      (e.getAttribute('data-tip') || '') === ${JSON.stringify(tip)})
    if (!hit) return false
    hit.click()
    return true
  })()`)

// Click a footer button in the open modal by its label.
const clickButton = (label) =>
  evalIn(`(() => {
    const root = document.getElementById('editor-ui-host')?.shadowRoot
    const b = [...(root?.querySelectorAll('button') ?? [])].find((e) => e.textContent.trim() === ${JSON.stringify(label)})
    if (!b) return false
    b.click()
    return true
  })()`)

const ids = () => evalIn(`Object.keys(window.__eui.snapshot ?? {})`)
const transformOf = (id) =>
  evalIn(`(() => { const t = window.__eui.snapshot?.[${JSON.stringify(id)}]?.Transform; return t ? JSON.stringify(t) : null })()`)

// Create one entity through the UI and answer with its id + Transform.
async function createEntity(pickRoot) {
  const before = new Set(await ids())
  if (!(await clickTip('New entity'))) throw new Error('no New entity button')
  await sleep(400)
  // the dialog defaults to the active entity when one is selected — force the
  // branch we mean to exercise
  await evalIn(`(() => {
    const root = document.getElementById('editor-ui-host')?.shadowRoot
    const radios = [...(root?.querySelectorAll('button,label') ?? [])]
    const want = radios.find((e) => /${'^'}(scene root|root)$/i.test(e.textContent.trim()))
    if (${pickRoot} && want) want.click()
    return true
  })()`).catch(() => {})
  await sleep(200)
  if (!(await clickButton('Create'))) throw new Error('no Create button')
  await sleep(2500)
  const after = await ids()
  const fresh = after.find((id) => !before.has(id))
  if (fresh === undefined) throw new Error('no new entity appeared')
  return { id: fresh, transform: JSON.parse((await transformOf(fresh)) ?? 'null') }
}

async function main() {
  if (!PROJECT) throw new Error('set BEVY_EDITOR_PROJECT')
  const electronDir = [path.join(root, 'node_modules', 'electron'), path.join(root, '..', '..', 'node_modules', 'electron')]
    .find((d) => fs.existsSync(path.join(d, 'path.txt')))
  const electronPath = path.join(electronDir, 'dist', fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim())
  try { execSync(`pkill -f 'Electron.app/Contents/MacOS/Electron'`, { stdio: 'ignore' }) } catch {}
  await sleep(2500)
  electron = spawn(electronPath, ['.', `--remote-debugging-port=${CDP_PORT}`], {
    cwd: root, env: { ...process.env, BEVY_EDITOR_DEBUG: '1' }, stdio: ['ignore', 'ignore', 'ignore']
  })

  const version = await waitFor('CDP endpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
    return res.ok ? res.json() : null
  }, 30000)
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
  await waitFor('page target', () => attach(), 60000)
  await evalIn(`window.editorShell.openProject(${JSON.stringify(PROJECT)})`).catch(() => {})
  await sleep(2000)
  await waitFor('page target (after open)', () => attach(), 60000)
  await waitFor('editor ready', () => evalIn(`(() => (window.__eui?.status === 'ready') || null)()`), 240000, 5000)
  await sleep(4000)

  // The left tab is a persisted choice; the New-entity button only exists on the
  // hierarchy. Force it and reload — the dev servers stay up, so the page pulls
  // the cached ready payload back (the same path Cmd+R takes).
  const view = await evalIn(`localStorage.getItem('eui:left-view')`)
  if (view !== 'scene') {
    await evalIn(`(() => { localStorage.setItem('eui:left-view', 'scene'); localStorage.setItem('eui:left-open', '1'); location.reload(); return true })()`).catch(() => {})
    await sleep(3000)
    await waitFor('page target (after reload)', () => attach(), 60000)
    await waitFor('editor ready (after reload)', () => evalIn(`(() => (window.__eui?.status === 'ready') || null)()`), 240000, 5000)
    await sleep(4000)
  }
  if (!(await evalIn(`!!document.getElementById('editor-ui-host')?.shadowRoot?.querySelector('[data-tip="New entity"]')`))) {
    const tips = await evalIn(`[...document.getElementById('editor-ui-host').shadowRoot.querySelectorAll('[data-tip]')].map((e) => e.getAttribute('data-tip')).slice(0, 40)`)
    throw new Error(`hierarchy not showing; tips seen: ${JSON.stringify(tips)}`)
  }

  // ---- 1. a root entity lands at the camera drop point, not the origin ----
  await evalIn(`(() => { window.__eui.selected = new Set(); window.__eui.activeEntity = null; return true })()`)
  await sleep(300)
  const rootEnt = await createEntity(true)
  const p = rootEnt.transform?.position ?? {}
  const atOrigin = p.x === 0 && p.y === 0 && p.z === 0
  record('root entity placed at the camera drop', !atOrigin, `entity ${rootEnt.id} at ${JSON.stringify(p)}`)

  // ---- 2. a child keeps the parent origin (its Transform is local) --------
  await evalIn(`(() => { window.__eui.selected = new Set([${JSON.stringify(rootEnt.id)}]); window.__eui.activeEntity = ${JSON.stringify(rootEnt.id)}; return true })()`)
  await sleep(400)
  const child = await createEntity(false)
  const cp = child.transform?.position ?? {}
  const childLocal = cp.x === 0 && cp.y === 0 && cp.z === 0
  const parented = String(child.transform?.parent ?? 0) === rootEnt.id
  record('child keeps the parent origin', childLocal && parented, `child ${child.id} at ${JSON.stringify(cp)} parent=${child.transform?.parent}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${failed === 0 ? 'PROBE PASSED' : 'PROBE FAILED'} (${results.length - failed}/${results.length})`)
  process.exitCode = failed === 0 ? 0 : 1
}

main()
  .catch((e) => { console.error('probe error:', e.message); process.exitCode = 1 })
  .finally(() => { try { electron?.kill() } catch {} ; try { ws?.close() } catch {} })
