// Proof probe: a scene created from the shipped template is a working
// authoritative-multiplayer scene. Boot to the picker, create a scene from the
// blank template via the real shell API, open it, and confirm: scene.json
// carries authoritativeMultiplayer, the pinned SDK is the auth-server build,
// and pressing Play completes a client→server→client registerMessages
// round-trip (the template's multiplayer-check drops a marker entity at a
// magic Y only after the local Multiplayer Server answers its ping).
// Reuses the validate.mjs CDP pattern.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CDP_PORT = 9433
const MARKER_Y = -640.125
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

function cleanup() {
  electron?.kill()
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true })
}

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

  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-probe-'))

  // no BEVY_EDITOR_PROJECT: boot to the picker, like a first launch
  const env = { ...process.env, BEVY_EDITOR_DEBUG: '1' }
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

  const fail = (step, detail) => {
    console.log(`FAIL ${step} — ${detail}`)
    cleanup()
    process.exit(1)
  }
  const pass = (step, detail) => console.log(`PASS ${step}${detail ? ` — ${detail}` : ''}`)

  // 1. picker up, then create a scene from the blank template over the real shell API
  await waitFor('picker', () => evalIn(`!!window.editorShell`), 60000, 1000)
  const dest = await evalIn(
    `window.editorShell.createScene(${JSON.stringify(scratch)}, 'Auth Probe', 'blank')`,
    30000
  )
  if (!dest || typeof dest !== 'string') fail('create-scene', `createScene returned ${JSON.stringify(dest)}`)
  pass('create-scene', dest)

  // 2. the created scene is authoritative + pinned before any build runs
  const sceneJson = JSON.parse(fs.readFileSync(path.join(dest, 'scene.json'), 'utf8'))
  if (sceneJson.authoritativeMultiplayer !== true) fail('scene-flag', 'authoritativeMultiplayer missing from created scene.json')
  const pkg = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'))
  const pin = pkg.devDependencies?.['@dcl/sdk'] ?? ''
  if (!/^\d+\.\d+\.\d+-\d+\.commit-[0-9a-f]+$/.test(pin)) fail('sdk-pin', `not an exact per-commit pin: ${pin}`)
  const lockstep = ['@dcl/sdk', '@dcl/js-runtime', '@dcl/sdk-commands'].every(
    (k) => pkg.devDependencies?.[k] === pin
  )
  if (!lockstep) fail('sdk-pin', `devDependencies not in lockstep: ${JSON.stringify(pkg.devDependencies)}`)
  pass('scene-flag', `authoritativeMultiplayer: true, sdk ${pin}`)

  // 3. open it — this drives npm install + sdk-commands start (which spawns the
  // local Multiplayer Server) before the editor reports ready
  await evalIn(`(window.editorShell.openProject(${JSON.stringify(dest)}), true)`)
  await sleep(3000)
  await attach() // navigation may swap the renderer process
  await waitFor(
    'editor ready',
    async () => {
      // re-attach defensively: openProject reloads the page at least once
      try {
        return await evalIn(`(() => { const s = window.__eui; return s && s.status === 'ready' ? 'ready' : null })()`)
      } catch {
        await attach().catch(() => {})
        return null
      }
    },
    360000, // first open npm-installs the scene: allow for a cold cache
    5000
  )
  pass('open', 'editor ready on the created scene')

  // 4. Play: unfreeze the scene so the client half of multiplayer-check ticks
  const played = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const btn = sh.querySelector('button[data-tip="Run the scene"]')
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!played) fail('play', 'Run the scene button not found')
  pass('play', 'entered play mode')

  // 5. the marker entity appears only after ping→server→pong completed through
  // the local auth server — scan the live CRDT for the magic Y
  const marker = await waitFor(
    'multiplayer round-trip marker',
    () =>
      evalIn(
        `(async () => {
          const r = await window.__euiCmd('crdt_snapshot', [])
          const s = JSON.parse(r)
          for (const [id, comps] of Object.entries(s)) {
            const y = comps?.Transform?.position?.y
            if (typeof y === 'number' && Math.abs(y - ${MARKER_Y}) < 0.001) return id
          }
          return null
        })()`
      ),
    90000,
    3000
  )
  pass('round-trip', `marker entity ${marker} at y=${MARKER_Y} — isServer() ping/pong through the local Multiplayer Server confirmed`)

  console.log('AUTH-SERVER TEMPLATE CONFIRMED')
  cleanup()
  process.exit(0)
}

main().catch((e) => {
  console.error('probe failed:', e.message)
  cleanup()
  process.exit(2)
})
