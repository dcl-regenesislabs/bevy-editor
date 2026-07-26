// Repro probe: can the avatar be WALKED with WASD while the scene is stopped?
//
// The existing `move` step in validate.mjs proves only that /move_player_to
// teleports the player — it never sends input, so it passes even when avatar
// input is disabled. This drives the real keys through CDP, which is the only
// way to catch an InputModifier{disableAll} that the editor scene left on the
// player.
//
//   BEVY_EDITOR_PROJECT=/path/to/scene node validate/probe-avatar-walk.mjs
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const artifacts = path.join(here, 'artifacts')
fs.mkdirSync(artifacts, { recursive: true })
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
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

const cmd = (name, ...args) =>
  evalIn(`window.__euiCmd(${JSON.stringify(name)}, ${JSON.stringify(args.map(String))})`)

const playerPos = async () => {
  const r = await cmd('player_position').catch(() => '')
  const m = /\(\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\)/.exec(r)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

const focusViewport = () =>
  evalIn(`(() => {
    const f = document.getElementById('editor-ui-host')?.shadowRoot?.querySelector('iframe')
    const c = f && f.contentWindow.document.querySelector('canvas')
    if (c && !c.hasAttribute('tabindex')) c.setAttribute('tabindex', '0')
    if (f) f.contentWindow.focus()
    if (c) c.focus()
    return !!c
  })()`)

// Hold a key down for `ms`, the way a person walking would — a single
// down/up pair is too short for the character controller to cover ground.
async function holdKey(key, code, vk, ms) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: 0 }
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }, pageSession).catch(() => {})
  const until = Date.now() + ms
  while (Date.now() < until) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, autoRepeat: true }, pageSession).catch(() => {})
    await sleep(50)
  }
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, pageSession).catch(() => {})
  await sleep(400)
}

// Dispatch a key (down+up) to whatever holds focus.
async function pressKey(key, code, vk) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: 0 }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base }, pageSession).catch(() => {})
  await sleep(80)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, pageSession).catch(() => {})
  await sleep(200)
}

// Click a toolbar button by its tooltip — the panels live in a shadow root.
const clickButton = (tip) =>
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

// One walk attempt: read position, hold the key, read again, report the distance.
async function tryWalk(label, key, code, vk) {
  const before = await playerPos()
  if (before === null) return { label, ok: false, detail: 'no player_position' }
  await focusViewport()
  await holdKey(key, code, vk, 1200)
  const after = await playerPos()
  if (after === null) return { label, ok: false, detail: 'no player_position after' }
  const moved = Math.hypot(after[0] - before[0], after[2] - before[2])
  return {
    label,
    ok: moved > 0.5,
    detail: `${moved.toFixed(2)}m  ${JSON.stringify(before.map((n) => +n.toFixed(1)))} -> ${JSON.stringify(after.map((n) => +n.toFixed(1)))}`
  }
}

async function main() {
  if (!PROJECT) throw new Error('set BEVY_EDITOR_PROJECT')
  const electronDir = [
    path.join(root, 'node_modules', 'electron'),
    path.join(root, '..', '..', 'node_modules', 'electron')
  ].find((d) => fs.existsSync(path.join(d, 'path.txt')))
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
  await waitFor('editor page target', async () => {
    await attach()
    return pageSession
  }, 60000, 1000)

  // open the project from the picker
  await waitFor('picker', () => evalIn(`(() => !!document.getElementById('editor-ui-host') || !!document.querySelector('.eui-home'))()`), 60000, 1000)
  await evalIn(`window.editorShell.openProject(${JSON.stringify(PROJECT)})`).catch(() => {})
  // openProject navigates the page — the target briefly goes away, so re-attach
  // with retries rather than once
  await sleep(2000)
  await waitFor('editor page target (after open)', async () => {
    await attach()
    return pageSession
  }, 60000, 1000)
  await waitFor(
    'editor ready',
    () => evalIn(`(() => { const s = window.__eui; return s && s.status === 'ready' ? 'ready' : null })()`),
    240000,
    5000
  )
  await sleep(3000)

  const frozen = await evalIn(`(() => window.__eui.frozen)()`)
  const camMode = await evalIn(`(() => window.__eui.camMode)()`)
  console.log(`\nstate: frozen=${frozen} camMode=${camMode}`)
  await screenshot('walk-00-ready.png')

  const results = []
  results.push(await tryWalk('walk W while stopped', 'w', 'KeyW', 87))
  results.push(await tryWalk('walk S while stopped', 's', 'KeyS', 83))
  await screenshot('walk-01-after.png')

  // The fly camera is what actually WRITES InputModifier{disableAll} onto the
  // player, so going there and back is the flow that can strand someone with
  // input switched off. Driven through the real key (`) and the real toolbar
  // buttons — page-side state alone never reaches the scene, which owns the
  // camera and the avatar.
  await focusViewport()
  await pressKey('`', 'Backquote', 192)
  await sleep(1500)
  await pressKey('`', 'Backquote', 192)
  await sleep(1500)
  results.push(await tryWalk('walk W after a fly-camera round trip', 'w', 'KeyW', 87))

  // …and after Play → Stop, which reloads the scene into a fresh instance that
  // never saw the earlier set-frozen messages.
  await clickButton('Run the scene')
  await sleep(3000)
  results.push(await tryWalk('walk W while playing', 'w', 'KeyW', 87))
  await clickButton('Restart the scene from tick 0')
  await sleep(9000)
  results.push(await tryWalk('walk W after Play then Stop', 'w', 'KeyW', 87))
  await screenshot('walk-02-after-transitions.png')

  console.log('')
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.label} — ${r.detail}`)
  const ok = results.every((r) => r.ok)
  console.log(`\n${ok ? '✅ the avatar walks while stopped' : '❌ the avatar does NOT walk while stopped'}`)
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
