// Regression probe: Escape closes a ds Modal. Opens Scene Settings from the
// hierarchy and presses Escape as the OS would (CDP raw key), because a
// synthetic KeyboardEvent would prove nothing about real focus routing.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
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
let scratch = null

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

let keepScratch = false
function cleanup() {
  electron?.kill()
  if (scratch && !keepScratch) try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 3 }) } catch {}
}

// click the first element under the editor shadow root matching selector whose
// textContent includes `text`
const clickWhere = (selector, text) => `(() => {
  const sh = document.getElementById('editor-ui-host').shadowRoot
  const el = [...sh.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.includes(${JSON.stringify(text)}))
  if (!el) return false
  el.click()
  return true
})()`

async function main() {
  const electronDir = [
    path.join(root, 'node_modules', 'electron'),
    path.join(root, '..', '..', 'node_modules', 'electron')
  ].find((d) => fs.existsSync(path.join(d, 'path.txt')))
  const electronPath = path.join(electronDir, 'dist', fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim())
  try {
    execSync(`pkill -f 'remote-debugging-port=${CDP_PORT}'`, { stdio: 'ignore' })
    await sleep(1500)
  } catch {}

  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'esc-probe-'))
  const env = {
    ...process.env,
    BEVY_EDITOR_DEBUG: '1',
    BEVY_EDITOR_USER_DATA: path.join(scratch, 'user-data'),
    BEVY_WEB_PORT: '3110',
    SCENE_PORT: '8104',
    EDITOR_SCENE_PORT: '8105'
  }
  env.BEVY_EDITOR_PROJECT = process.env.ESC_PROBE_PROJECT ?? '/private/tmp/claude-501/-Users-boedo-Documents-Decentraland-dcl-editor/8cf23c64-6632-4ded-9bab-e69fcf064a5b/scratchpad/p0-blank'
  electron = spawn(electronPath, ['.', `--remote-debugging-port=${CDP_PORT}`], { cwd: root, env, stdio: ['ignore', 'ignore', 'ignore'] })

  const version = await waitFor('CDP endpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
    return res.ok ? res.json() : null
  }, 30000, 1000)
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
  await waitFor('page target', async () => { await attach(); return true }, 60000, 1500)

  const fail = (step, detail) => { console.log(`FAIL ${step} — ${detail}`); cleanup(); process.exit(1) }
  const pass = (step, detail) => console.log(`PASS ${step}${detail ? ` — ${detail}` : ''}`)

  await waitFor('editor ready', async () => {
    try {
      return await evalIn(`(() => { const s = window.__eui; return s && s.status === 'ready' ? 'ready' : null })()`)
    } catch {
      await attach().catch(() => {})
      return null
    }
  }, 300000, 4000)
  pass('open', 'editor ready on a pre-installed scene')

  const opened = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const btn = sh.querySelector('.eui-scene-row')
    if (!btn) return 'no settings button'
    btn.click()
    return 'ok'
  })()`)
  if (opened !== 'ok') fail('open-settings', opened)
  await waitFor('modal on screen', () => evalIn(`!!document.getElementById('editor-ui-host').shadowRoot.querySelector('.eui-scene-settings')`), 20000, 500)
  pass('open-settings', 'Scene settings modal is up')

  // spy first: does an Escape keydown reach the host window at all?
  await evalIn(`(() => {
    window.__escSeen = 0
    window.__escTarget = null
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.__escSeen++
        window.__escTarget = (e.composedPath()[0] || {}).tagName || 'none'
      }
    }, true)
    return true
  })()`)

  await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' }, pageSession)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' }, pageSession)
  await sleep(1500)

  const seen = await evalIn(`JSON.stringify({ count: window.__escSeen, target: window.__escTarget })`)
  console.log('DIAGNOSTIC escape reached window:', seen)
  const afterReal = await evalIn(`!!document.getElementById('editor-ui-host').shadowRoot.querySelector('.eui-scene-settings')`)
  console.log('DIAGNOSTIC modal still open after real key:', afterReal)

  if (afterReal) {
    await evalIn(`(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: false, cancelable: true }))
      return true
    })()`)
    await sleep(800)
    const afterSynthetic = await evalIn(`!!document.getElementById('editor-ui-host').shadowRoot.querySelector('.eui-scene-settings')`)
    console.log('DIAGNOSTIC modal still open after synthetic window event:', afterSynthetic)
    fail('escape', afterSynthetic ? 'neither real nor synthetic Escape closes it' : 'real key ignored, synthetic works')
  }
  pass('escape', 'Escape closed the Scene settings modal')

  console.log('MODAL ESCAPE CONFIRMED')
  cleanup()
  process.exit(0)
}

main().catch((e) => { console.error('probe failed:', e.message); cleanup(); process.exit(2) })
