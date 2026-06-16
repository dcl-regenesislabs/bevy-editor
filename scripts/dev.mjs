// Dev mode: edit → save → the app reloads itself.
//
// Wires the human inner loop the one-shot `npm start` lacks:
//   1. build the UI bundles + desktop main once (so the app has something to load)
//   2. start the UI esbuild watcher (rebuilds editor-{app,ui}.js on every save)
//   3. launch the desktop app with DEV=1 — its main process watches the web dir
//      and reloads the window when a bundle changes (see main.ts)
//
// The editor SCENE is already watched+rebuilt by its `sdk-commands start` server
// (spawned by the app); a window reload re-fetches it too. Engine reboots on
// reload (a few seconds) — the accepted dev tradeoff. Ctrl+C stops everything.
//
// Usage: `npm run dev` (from the monorepo root).
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const run = (args, opts = {}) => spawnSync('npm', args, { cwd: root, stdio: 'inherit', shell: false, ...opts })

// 1. initial build (UI bundles + desktop main; the scene is built by its server)
console.log('\n▶ dev: initial build (ui + desktop main)…')
if (run(['run', 'build', '-w', '@dcl-editor/ui']).status !== 0) process.exit(1)
if (run(['run', 'build:main', '-w', '@dcl-editor/desktop']).status !== 0) process.exit(1)

const children = []
const stop = () => {
  for (const c of children) {
    try {
      c.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
}
process.on('SIGINT', () => {
  stop()
  process.exit(0)
})
process.on('exit', stop)

// 2. UI watcher — rebuilds the bundles on change
console.log('▶ dev: starting UI watcher…')
children.push(spawn('npm', ['run', 'watch', '-w', '@dcl-editor/ui'], { cwd: root, stdio: 'inherit', shell: false }))

// 3. launch the app with auto-reload on
console.log('▶ dev: launching desktop app (DEV=1, auto-reload on bundle change)\n')
const app = spawn('npm', ['run', 'app', '-w', '@dcl-editor/desktop'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, DEV: '1' }
})
children.push(app)
// when the app window closes, tear the whole dev session down
app.on('exit', () => {
  stop()
  process.exit(0)
})
