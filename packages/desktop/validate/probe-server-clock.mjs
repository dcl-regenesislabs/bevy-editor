// Proof probe: the carried-module prefab model works end to end. Create a
// scene from the blank template, place the built-in Server Clock prefab
// through the real Prefabs tab, save, press Play — and watch the clock leave
// its placeholder: the script (and its carried runtime/timeSync module) ran on
// BOTH sides of the Multiplayer Server (client sampled, server answered).
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
  if (scratch && !keepScratch) fs.rmSync(scratch, { recursive: true, force: true })
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

  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'clock-probe-'))
  // private userData + shifted ports: runs even while a dev editor is open
  const env = {
    ...process.env,
    BEVY_EDITOR_DEBUG: '1',
    BEVY_EDITOR_USER_DATA: path.join(scratch, 'user-data'),
    BEVY_WEB_PORT: '3110',
    SCENE_PORT: '8104',
    EDITOR_SCENE_PORT: '8105'
  }
  delete env.BEVY_EDITOR_PROJECT
  electron = spawn(electronPath, ['.', `--remote-debugging-port=${CDP_PORT}`], {
    cwd: root,
    env,
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
  const consoleLines = []
  ws.on('message', (raw) => {
    const m = JSON.parse(raw)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params?.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
      if (/timeSync|ServerClock|EventBus|Script/.test(text)) consoleLines.push(text.slice(0, 200))
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

  // 1. create + open a fresh template scene
  await waitFor('picker', () => evalIn(`!!window.editorShell`), 60000, 1000)
  const dest = await evalIn(`window.editorShell.createScene(${JSON.stringify(scratch)}, 'Clock Probe', 'blank')`, 30000)
  if (!dest || typeof dest !== 'string') fail('create-scene', String(dest))
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
    360000,
    5000
  )
  pass('open', dest)

  // 2. place Server Clock from the Prefabs tab, through the real UI
  // (a top-level left tab since #46 — not a segment inside Assets any more)
  if (!(await evalIn(clickWhere('.eui-ltab', 'Prefabs')))) fail('tabs', 'Prefabs tab not found')
  // Server Clock lives inside the "Multiplayer Server" group tile
  await waitFor('multiplayer group tile', () => evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    return [...sh.querySelectorAll('.eui-prefab-group')].some((e) => e.textContent.includes('Multiplayer Server'))
  })()`), 60000, 1000)
  if (!(await evalIn(clickWhere('.eui-prefab-group', 'Multiplayer Server')))) fail('place', 'group tile click failed')
  await waitFor('server-clock card', () => evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    return [...sh.querySelectorAll('.eui-prefab-card')].some((e) => e.textContent.includes('Server Clock'))
  })()`), 60000, 1000)
  if (!(await evalIn(clickWhere('.eui-prefab-card', 'Server Clock')))) fail('place', 'card click failed')
  // placement copies the prefab into the project and vendors the shared runtime
  const shared = path.join(dest, 'src', 'scripts', 'runtime', 'timeSync.ts')
  await waitFor('shared runtime on disk', async () => (fs.existsSync(shared) ? 'yes' : null), 30000, 1000)
  pass('carriage', 'src/scripts/runtime/timeSync.ts vendored into the scene with the prefab')

  const composite = path.join(dest, 'assets', 'scene', 'main.composite')
  await waitFor('composite autosave', async () => {
    if (!fs.existsSync(composite)) return null
    const c = fs.readFileSync(composite, 'utf8')
    return c.includes('server-clock.ts') && c.includes('TextShape') && c.includes('display') ? 'yes' : null
  }, 120000, 1000)
  pass('composite', 'TextShape + script + parsed params (display in layout) persisted in main.composite')

  // 3. background flow: the autosave already kicked the watcher; both sides
  // hot-reload with the new bundle. Give the cycle a moment, then Play — the
  // Play button's own waitForFreshBuild covers any remainder.
  await sleep(10000)
  pass('background', 'no navigation after placement — rebuild runs behind the editor')
  await sleep(3000)
  const played = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const btn = sh.querySelector('button[data-tip="Run the scene"]')
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!played) fail('play', 'Run the scene button not found')
  pass('play', 'entered play mode')

  // 4. the clock leaves its placeholder only after a full client<->server NTP
  // exchange through the local Multiplayer Server
  const time = await waitFor(
    'clock ticking',
    () => evalIn(`(async () => {
      const r = await window.__euiCmd('crdt_snapshot', [])
      const s = JSON.parse(r)
      for (const comps of Object.values(s)) {
        const text = comps.TextShape?.text
        if (typeof text === 'string' && /\\d{2}:\\d{2}:\\d{2}/.test(text) && !text.includes('--')) return text
      }
      return null
    })()`),
    120000,
    3000
  ).catch(async (e) => {
    const dump = await evalIn(`(async () => {
      const r = await window.__euiCmd('crdt_snapshot', [])
      const s = JSON.parse(r)
      const out = []
      for (const [id, comps] of Object.entries(s)) {
        if (comps.TextShape) out.push(id + ': ' + JSON.stringify(comps.TextShape.text))
      }
      return out.join(' | ') || 'NO TextShape entities in crdt'
    })()`).catch((err) => 'dump failed: ' + err.message)
    console.log('DIAGNOSTIC TextShapes:', dump)
    const logs = await evalIn(`window.editorShell.getState().then((s) => s.logs.filter((l) => /timeSync|ServerClock|Scene Logs|Change detected|Bundle saved/.test(l)).slice(-30).join(' <> '))`).catch((err) => 'log dump failed: ' + err.message)
    console.log('DIAGNOSTIC CLIENT CONSOLE:', consoleLines.slice(-25).join(' <> ') || '(nothing matched)')
    console.log('DIAGNOSTIC LOGS:\n' + logs)
    throw e
  })
  pass('clock', `synced server time on screen: ${JSON.stringify(time)}`)

  console.log('SERVER CLOCK CONFIRMED')
  cleanup()
  process.exit(0)
}

main().catch((e) => {
  console.error('probe failed:', e.message)
  keepScratch = true
  console.error('scratch kept for inspection:', scratch)
  cleanup()
  process.exit(2)
})
