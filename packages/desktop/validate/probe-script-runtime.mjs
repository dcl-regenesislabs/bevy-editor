// Proof probe: boot the editor on a script-bearing scene (BEVY_EDITOR_PROJECT,
// e.g. a scene whose entity 512 carries asset-packs::Script + a spinner script)
// and verify the Script runtime is live in the engine: press Play, then watch
// entity 512's Transform.rotation change in the raw CRDT. Reuses the
// validate.mjs CDP pattern.
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

async function main() {
  const electronDir = [
    path.join(root, 'node_modules', 'electron'),
    path.join(root, '..', '..', 'node_modules', 'electron')
  ].find((d) => fs.existsSync(path.join(d, 'path.txt')))
  const electronPath = path.join(electronDir, 'dist', fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim())
  try {
    execSync(`pkill -f 'remote-debugging-port=${CDP_PORT}'`, { stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 1500))
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

  // wait for the editor to be ready on the spike scene
  await waitFor(
    'editor ready',
    () => evalIn(`(() => { const s = window.__eui; return s && s.status === 'ready' ? (s.scene?.title ?? 'ready') : null })()`),
    240000,
    5000
  )

  const script = await evalIn(
    `(() => { const c = window.__eui.snapshot['512']; return c ? JSON.stringify(c['asset-packs::Script'] ?? null) : 'no-entity' })()`
  )
  console.log('snapshot[512] asset-packs::Script =', script)

  // the edited scene is frozen in edit mode — scripts only tick while playing
  const played = await evalIn(`(() => {
    const sh = document.getElementById('editor-ui-host').shadowRoot
    const btn = sh.querySelector('button[data-tip="Run the scene"]')
    if (!btn) return false
    btn.click()
    return true
  })()`)
  console.log('pressed play:', played)
  await new Promise((r) => setTimeout(r, 5000))

  // read the LIVE engine CRDT directly (bypasses page state)
  const readRot = () =>
    evalIn(
      `(async () => { const r = await window.__euiCmd('crdt_snapshot', []); const s = JSON.parse(r); const c = s['512']; return c && c.Transform ? JSON.stringify(c.Transform.rotation) : null })()`
    )
  const r1 = await readRot()
  await new Promise((r) => setTimeout(r, 3000))
  const r2 = await readRot()
  await new Promise((r) => setTimeout(r, 3000))
  const r3 = await readRot()

  console.log('rotation t0:', r1)
  console.log('rotation t1:', r2)
  console.log('rotation t2:', r3)
  const spinning = r1 !== null && r2 !== null && (r1 !== r2 || r2 !== r3)
  console.log(spinning ? 'SCRIPT RUNTIME CONFIRMED: entity 512 is rotating (update(dt) live)' : 'NO ROTATION OBSERVED')
  electron.kill()
  process.exit(spinning ? 0 : 1)
}

main().catch((e) => {
  console.error('probe failed:', e.message)
  electron?.kill()
  process.exit(2)
})
