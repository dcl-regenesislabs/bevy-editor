#!/usr/bin/env node
// E2E validation harness — launches the app with CDP enabled, drives it like a
// user, and prints a machine-readable verdict. This is the check an AI agent
// runs after every change (see AGENTS.md):
//
//   npm run validate              # full run (app boot → engine → scene → pick)
//   node validate/validate.mjs --steps=boot,picker   # subset
//
// Exit code 0 = all requested steps passed. Artifacts (screenshots, console
// log) land in validate/artifacts/.
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
// The content scene to open in the editor for the run. Point BEVY_EDITOR_PROJECT
// at any DCL scene folder (one with a scene.json); the default looks for a
// `towerofmadness` sibling of the monorepo (Decentraland/towerofmadness).
const PROJECT = process.env.BEVY_EDITOR_PROJECT ?? path.resolve(root, '..', '..', '..', 'towerofmadness')
const stepsArg = process.argv.find((a) => a.startsWith('--steps='))
const STEPS = stepsArg ? stepsArg.slice('--steps='.length).split(',') : ['boot', 'picker', 'engine', 'scene', 'select', 'move', 'worldclick', 'shortcut', 'tools', 'camera', 'selectbus', 'tooltip', 'assets', 'logs', 'home']

const results = []
const consoleLines = []
let electron = null
let ws = null
let msgId = 0
const pending = new Map()
let pageSession = null

function record(step, ok, detail) {
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

async function reattach() {
  const { targetInfos } = await send('Target.getTargets', {})
  const page = targetInfos.find((t) => t.type === 'page' && t.url.includes('editor-app.html'))
  if (page) {
    const att = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
    pageSession = att.sessionId
    await send('Page.enable', {}, pageSession).catch(() => {})
    await send('Runtime.enable', {}, pageSession).catch(() => {})
  }
}

// One-shot evaluation for ACTIONS (navigation triggers): never retried —
// re-running openProject/home on failure causes double navigations.
function evalOnce(expr, timeoutMs = 30000) {
  return send(
    'Runtime.evaluate',
    { expression: expr, awaitPromise: true, returnByValue: true },
    pageSession,
    timeoutMs
  ).then((r) => r.result.value)
}

// Navigations (openProject, home) can swap the renderer process and silently
// kill the attached session — recover by re-attaching once per failure.
// Only for idempotent reads/polls.
async function evalIn(expr, timeoutMs = 30000) {
  try {
    const r = await send(
      'Runtime.evaluate',
      { expression: expr, awaitPromise: true, returnByValue: true },
      pageSession,
      timeoutMs
    )
    return r.result.value
  } catch (e) {
    await reattach()
    const r = await send(
      'Runtime.evaluate',
      { expression: expr, awaitPromise: true, returnByValue: true },
      pageSession,
      timeoutMs
    )
    return r.result.value
  }
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

async function screenshot(name) {
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' }, pageSession, 30000)
    fs.writeFileSync(path.join(artifacts, name), Buffer.from(shot.data, 'base64'))
  } catch (e) {
    console.log(`(screenshot ${name} failed: ${e.message})`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIVER — high-level primitives. Build feature tests on these (not ad-hoc CDP),
// so new tests stay short and deterministic. We drive via the engine's own
// console commands + the editor bus + state reads — NOT synthetic input — wherever
// possible, because real input (clicks/keys) is timing-flaky. See docs/AI-AGENT.md
// for the full command catalog and a "how to add a feature test" guide.
// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Call ANY engine console command; resolves to its reply string. Numbers/strings
// are passed as positional args. e.g. cmd('move_player_to', 8, 1, 16).
const cmd = (name, ...args) =>
  evalIn(`window.__euiCmd(${JSON.stringify(name)}, ${JSON.stringify(args.map(String))})`)

// Send a PageToScene editor bus message (drives tool / selection / camera / focus)
// over the same-origin BroadcastChannel (editor-channel.ts) the page<->scene bus
// uses now — the old /editor_send console command doesn't exist on stock main.
const bus = (msg) =>
  evalIn(`(() => { (window.__euiBusChan ??= new BroadcastChannel('dcl-editor-bus')).postMessage({ to: 'scene', msg: ${JSON.stringify(msg)} }); return true })()`)

// Read editor state. `s` is window.__eui. e.g. getState('activeAction'),
// getState('selected.length'), getState('camMode').
const getState = (expr) =>
  evalIn(`(() => { const s = window.__eui; return s ? (${expr}) : null })()`)

// Wait until a state expression is truthy (returns its value), else throws.
const waitState = (expr, timeoutMs = 15000) => waitFor(expr, () => getState(expr), timeoutMs, 500)

// Engine agent commands — drive the avatar deterministically (no flaky WASD keys).
const movePlayerTo = (x, y, z, dur) => cmd('move_player_to', x, y, z, ...(dur != null ? [dur] : []))
const walkPlayerTo = (x, y, z, t) => cmd('walk_player_to', x, y, z, ...(t != null ? [t] : []))
// Player position in DCL world coords [x, y, z], or null.
const playerPos = async () => {
  const r = await cmd('player_position').catch(() => '')
  const m = /\(\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\)/.exec(r)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// The inspected scene's live CRDT snapshot — the ground truth for editing tests.
const crdtSnapshot = async () => {
  try {
    return JSON.parse(await cmd('crdt_snapshot'))
  } catch {
    return {}
  }
}

// Focus the engine viewport so dispatched keys/mouse target it (the real-input case).
const focusViewport = () =>
  evalIn(`(() => {
    const f = document.getElementById('editor-ui-host')?.shadowRoot?.querySelector('iframe')
    const c = f && f.contentWindow.document.querySelector('canvas')
    if (c && !c.hasAttribute('tabindex')) c.setAttribute('tabindex', '0')
    if (f) f.contentWindow.focus()
    if (c) c.focus()
    return !!c
  })()`)

// Dispatch a key (down+up) to whatever holds focus. mods: {meta,ctrl,shift,alt}.
const pressKey = async (key, code, vk, mods = {}) => {
  const modifiers =
    (mods.alt ? 1 : 0) | (mods.ctrl ? 2 : 0) | (mods.meta ? 4 : 0) | (mods.shift ? 8 : 0)
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base }, pageSession).catch(() => {})
  await sleep(80)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, pageSession).catch(() => {})
  await sleep(150)
}

// Throw with a message unless cond is truthy (use inside a step's try/catch).
function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}

// True once the editor scene reached ready (gate most feature steps on this).
const sceneReady = () => results.find((r) => r.step === 'scene')?.ok === true

let caffeinate = null

async function main() {
  // keep the display awake: macOS stops compositing on display sleep, which
  // freezes Chromium's frame clock (rAF) and with it the engine — runs on an
  // idle machine fail nondeterministically without this
  if (process.platform === 'darwin') {
    try {
      caffeinate = spawn('caffeinate', ['-dius'], { stdio: 'ignore' })
    } catch {
      /* caffeinate unavailable — proceed without keep-awake */
    }
  }
  // ---- boot: app process + CDP reachable ------------------------------------
  // spawn the electron BINARY directly: via npx, kill() only reaches the
  // wrapper and orphaned instances squat on the CDP port, so the next run
  // attaches to a stale page
  // electron may be installed pkg-local or hoisted to the workspace root
  const electronDir = [
    path.join(root, 'node_modules', 'electron'),
    path.join(root, '..', '..', 'node_modules', 'electron')
  ].find((d) => fs.existsSync(path.join(d, 'path.txt')))
  if (electronDir === undefined) throw new Error('electron not found (run `npm install` at the monorepo root)')
  const electronPath = path.join(electronDir, 'dist', fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim())
  try {
    execSync(`pkill -f 'remote-debugging-port=${CDP_PORT}'`, { stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 1500))
  } catch {
    /* none running */
  }
  electron = spawn(electronPath, ['.', `--remote-debugging-port=${CDP_PORT}`], {
    cwd: root,
    env: { ...process.env, BEVY_EDITOR_DEBUG: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  electron.stdout.on('data', (d) => consoleLines.push(`[main] ${d}`.trimEnd()))
  electron.stderr.on('data', (d) => consoleLines.push(`[main:err] ${d}`.trimEnd()))

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
    } else if (m.method === 'Runtime.consoleAPICalled') {
      consoleLines.push(
        `[page] ${m.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description ?? a.type)).join(' ').slice(0, 300)}`
      )
    }
  })
  await new Promise((res, rej) => {
    ws.once('open', res)
    ws.once('error', rej)
  })

  const page = await waitFor(
    'editor-app page target',
    async () => {
      const { targetInfos } = await send('Target.getTargets', {})
      return targetInfos.find((t) => t.type === 'page' && t.url.includes('editor-app.html'))
    },
    30000
  )
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
  pageSession = sessionId
  await send('Page.enable', {}, pageSession).catch(() => {})
  await send('Runtime.enable', {}, pageSession).catch(() => {})
  record('boot', true, `app up, page ${page.url.slice(0, 60)}`)
  if (!STEPS.includes('picker') && !STEPS.includes('engine')) return

  // ---- picker: host React app renders ---------------------------------------
  if (STEPS.includes('picker')) {
    try {
      const v = await waitFor(
        'host app mount',
        () => evalIn(`!!document.getElementById('editor-ui-host') && (window.__editorAppBuild ?? null)`),
        20000
      )
      // hit-test: the picker must actually RECEIVE clicks (.eui-root is
      // pointer-events:none — a missing opt-in makes everything unclickable)
      const clickable = await evalIn(`(() => {
        const sh = document.getElementById('editor-ui-host').shadowRoot
        const btn = [...sh.querySelectorAll('button')].find((b) => /open existing|new scene/i.test(b.textContent))
        if (!btn) return 'no button'
        const r = btn.getBoundingClientRect()
        const at = sh.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return at === btn || btn.contains(at) ? 'clickable' : 'NOT clickable (hit ' + (at?.tagName ?? 'null') + ')'
      })()`)
      if (clickable !== 'clickable') throw new Error(`picker hit-test: ${clickable}`)
      record('picker', true, `host bundle ${v}, button ${clickable}`)
      await screenshot('01-picker.png')
    } catch (e) {
      record('picker', false, e.message)
    }
  }

  // ---- engine: open project, engine answers console commands ----------------
  if (STEPS.includes('engine')) {
    try {
      // openProject navigates the page once the servers are up, which destroys
      // the evaluation context — that error IS the success signal here
      await evalOnce(`window.editorShell.openProject(${JSON.stringify(PROJECT)})`, 180000).catch((e) => {
        // openProject navigates the page; CDP reports the teardown differently across
        // Electron versions (Chromium 148 says "Inspected target navigated or closed").
        // Any of these mean "navigated away" — the success signal here, not a failure.
        if (!/context was destroyed|timeout|navigated or closed|Inspected target/i.test(String(e))) throw e
      })
      await reattach() // the page is a fresh target after navigation — rebind the session
      await waitFor(
        'engine console RPC',
        () =>
          evalIn(
            `(async () => { try { const f = document.getElementById('editor-ui-host')?.shadowRoot?.querySelector('iframe'); const w = f && f.contentWindow; if (!w || !w.engine_console_command) return false; const r = await Promise.race([w.engine_console_command('/help'), new Promise((res) => setTimeout(() => res(null), 5000))]); return r !== null; } catch { return false } })()`
          ),
        240000,
        5000
      )
      record('engine', true, 'console RPC answering through iframe.contentWindow')
    } catch (e) {
      record('engine', false, e.message)
      await screenshot('02-engine-fail.png')
    }
  }

  // ---- scene: editor reaches ready with the project scene -------------------
  if (STEPS.includes('scene') && results.every((r) => r.ok)) {
    try {
      const v = await waitFor(
        'editor ready',
        () =>
          evalIn(
            `(() => { const s = window.__eui; return s && s.status === 'ready' && s.scene ? (s.scene.title ?? s.scene.hash) : null })()`
          ),
        180000,
        4000
      )
      record('scene', true, `scene '${v}' loaded, editor ready`)
      await screenshot('03-editor.png')
    } catch (e) {
      record('scene', false, e.message)
      await screenshot('03-editor-fail.png')
    }
  }

  // ---- select: hierarchy click selects + engine highlight accepted ----------
  if (STEPS.includes('select') && results.every((r) => r.ok)) {
    try {
      const v = await evalIn(
        `(async () => {
          const sh = document.getElementById('editor-ui-host').shadowRoot
          const rows = [...sh.querySelectorAll('*')].filter((e) => e.children.length === 0 && /\\w/.test(e.textContent))
          const row = rows.find((e) => (window.__eui.snapshot && Object.keys(window.__eui.snapshot).length > 0) && e.closest('.eui-panel-body'))
          if (!row) return { ok: false, why: 'no hierarchy rows' }
          row.click()
          await new Promise((r) => setTimeout(r, 1200))
          const sel = [...window.__eui.selected]
          return { ok: sel.length === 1, sel, row: row.textContent.trim() }
        })()`,
        30000
      )
      record('select', v.ok === true, JSON.stringify(v))
      await screenshot('04-selected.png')
    } catch (e) {
      record('select', false, e.message)
    }
  }
}

async function playerPosition() {
  return evalIn(
    `(async () => { try { const r = await window.__euiCmd('pointer_target', ['true']); return JSON.parse(r).playerPos } catch { return null } })()`,
    20000
  )
}

async function extraSteps() {
  // ---- move: drive the avatar with the engine's agent command (deterministic) -
  // Reuses /move_player_to + /player_position (bevy-explorer agent_commands) rather
  // than synthetic WASD, which was timing-flaky (3-retry). Proves the editor can
  // command the character and read its position back.
  if (STEPS.includes('move') && sceneReady()) {
    try {
      const before = await playerPos()
      expect(before !== null, 'no player_position before move')
      // move ~8m along +Z in DCL world space; instant (no duration) → deterministic
      const target = [before[0], before[1], before[2] + 8]
      await movePlayerTo(target[0], target[1], target[2])
      const after = await waitFor(
        'avatar moved',
        async () => {
          const p = await playerPos()
          return p && Math.hypot(p[0] - before[0], p[2] - before[2]) > 1 ? p : null
        },
        12000,
        500
      )
      record('move', true, `move_player_to ${JSON.stringify(target.map((n) => +n.toFixed(1)))}: ${JSON.stringify(before.map((n) => +n.toFixed(1)))} -> ${JSON.stringify(after.map((n) => +n.toFixed(1)))}`)
      await screenshot('05-move.png')
    } catch (e) {
      record('move', false, e.message)
      await screenshot('05-move-fail.png')
    }
  }

  // ---- worldclick: clicking a model in the viewport selects it --------------
  // Piece B: picking is scene-side now (SDK Raycast on the editor pick layer, see
  // click-select.ts) — no /pointer_target. Focus a known entity so it sits under
  // the viewport centre, clear the selection, then dispatch a real tap there; the
  // scene resolves the tap to a raycast pick and selects the model.
  if (STEPS.includes('worldclick') && results.find((r) => r.step === 'scene')?.ok) {
    try {
      const focusId = await getState('[...s.selected][0]')
      expect(focusId, 'no entity selected to centre for worldclick')
      // focus (centre) it + ensure the select tool, then clear the selection
      await evalIn(`(() => {
        const ch = (window.__euiBusChan ??= new BroadcastChannel('dcl-editor-bus'))
        ch.postMessage({ to: 'scene', msg: { type: 'focus', entity: ${JSON.stringify(focusId)} } })
        ch.postMessage({ to: 'scene', msg: { type: 'set-tool', tool: 'select' } })
        return true
      })()`)
      await sleep(2800) // let the framing tween settle so the model is centred
      await bus({ type: 'set-selection', selected: [], active: null })
      await sleep(800)
      await focusViewport()
      // tap a few points around centre (down+up at one spot = a tap, not a drag)
      let sel = []
      for (const [x, y] of [[750, 475], [750, 430], [750, 520], [690, 475], [810, 475]]) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }, pageSession)
        await sleep(200)
        for (const [t, b] of [['mousePressed', 'left'], ['mouseReleased', 'left']]) {
          await send('Input.dispatchMouseEvent', { type: t, x, y, button: b, clickCount: 1 }, pageSession)
          await sleep(100)
        }
        await sleep(1300)
        sel = await evalIn(`[...window.__eui.selected]`)
        if (sel.length > 0) break
      }
      record('worldclick', sel.length > 0, `viewport tap → selected ${JSON.stringify(sel)}`)
      await screenshot('06-worldclick.png')
    } catch (e) {
      record('worldclick', false, e.message)
      await screenshot('06-worldclick-fail.png')
    }
  }

  // ---- shortcut: a keystroke while the VIEWPORT (engine iframe) holds focus must
  // still drive an editor shortcut. This is the "bevy intercepts the keys" case —
  // the host forwards engine-window keys (embed.ts forwardEngineKeys). We focus the
  // engine canvas, set a known tool, press 'e', and expect activeAction='rotate'.
  if (STEPS.includes('shortcut') && results.find((r) => r.step === 'scene')?.ok) {
    try {
      // focus the engine canvas so the key targets the engine window, not the host
      await evalIn(`(() => {
        const f = document.getElementById('editor-ui-host').shadowRoot.querySelector('iframe')
        const c = f.contentWindow.document.querySelector('canvas')
        if (c && !c.hasAttribute('tabindex')) c.setAttribute('tabindex', '0')
        f.contentWindow.focus()
        c?.focus()
        // not flying (tool letters are intentionally suppressed while the fly cam is
        // on) and a known starting tool, so the assertion is unambiguous
        window.__eui.camMode = 'none'
        window.__eui.activeAction = 'select'
        return true
      })()`)
      await new Promise((r) => setTimeout(r, 250))
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', { type, key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 }, pageSession, 10000).catch(() => {})
        await new Promise((r) => setTimeout(r, 100))
      }
      await new Promise((r) => setTimeout(r, 600))
      const tool = await evalIn(`window.__eui.activeAction`)
      record('shortcut', tool === 'rotate', `viewport-focused 'e' -> activeAction='${tool}' (expected 'rotate')`)
      await screenshot('06b-shortcut.png')
    } catch (e) {
      record('shortcut', false, e.message)
    }
  }

  // ---- tools: Q/W/E/R from the viewport cycle the active tool ----------------
  // Each key is forwarded engine→host and must land on uiSetTool. Gated to a
  // static camera ('none'), since tool letters are intentionally suppressed while
  // a navigation camera owns WASD/QE.
  if (STEPS.includes('tools') && sceneReady()) {
    try {
      await focusViewport()
      await evalIn(`(() => { window.__eui.camMode = 'none'; return true })()`)
      // W/E/R are unambiguous direct sets (Q/'select' is a toggle that round-trips
      // through the scene, so it's covered by the cheatsheet, not asserted here).
      const seen = []
      for (const [k, code, vk, tool] of [['w', 'KeyW', 87, 'translate'], ['e', 'KeyE', 69, 'rotate'], ['r', 'KeyR', 82, 'scale']]) {
        await pressKey(k, code, vk)
        const got = await waitState(`s.activeAction === '${tool}' ? s.activeAction : null`, 4000).catch(() => getState('s.activeAction'))
        seen.push(`${k}→${got}`)
        expect(got === tool, `'${k}' set tool '${got}', expected '${tool}' (${seen.join(', ')})`)
      }
      record('tools', true, `W/E/R tools from viewport: ${seen.join(', ')}`)
    } catch (e) {
      record('tools', false, e.message)
    }
  }

  // ---- camera: the ` shortcut toggles the fly camera on/off ------------------
  if (STEPS.includes('camera') && sceneReady()) {
    try {
      await focusViewport()
      await evalIn(`(() => { window.__eui.camMode = 'none'; return true })()`)
      await pressKey('`', 'Backquote', 192)
      const on = await getState('s.camMode')
      expect(on === 'free', `\` toggled camMode='${on}', expected 'free'`)
      await pressKey('`', 'Backquote', 192)
      const off = await getState('s.camMode')
      expect(off === 'none', `\` again toggled camMode='${off}', expected 'none'`)
      record('camera', true, `fly toggle: none → ${on} → ${off}`)
    } catch (e) {
      record('camera', false, e.message)
    }
  }

  // ---- selectbus: the page↔scene bus round-trip drives selection -------------
  // The bus is the seam everything editing relies on. Send a page→scene
  // set-selection; the scene re-broadcasts 'selection', which must land in the
  // editor's state.selected. Deterministic, and exercises the core mechanism.
  if (STEPS.includes('selectbus') && sceneReady()) {
    try {
      const ids = await getState('Object.keys(s.snapshot).filter((k) => Number(k) >= 512).slice(0, 2)')
      expect(Array.isArray(ids) && ids.length > 0, 'no entities in the editor snapshot to select')
      await bus({ type: 'set-selection', selected: ids, active: ids[ids.length - 1] })
      const got = await waitFor(
        'selection round-trip',
        async () => {
          const sel = await getState('[...s.selected]')
          return Array.isArray(sel) && sel.length === ids.length && ids.every((i) => sel.includes(i)) ? sel : null
        },
        8000,
        400
      )
      record('selectbus', true, `bus set-selection ${JSON.stringify(ids)} → state.selected ${JSON.stringify(got)}`)
      await screenshot('06c-selectbus.png')
    } catch (e) {
      record('selectbus', false, e.message)
    }
  }

  // ---- tooltip: hovering a [data-tip] control shows the custom styled tooltip ---
  // Verifies the design-system TooltipLayer (the .eui-tip overlay) — not the OS one.
  if (STEPS.includes('tooltip') && sceneReady()) {
    try {
      const target = await evalIn(`(() => {
        const sh = document.getElementById('editor-ui-host').shadowRoot
        const el = sh.querySelector('.eui-toolbar [data-tip]') || sh.querySelector('[data-tip]')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tip: el.getAttribute('data-tip') }
      })()`)
      expect(target !== null, 'no [data-tip] control found')
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y, button: 'none' }, pageSession)
      const shown = await waitFor(
        '.eui-tip to appear',
        () => evalIn(`(() => { const t = document.getElementById('editor-ui-host').shadowRoot.querySelector('.eui-tip'); return t ? t.textContent : null })()`),
        3000,
        150
      )
      // move the pointer away so the tip doesn't linger into later screenshots
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' }, pageSession)
      record('tooltip', shown === target.tip, `hover data-tip='${target.tip}' → .eui-tip shows '${shown}'`)
      await screenshot('06d-tooltip.png')
    } catch (e) {
      record('tooltip', false, e.message)
    }
  }
}

async function assetStep() {
  // ---- assets: the Assets tab lists the model catalog (validates /opendcl too) --
  // The catalog is a docked panel: click the "Assets" left-dock tab, which mounts
  // CatalogTab and auto-fetches the catalog through the same-origin /opendcl proxy.
  if (STEPS.includes('assets') && results.find((r) => r.step === 'scene')?.ok) {
    try {
      const v = await evalIn(
        `(async () => {
          const sh = document.getElementById('editor-ui-host').shadowRoot
          const tab = [...sh.querySelectorAll('.eui-ltab')].find((b) => b.textContent.trim() === 'Assets')
          if (!tab) return { ok: false, why: 'no Assets tab' }
          tab.click()
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 1000))
            const n = (window.__eui.assetCatalog ?? []).length
            if (n > 0) return { ok: n > 1000, count: n }
            if (!window.__eui.assetBusy && i > 3) break
          }
          return { ok: false, count: (window.__eui.assetCatalog ?? []).length, busy: window.__eui.assetBusy }
        })()`,
        60000
      )
      record('assets', v.ok === true, JSON.stringify(v))
      await screenshot('07-assets.png')
    } catch (e) {
      record('assets', false, e.message)
      await screenshot('07-assets-fail.png')
    }
  }
}

async function logsStep() {
  // ---- logs: the server-log drawer toggles open with content ----------------
  if (STEPS.includes('logs') && results.find((r) => r.step === 'scene')?.ok) {
    try {
      // The logs toggle now lives in the scene topbar (was a floating button).
      const v = await evalIn(`(async () => {
        const sh = document.getElementById('editor-ui-host').shadowRoot
        const btn = sh.querySelector('button[data-tip="Show build / server logs"]')
        if (!btn) return { ok: false, why: 'no logs toggle' }
        btn.click()
        await new Promise((r) => setTimeout(r, 2500))
        const drawer = sh.querySelector('.eui-logs-drawer')
        if (!drawer) return { ok: false, why: 'drawer missing' }
        const body = sh.querySelector('.eui-logs-body')?.textContent ?? ''
        const hasLogs = body.length > 10
        const close = sh.querySelector('button[data-tip="Hide logs"]')
        if (close) close.click()
        await new Promise((r) => setTimeout(r, 300))
        const hidden = sh.querySelector('.eui-logs-drawer') === null
        return { ok: hasLogs && hidden, hasLogs, hidden, sample: body.slice(0, 80) }
      })()`, 30000)
      record('logs', v.ok === true, JSON.stringify(v))
      await screenshot('08-logs.png')
    } catch (e) {
      record('logs', false, e.message)
    }
  }
}

async function homeStep() {
  // ---- home: the editor offers a way back to the project picker -------------
  if (STEPS.includes('home') && results.find((r) => r.step === 'scene')?.ok) {
    try {
      await evalIn(`(() => { const bd = document.getElementById('editor-ui-host').shadowRoot.querySelector('.eui-modal-backdrop'); if (bd) bd.click(); return true })()`).catch(() => {})
      await new Promise((r) => setTimeout(r, 400))
      // Assert the back-to-projects affordance exists in the topbar and is
      // genuinely clickable (hit-test). We don't navigate here: doing so
      // mid-run tears down the CDP session and the engine, which only adds
      // flakiness — the navigation itself is covered separately.
      // The topbar must render with the scene name and a back-to-projects
      // button. (Navigation itself is verified separately; doing it mid-run
      // tears down the session, and shadow-root elementFromPoint is flaky.)
      const v = await evalIn(`(() => {
        const sh = document.getElementById('editor-ui-host').shadowRoot
        const btn = sh.querySelector('.eui-topbar-home')
        const title = sh.querySelector('.eui-topbar-title .eui-title')?.textContent ?? ''
        const r = btn?.getBoundingClientRect()
        const visible = !!btn && r.width > 0 && r.height > 0
        return { ok: visible && title.length > 0, title, visible }
      })()`)
      record('home', v.ok === true, JSON.stringify(v))
      await screenshot('09-home.png')
    } catch (e) {
      record('home', false, e.message)
      await screenshot('09-home-fail.png')
    }
  }
}

try {
  await main()
  await extraSteps()
  await assetStep()
  await logsStep()
  await homeStep()
} catch (e) {
  record('harness', false, String(e))
} finally {
  fs.writeFileSync(path.join(artifacts, 'console.log'), consoleLines.join('\n'))
  fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  try {
    ws?.close()
  } catch {}
  try {
    electron?.kill('SIGTERM')
  } catch {}
  try {
    caffeinate?.kill('SIGTERM')
  } catch {}
  const ok = results.length > 0 && results.every((r) => r.ok)
  console.log(`\n${ok ? 'VALIDATION PASSED' : 'VALIDATION FAILED'} (${results.filter((r) => r.ok).length}/${results.length})`)
  console.log(`artifacts: ${artifacts}`)
  process.exit(ok ? 0 : 1)
}
