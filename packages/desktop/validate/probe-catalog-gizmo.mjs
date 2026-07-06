// Repro probe: import a model from the assets catalog in a FRESH session and
// check the gizmo state afterwards (selection, tool, gizmo overlay), with
// screenshots to validate/artifacts for visual inspection.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const artifacts = path.join(here, 'artifacts')
const CDP_PORT = 9433
let msgId = 0
const pending = new Map()
let ws = null
let pageSession = null
let electron = null
const PROJECT = process.env.BEVY_EDITOR_PROJECT

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

async function screenshot(name) {
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' }, pageSession)
    fs.writeFileSync(path.join(artifacts, name), Buffer.from(shot.data, 'base64'))
    console.log('screenshot:', name)
  } catch (e) {
    console.log(`(screenshot ${name} failed: ${e.message})`)
  }
}

async function main() {
  if (!PROJECT) throw new Error('set BEVY_EDITOR_PROJECT')
  const electronDir = [
    path.join(root, 'node_modules', 'electron'),
    path.join(root, '..', '..', 'node_modules', 'electron')
  ].find((d) => fs.existsSync(path.join(d, 'path.txt')))
  const electronPath = path.join(electronDir, 'dist', fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim())
  try {
    execSync(`pkill -f 'remote-debugging-port=${CDP_PORT}'`, { stdio: 'ignore' })
    await sleep(1500)
  } catch {}
  electron = spawn(electronPath, ['.', `--remote-debugging-port=${CDP_PORT}`], {
    cwd: root,
    env: { ...process.env, BEVY_EDITOR_DEBUG: '1' },
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
  await attach()
  await waitFor(
    'editor ready',
    () => evalIn(`(() => { const s = window.__eui; return s && s.status === 'ready' ? 'ready' : null })()`),
    240000,
    5000
  )

  // open the Assets panel (left dock toggle), Catalog tab is the default
  const opened = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const btn = [...sh.querySelectorAll('button')].find((b) => (b.dataset.tip ?? '').toLowerCase().includes('asset'))
    if (!btn) return 'no assets toggle'
    btn.click()
    return 'ok'
  })()`)
  console.log('assets toggle:', opened)
  await sleep(1000)

  // wait for catalog cards (CDN fetch)
  await waitFor(
    'catalog cards',
    () => evalIn(`document.getElementById('editor-ui-host').shadowRoot.querySelectorAll('.eui-asset-grid .eui-asset').length > 0`),
    60000,
    2000
  )
  await screenshot('gizmo-01-catalog.png')

  const before = await evalIn(`Object.keys(window.__eui.snapshot).length`)
  // click the first catalog card
  await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const card = sh.querySelector('.eui-asset-grid .eui-asset')
    card.click()
    return card.textContent.slice(0, 60)
  })()`).then((n) => console.log('clicked catalog card:', JSON.stringify(n)))

  // wait for the new entity to land in the snapshot
  await waitFor(
    'new entity in snapshot',
    () => evalIn(`Object.keys(window.__eui.snapshot).length > ${before}`),
    120000,
    2000
  )
  await sleep(4000) // let focus fly + gltf load
  const st = await evalIn(`(() => {
    const s = window.__eui
    const active = s.activeEntity
    const comps = active ? Object.keys(s.snapshot[active] ?? {}) : []
    return {
      active,
      selected: [...s.selected],
      tool: s.activeAction,
      camMode: s.camMode,
      frozen: s.frozen,
      saveStatus: s.saveStatus,
      transform: active ? JSON.stringify(s.snapshot[active]?.Transform?.position ?? null) : null,
      comps
    }
  })()`)
  console.log('after import:', JSON.stringify(st, null, 1))
  await screenshot('gizmo-02-after-import.png')
  await sleep(4000)
  await screenshot('gizmo-03-after-settle.png')

  const ok = st.active !== null && st.selected.length > 0 && st.tool !== 'select'
  console.log(ok ? 'IMPORT+SELECT+TOOL OK — inspect screenshots for gizmo placement' : 'IMPORT FLOW BROKEN')
  electron.kill()
  process.exit(ok ? 0 : 1)
}

main().catch(async (e) => {
  console.error('probe failed:', e.message)
  await screenshot('gizmo-99-fail.png').catch(() => {})
  electron?.kill()
  process.exit(2)
})
