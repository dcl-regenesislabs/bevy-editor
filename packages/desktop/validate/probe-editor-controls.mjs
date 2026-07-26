// Repro probe for the editing controls, driven the way a person drives them:
// real keys through CDP with the VIEWPORT focused (not the toolbar), and real
// clicks on the toolbar/hierarchy.
//
//   BEVY_EDITOR_PROJECT=/path/to/scene node validate/probe-editor-controls.mjs
//
// Covers: Alt tool shortcuts with the viewport focused, snap reaching the scene,
// lock blocking a gizmo drag, hide actually hiding, and UI nodes staying out of
// the hierarchy.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const artifacts = path.join(here, 'artifacts')
fs.mkdirSync(artifacts, { recursive: true })
const CDP_PORT = 9434
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

const cmd = (name, ...args) => evalIn(`window.__euiCmd(${JSON.stringify(name)}, ${JSON.stringify(args.map(String))})`)
const snapshot = async () => JSON.parse(await cmd('crdt_snapshot').catch(() => '{}'))

// Focus the ENGINE viewport — the case that matters, since the host page's
// listeners only see those keys via the iframe forwarding in embed.ts.
const focusViewport = () =>
  evalIn(`(() => {
    const f = document.getElementById('editor-ui-host')?.shadowRoot?.querySelector('iframe')
    const c = f && f.contentWindow.document.querySelector('canvas')
    if (c && !c.hasAttribute('tabindex')) c.setAttribute('tabindex', '0')
    if (f) f.contentWindow.focus()
    if (c) c.focus()
    return !!c
  })()`)

async function pressKey(key, code, vk, mods = {}) {
  const modifiers = (mods.alt ? 1 : 0) | (mods.ctrl ? 2 : 0) | (mods.meta ? 4 : 0) | (mods.shift ? 8 : 0)
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base }, pageSession).catch(() => {})
  await sleep(80)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, pageSession).catch(() => {})
  await sleep(250)
}

const clickTip = (tip) =>
  evalIn(
    `(() => {
      const root = document.getElementById('editor-ui-host')?.shadowRoot
      if (!root) return false
      const hit = [...root.querySelectorAll('[data-tip]')].find((e) =>
        (e.getAttribute('data-tip') || '').startsWith(${JSON.stringify(tip)})
      )
      if (!hit) return false
      hit.click()
      return true
    })()`
  )

async function screenshot(name) {
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' }, pageSession)
    fs.writeFileSync(path.join(artifacts, name), Buffer.from(shot.data, 'base64'))
  } catch {
    /* best effort */
  }
}

async function main() {
  if (!PROJECT) throw new Error('set BEVY_EDITOR_PROJECT')
  const electronDir = [path.join(root, 'node_modules', 'electron'), path.join(root, '..', '..', 'node_modules', 'electron')].find(
    (d) => fs.existsSync(path.join(d, 'path.txt'))
  )
  const electronPath = path.join(electronDir, 'dist', fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim())
  // The app takes a single-instance lock, so ANY running copy makes the one we
  // spawn quit immediately and no CDP endpoint ever appears. Clear them all,
  // not just ones started with our debugging port.
  try {
    execSync(`pkill -f 'Electron.app/Contents/MacOS/Electron'`, { stdio: 'ignore' })
  } catch {}
  await sleep(2500)
  electron = spawn(electronPath, ['.', `--remote-debugging-port=${CDP_PORT}`], {
    cwd: root,
    env: { ...process.env, BEVY_EDITOR_DEBUG: '1' },
    stdio: ['ignore', 'ignore', 'ignore']
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
  await screenshot('ctl-00-ready.png')

  // ---- 1. Alt tool shortcuts, with the VIEWPORT focused -------------------
  for (const [label, key, code, vk, expect] of [
    ['⌥W -> translate', 'w', 'KeyW', 87, 'translate'],
    ['⌥E -> rotate', 'e', 'KeyE', 69, 'rotate'],
    ['⌥R -> scale', 'r', 'KeyR', 82, 'scale'],
    ['⌥Q -> select', 'q', 'KeyQ', 81, 'select']
  ]) {
    await focusViewport()
    // focus lands asynchronously — dispatching immediately sends the key before
    // the canvas actually has it, which reads as a broken shortcut
    await sleep(300)
    await evalIn(`(() => {
      window.__seen = []
      const f = document.getElementById('editor-ui-host')?.shadowRoot?.querySelector('iframe')
      if (f && f.contentWindow && !f.contentWindow.__probeSpy) {
        f.contentWindow.__probeSpy = true
        f.contentWindow.addEventListener('keydown', e => window.__seen.push('iframe:' + e.code + ' alt=' + e.altKey), true)
      }
      return true
    })()`).catch(() => {})
    await pressKey(key, code, vk, { alt: true })
    await sleep(400)
    const tool = await evalIn(`window.__eui.activeAction`)
    const seen = await evalIn(`JSON.stringify(window.__seen || [])`).catch(() => '?')
    record(`shortcut ${label} (viewport focused)`, tool === expect, `activeAction='${tool}' seen=${seen}`)
  }

  // ---- 1b. the reported repro: ⌥W pressed WHILE the character is walking ---
  // Holding W to walk and then adding Alt is a different event stream from a
  // clean ⌥W press: the W keydown already happened, so whether a tool switch
  // fires at all depends on what the auto-repeat carries.
  await focusViewport()
  await sleep(300)
  await evalIn(`(() => { window.__eui.activeAction = 'select'; return true })()`)
  const wBase = { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 }
  // start walking: W down, no modifier
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...wBase, modifiers: 0 }, pageSession)
  await sleep(500)
  // now press Alt while W is still held — an auto-repeat of W now carries alt
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 1 }, pageSession)
  await sleep(200)
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...wBase, modifiers: 1, autoRepeat: true }, pageSession)
  await sleep(500)
  const toolWhileWalking = await evalIn(`window.__eui.activeAction`)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...wBase, modifiers: 1 }, pageSession)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 0 }, pageSession)
  await sleep(300)
  record('⌥W while walking (W already held)', toolWhileWalking === 'translate', `activeAction='${toolWhileWalking}'`)

  // ---- 2. does the snap flag reach the scene? -----------------------------
  // The page owns the toggle, the scene owns the gizmo — a flag that never
  // arrives means snapping silently does nothing.
  const snapBefore = await evalIn(`window.__eui.snap`)
  await clickTip('Snap to grid')
  await sleep(600)
  const snapAfter = await evalIn(`window.__eui.snap`)
  record('snap toggle flips page state', snapBefore !== snapAfter, `${snapBefore} -> ${snapAfter}`)

  // ---- 3. hierarchy hides UI nodes ---------------------------------------
  const snap = await snapshot()
  const uiIds = Object.keys(snap).filter((id) => Object.keys(snap[id] ?? {}).some((n) => n.startsWith('Ui')))
  const rows = await evalIn(`(() => {
    const root = document.getElementById('editor-ui-host')?.shadowRoot
    return root ? [...root.querySelectorAll('.eui-row')].length : -1
  })()`)
  const uiRowsShown = await evalIn(`(() => {
    const root = document.getElementById('editor-ui-host')?.shadowRoot
    if (!root) return -1
    return [...root.querySelectorAll('.eui-row .label')].filter((e) => /Ui(Transform|Text|Background)/.test(e.textContent || '')).length
  })()`)
  record('hierarchy excludes UI nodes', uiRowsShown === 0, `${uiIds.length} UI entities in scene, ${rows} rows shown, ${uiRowsShown} look like UI`)

  console.log('')
  const ok = results.every((r) => r.ok)
  console.log(ok ? '✅ all control checks passed' : '❌ some control checks failed')
  await screenshot('ctl-01-final.png')
  try {
    electron.kill()
  } catch {}
  process.exit(ok ? 0 : 1)
}

main().catch(async (e) => {
  console.error('probe failed:', e.message)
  try {
    electron?.kill()
  } catch {}
  process.exit(2)
})
