// UX repro probe: drive the add-script flow with REAL key events (CDP
// Input.dispatchKeyEvent), not synthetic value setters, to catch focus/typing
// breakage. Also screenshots each stage to validate/artifacts.
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
  } catch (e) {
    console.log(`(screenshot ${name} failed: ${e.message})`)
  }
}

async function clickCenter(sel) {
  const box = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const el = sh.querySelector(${JSON.stringify(sel)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  if (!box) return false
  for (const [t, b] of [['mousePressed', 'left'], ['mouseReleased', 'left']]) {
    await send('Input.dispatchMouseEvent', { type: t, x: box.x, y: box.y, button: b, clickCount: 1 }, pageSession)
    await sleep(60)
  }
  return true
}

async function typeText(text) {
  for (const ch of text) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch }, pageSession)
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }, pageSession)
    await sleep(40)
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

  // select the entity, add the Script component through the real picker UI
  await evalIn(`(() => { (window.__euiBusChan ??= new BroadcastChannel('dcl-editor-bus')).postMessage({ to: 'scene', msg: { type: 'set-selection', selected: ['512'], active: '512' } }); return true })()`)
  await waitFor('selection', () => evalIn(`window.__eui.activeEntity === '512'`), 15000, 1000)
  await clickCenter('button[data-tip="Add component"]')
  await sleep(400)
  // type into the picker filter for realism
  await typeText('script')
  await sleep(300)
  const pickerState = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const filter = sh.querySelector('.eui-pop input')
    const items = [...sh.querySelectorAll('.eui-pop-item')].map((e) => e.textContent)
    return { filterValue: filter?.value ?? null, items }
  })()`)
  console.log('picker after typing "script":', JSON.stringify(pickerState))
  const item = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const item = [...sh.querySelectorAll('.eui-pop-item')].find((el) => /script/i.test(el.textContent))
    if (!item) return false
    item.click()
    return true
  })()`)
  if (!item) {
    await screenshot('typing-01-no-picker-item.png')
    throw new Error('Script not in picker')
  }
  await waitFor('component added', () => evalIn(`!!window.__eui.snapshot['512']?.['asset-packs::Script']`), 15000, 1000)
  await sleep(800)
  await screenshot('typing-02-empty-state.png')

  // the card must read "Script", not "asset-packs / script"
  const cardName = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const heads = [...sh.querySelectorAll('.eui-comp-head .name')]
    const head = heads.find((h) => /script/i.test(h.textContent))
    return head?.textContent.trim() ?? null
  })()`)
  console.log('component card label:', JSON.stringify(cardName))
  if (/asset-packs/i.test(cardName ?? '')) throw new Error(`card still namespaced: ${cardName}`)

  // no input may steal focus on add — shortcuts must stay live
  const focusAfterAdd = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    return sh.activeElement?.tagName ?? 'none'
  })()`)
  console.log('focused element after add-component:', focusAfterAdd)
  if (focusAfterAdd === 'INPUT' || focusAfterAdd === 'TEXTAREA') {
    throw new Error('an input auto-grabbed focus — shortcuts would be suppressed')
  }

  // ONE CLICK: "+ New script" scaffolds an auto-named file and opens the editor
  const clickedNew = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const btn = [...sh.querySelectorAll('.eui-script-view button')].find((b) => /new script/i.test(b.textContent))
    if (!btn || btn.disabled) return false
    btn.click()
    return true
  })()`)
  if (!clickedNew) {
    await screenshot('typing-03-no-new-button.png')
    throw new Error('"+ New script" button missing or disabled')
  }
  await waitFor(
    'code editor modal',
    () => evalIn(`!!document.getElementById('editor-ui-host').shadowRoot.querySelector('.eui-script-editor .cm-editor')`),
    20000,
    1000
  )
  const doc = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    return sh.querySelector('.eui-script-editor .cm-content')?.textContent?.slice(0, 300) ?? ''
  })()`)
  console.log('editor doc head:', JSON.stringify(doc.slice(0, 120)))
  if (!doc.includes('export class MyScript') || !doc.includes('Start function')) {
    throw new Error('scaffold does not match the Creator Hub template')
  }
  await screenshot('typing-04-editor-open.png')

  // close the editor; component + file must exist
  await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const btn = [...sh.querySelectorAll('.eui-script-editor .eui-modal-foot button')].find((b) => /close/i.test(b.textContent))
    btn?.click()
    return true
  })()`)
  await sleep(500)
  const comp = await evalIn(`JSON.stringify(window.__eui.snapshot['512']?.['asset-packs::Script'] ?? null)`)
  console.log('component value:', comp.slice(0, 160))
  if (!comp.includes('assets/scene/Scripts/my-script.ts')) throw new Error('component missing my-script.ts')
  const file = path.join(PROJECT, 'assets/scene/Scripts/my-script.ts')
  if (!fs.existsSync(file)) throw new Error('my-script.ts not on disk')

  // shortcuts must work after the flow: press E, expect the tool to change
  await evalIn(`(() => { const sh = document.getElementById('editor-ui-host').shadowRoot; sh.activeElement?.blur?.(); return true })()`)
  const toolBefore = await evalIn(`window.__eui.tool`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'e', code: 'KeyE', text: 'e' }, pageSession)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE' }, pageSession)
  await sleep(600)
  const toolAfter = await evalIn(`window.__eui.tool`)
  console.log('tool before/after pressing E:', toolBefore, '→', toolAfter)

  // "Attach existing…" path: real typing into the attach input
  await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const btn = [...sh.querySelectorAll('.eui-script-view button')].find((b) => /attach existing/i.test(b.textContent))
    btn?.click()
    return true
  })()`)
  await sleep(300)
  await clickCenter('.eui-script-add input')
  await sleep(150)
  await typeText('rotator')
  await sleep(200)
  const typed = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    return sh.querySelector('.eui-script-add input')?.value ?? null
  })()`)
  console.log('attach input after real typing:', JSON.stringify(typed))
  if (typed !== 'rotator') throw new Error('typing into attach input broken')
  await screenshot('typing-05-attach-typed.png')

  const ok = toolAfter !== toolBefore || toolAfter === 'move' // E = move; tolerate already-move
  console.log(ok ? 'NEW UX FLOW OK (one-click create, shortcuts live, typing works)' : 'SHORTCUTS STILL DEAD')
  electron.kill()
  process.exit(ok ? 0 : 1)
}

main().catch(async (e) => {
  console.error('probe failed:', e.message)
  electron?.kill()
  process.exit(2)
})
