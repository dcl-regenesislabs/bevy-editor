// Recovery test: deliberately corrupt the engine's IndexedDB, then launch the
// app WITHOUT pre-clearing storage, and assert the boot watchdog detects the
// stall, clears the bad store, reloads, and the editor reaches "ready".
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const CDP = 9438
const PROJECT = process.env.BEVY_EDITOR_PROJECT ?? path.resolve(root, '..', 'towerofmadness')
const SUPPORT = path.join(process.env.HOME, 'Library', 'Application Support', 'bevy-editor-app')
const IDB = path.join(SUPPORT, 'IndexedDB', 'http_localhost_3010.indexeddb.leveldb')

let ws, sess, id = 0
const pending = new Map()
const send = (m, p, s, t = 8000) => new Promise((res, rej) => {
  const i = ++id; const tm = setTimeout(() => rej(new Error('timeout')), t)
  pending.set(i, { res: (r) => { clearTimeout(tm); res(r) }, rej })
  try { ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })) } catch (e) { rej(e) }
})
async function getVersion() {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${CDP}/json/version`); if (r.ok) return r.json() } catch {}; await new Promise(r => setTimeout(r, 1000)) }
  throw new Error('no CDP')
}
async function connect() {
  const v = await getVersion()
  const sock = new WebSocket(v.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 1 << 29 })
  sock.on('message', (raw) => { let m; try { m = JSON.parse(raw) } catch { return } if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) } })
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
  sess = (await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId
}
const ev = async (expr) => {
  try { return (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sess, 8000)).result.value }
  catch { try { await attach() } catch {}; try { return (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sess, 8000)).result.value } catch (e) { return 'ERR:' + e.message } }
}

// ---- corrupt the IndexedDB leveldb so indexedDB.open fails on boot ----
try { execSync(`pkill -f 'remote-debugging-port=${CDP}'`, { stdio: 'ignore' }) } catch {}
for (const port of [8004, 8005]) { try { execSync(`for pid in $(lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null); do kill $pid; done`, { stdio: 'ignore' }) } catch {} }
// ensure the dir exists, then fill every file with garbage (leveldb -> IO error)
fs.mkdirSync(IDB, { recursive: true })
let corrupted = 0
for (const f of fs.readdirSync(IDB)) { try { fs.writeFileSync(path.join(IDB, f), Buffer.from('GARBAGE'.repeat(64))); corrupted++ } catch {} }
// guarantee a broken CURRENT/MANIFEST even if the dir was empty
fs.writeFileSync(path.join(IDB, 'CURRENT'), 'MANIFEST-000999\n')
fs.writeFileSync(path.join(IDB, 'MANIFEST-000999'), Buffer.from('GARBAGE'.repeat(64)))
console.log(`corrupted IndexedDB at ${IDB} (${corrupted} files overwritten + bogus MANIFEST)`)

const caf = spawn('caffeinate', ['-dius'], { stdio: 'ignore' })
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', fs.readFileSync(path.join(root, 'node_modules', 'electron', 'path.txt'), 'utf8').trim())
const mainLog = []
const el = spawn(electronPath, ['.', `--remote-debugging-port=${CDP}`], { cwd: root, env: { ...process.env, BEVY_EDITOR_DEBUG: '1', BEVY_EDITOR_PROJECT: PROJECT }, stdio: ['ignore', 'pipe', 'pipe'] })
el.stdout.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => { mainLog.push(l); if (/⟳|recover|clearing|stalled/i.test(l)) console.log('[main]', l.slice(0, 160)) }))
el.stderr.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => { if (/indexeddb|leveldb|quota/i.test(l)) console.log('[main:err]', l.slice(0, 140)) }))

setTimeout(() => { console.log('WATCHDOG: forcing exit'); try { el.kill('SIGTERM') } catch {}; process.exit(2) }, 150000).unref()

const main = async () => {
  await connect(); await attach()
  let ready = false, sawRecover = false, sawCorruptError = false
  for (let i = 0; i < 26 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const st = await ev(`(() => { const s = window.__eui; return JSON.stringify({ status: s?.status, scene: !!s?.scene, snap: s?.snapshot ? Object.keys(s.snapshot).length : 0 }) })()`)
    sawRecover = sawRecover || mainLog.some((l) => /⟳|clearing corrupt/i.test(l))
    console.log(`[t+${(i + 1) * 5}s] ${st}${sawRecover ? '  (recovery fired)' : ''}`)
    ready = await ev(`window.__eui?.status === 'ready' && !!window.__eui?.scene`) === true
  }
  sawCorruptError = mainLog.some((l) => /indexeddb|leveldb/i.test(l)) || true
  try { el.kill('SIGTERM') } catch {}; try { caf.kill('SIGTERM') } catch {}
  console.log('')
  console.log('reached ready:', ready)
  console.log('recovery fired:', sawRecover)
  const pass = ready && sawRecover
  console.log(pass ? 'RECOVERY TEST PASSED' : 'RECOVERY TEST FAILED')
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.log('TEST ERR', e.message); try { el.kill('SIGTERM') } catch {}; process.exit(1) })
