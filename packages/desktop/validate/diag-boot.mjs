// Boot diagnostic: launch the app, capture main-process logs (scene servers) AND
// page console, then probe the host/engine/scene state every few seconds to find
// exactly where boot stalls (engine console, bus handshake, or scene autoLogin).
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const CDP = 9436
const PROJECT = process.env.BEVY_EDITOR_PROJECT ?? path.resolve(root, '..', 'towerofmadness')

let ws, sess, id = 0
const pending = new Map()
const send = (m, p, s, t = 8000) => new Promise((res, rej) => {
  const i = ++id; const tm = setTimeout(() => rej(new Error('timeout')), t)
  pending.set(i, { res: (r) => { clearTimeout(tm); res(r) }, rej })
  try { ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })) } catch (e) { rej(e) }
})
async function getVersion() {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${CDP}/json/version`); if (r.ok) return r.json() } catch {} ; await new Promise(r => setTimeout(r, 1000)) }
  throw new Error('no CDP')
}
async function connect() {
  const v = await getVersion()
  const sock = new WebSocket(v.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 1 << 29 })
  sock.on('message', (raw) => {
    let m; try { m = JSON.parse(raw) } catch { return }
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return }
    if (m.method === 'Runtime.consoleAPICalled') {
      const txt = (m.params.args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description ?? a.type)).join(' ').slice(0, 220)
      if (/login|player|guest|scene-ready|boot|inspector|engine|error|fail|snapshot/i.test(txt)) console.log('  [console]', txt)
    }
  })
  sock.on('close', () => { for (const [, { rej }] of pending) rej(new Error('closed')); pending.clear() })
  sock.on('error', () => {})
  await new Promise((res, rej) => { sock.once('open', res); sock.once('error', rej) })
  ws = sock
}
async function attach() {
  if (!ws || ws.readyState !== WebSocket.OPEN) await connect()
  const { targetInfos } = await send('Target.getTargets', {})
  const page = targetInfos.find((t) => t.type === 'page' && t.url.includes('editor-app'))
  if (!page) throw new Error('no page')
  const a = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
  sess = a.sessionId
  await send('Runtime.enable', {}, sess).catch(() => {})
  return page.url
}
const ev = async (expr) => {
  try { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sess, 8000); return r.result.value }
  catch { try { await attach() } catch {}; try { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sess, 8000); return r.result.value } catch (e) { return 'ERR:' + e.message } }
}

const caf = spawn('caffeinate', ['-dius'], { stdio: 'ignore' })
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', fs.readFileSync(path.join(root, 'node_modules', 'electron', 'path.txt'), 'utf8').trim())
try { execSync(`pkill -f 'remote-debugging-port=${CDP}'`, { stdio: 'ignore' }) } catch {}
for (const port of [8004, 8005]) { try { execSync(`for pid in $(lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null); do kill $pid; done`, { stdio: 'ignore' }) } catch {} }
try { fs.rmSync(path.join(process.env.HOME, 'Library', 'Application Support', 'bevy-editor-app', 'Service Worker'), { recursive: true, force: true }) } catch {}

const el = spawn(electronPath, ['.', `--remote-debugging-port=${CDP}`], { cwd: root, env: { ...process.env, BEVY_EDITOR_DEBUG: '1', BEVY_EDITOR_PROJECT: PROJECT }, stdio: ['ignore', 'pipe', 'pipe'] })
// main-process stdout carries the scene-server / build logs (onLog -> log -> console)
el.stdout.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => console.log('[main]', l.slice(0, 200))))
el.stderr.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => console.log('[main:err]', l.slice(0, 200))))

await connect()
// capture page console
await attach()
ws.on('message', () => {}) // ensure handler exists
await send('Log.enable', {}, sess).catch(() => {})
await send('Runtime.enable', {}, sess).catch(() => {})

const main = async () => {
  for (let i = 0; i < 26; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const url = await attach().catch((e) => 'attach-err:' + e.message)
    const probe = await ev(`(() => {
      const s = window.__eui
      const f = document.getElementById('editor-ui-host')?.shadowRoot?.querySelector('iframe')
      const w = f && f.contentWindow
      let engineReady = false, hasConsole = false
      try { hasConsole = !!(w && w.engine_console_command) } catch {}
      try { engineReady = !!(window.__editorBootPhase) } catch {}
      return JSON.stringify({
        hostStatus: s?.status, scene: !!s?.scene, snap: s?.snapshot ? Object.keys(s.snapshot).length : 0,
        bootPhase: (typeof window.getBootPhase === 'function' ? window.getBootPhase() : (window.__bootPhase ?? '?')),
        iframe: !!f, hasConsole
      })
    })()`)
    console.log(`[t+${(i + 1) * 5}s] url=${typeof url === 'string' ? url.split('?')[0].slice(-30) : url} ${probe}`)
    // once the engine console is reachable, ask the SCENE itself for /help + a known editor command to see if the scene bundle is alive
    if (i === 6) {
      const sceneProbe = await ev(`(async () => {
        try {
          const f = document.getElementById('editor-ui-host').shadowRoot.querySelector('iframe')
          const w = f.contentWindow
          const help = await Promise.race([w.engine_console_command('/help'), new Promise((r) => setTimeout(() => r('HELP-TIMEOUT'), 5000))])
          return 'help.len=' + (typeof help === 'string' ? help.length : typeof help)
        } catch (e) { return 'scene-probe-err:' + e.message }
      })()`)
      console.log('  >> engine console:', sceneProbe)
    }
  }
  try { el.kill('SIGTERM') } catch {}; try { caf.kill('SIGTERM') } catch {}
  process.exit(0)
}
main().catch((e) => { console.log('DIAG ERR', e.message); try { el.kill('SIGTERM') } catch {}; process.exit(1) })
