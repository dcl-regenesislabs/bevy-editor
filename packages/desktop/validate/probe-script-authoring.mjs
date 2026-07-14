// Proof probe #2: the full in-app authoring flow for the Script component.
// Boot on a scene with NO scripts, then via the real UI: select the entity,
// add asset-packs::Script from the picker, create a script from the template
// (file written over the data-layer), see the code editor modal open with the
// scaffolded class, close it, and confirm the component + file + params exist.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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

// set a React controlled input's value so onChange fires
const setInput = (sel, value) => `(() => {
  const sh = document.getElementById('editor-ui-host').shadowRoot
  const input = sh.querySelector(${JSON.stringify(sel)})
  if (!input) return 'no input'
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`

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
  const fail = (step, detail) => {
    console.log(`FAIL ${step} — ${detail}`)
    electron.kill()
    process.exit(1)
  }
  const pass = (step, detail) => console.log(`PASS ${step}${detail ? ` — ${detail}` : ''}`)

  // 1. select entity 512 over the bus
  await evalIn(`(() => { (window.__euiBusChan ??= new BroadcastChannel('dcl-editor-bus')).postMessage({ to: 'scene', msg: { type: 'set-selection', selected: ['512'], active: '512' } }); return true })()`)
  await waitFor('selection', () => evalIn(`window.__eui.activeEntity === '512'`), 15000, 1000)
  pass('select', 'entity 512 active')

  // 2. open the add-component picker and add asset-packs::Script
  const picked = await evalIn(`(async () => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const add = sh.querySelector('button[data-tip="Add component"]')
    if (!add) return 'no add button'
    add.click()
    await new Promise((r) => setTimeout(r, 400))
    const item = [...sh.querySelectorAll('.eui-pop-item')].find((el) => el.textContent.includes('asset-packs::Script'))
    if (!item) return 'Script not in picker: ' + [...sh.querySelectorAll('.eui-pop-item')].map((e) => e.textContent).join(',').slice(0, 200)
    item.click()
    return 'ok'
  })()`)
  if (picked !== 'ok') fail('picker', picked)
  await waitFor(
    'Script component on entity',
    () => evalIn(`!!window.__eui.snapshot['512']?.['asset-packs::Script']`),
    15000,
    1000
  )
  pass('add-component', 'asset-packs::Script present in snapshot')

  // 3. the ScriptView add-form should be open (0 scripts) — create "rotator"
  await sleep(800)
  const typed = await evalIn(setInput('.eui-script-add input', 'rotator'))
  if (typed !== 'ok') fail('add-form', typed)
  const created = await evalIn(`(async () => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const btn = [...sh.querySelectorAll('.eui-script-add-actions button')].find((b) => /add script/i.test(b.textContent))
    if (!btn) return 'no Add script button'
    if (btn.disabled) return 'Add script disabled'
    btn.click()
    return 'ok'
  })()`)
  if (created !== 'ok') fail('create', created)

  // 4. the code editor modal opens on the scaffolded file
  await waitFor(
    'code editor modal',
    () => evalIn(`!!document.getElementById('editor-ui-host').shadowRoot.querySelector('.eui-script-editor .cm-editor')`),
    20000,
    1000
  )
  const doc = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    return sh.querySelector('.eui-script-editor .cm-content')?.textContent?.slice(0, 400) ?? ''
  })()`)
  if (!doc.includes('RotatorScript')) fail('editor-content', `scaffold missing RotatorScript: ${doc.slice(0, 120)}`)
  pass('code-editor', 'modal open with scaffolded RotatorScript class')

  // 5. close the modal, check component value + file on disk
  await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const btn = [...sh.querySelectorAll('.eui-script-editor .eui-modal-foot button')].find((b) => /close/i.test(b.textContent))
    btn?.click()
    return true
  })()`)
  await sleep(500)
  const comp = await evalIn(`JSON.stringify(window.__eui.snapshot['512']?.['asset-packs::Script'] ?? null)`)
  const val = JSON.parse(comp)
  if (!val || val.value?.[0]?.path !== 'assets/scene/Scripts/rotator.ts') fail('component-value', comp)
  pass('component-value', comp.slice(0, 140))

  const file = path.join(PROJECT, 'assets/scene/Scripts/rotator.ts')
  if (!fs.existsSync(file)) fail('file', `${file} not written`)
  const src = fs.readFileSync(file, 'utf8')
  if (!src.includes('export class RotatorScript')) fail('file-content', src.slice(0, 120))
  pass('file', `${file} written via data-layer (${src.length} bytes)`)

  // 6. save the composite and confirm the Script component persisted
  await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const btn = [...sh.querySelectorAll('button')].find((b) => /^sav(e|ing)/i.test(b.textContent.trim()))
    if (btn && !btn.disabled) btn.click()
    return !!btn
  })()`)
  await sleep(4000)
  const composite = fs.readFileSync(path.join(PROJECT, 'assets/scene/main.composite'), 'utf8')
  if (!composite.includes('asset-packs::Script') || !composite.includes('rotator.ts')) {
    fail('composite', 'Script component not in saved main.composite')
  }
  pass('composite', 'asset-packs::Script + rotator.ts persisted in main.composite')

  console.log('AUTHORING FLOW CONFIRMED')
  electron.kill()
  process.exit(0)
}

main().catch((e) => {
  console.error('probe failed:', e.message)
  electron?.kill()
  process.exit(2)
})
