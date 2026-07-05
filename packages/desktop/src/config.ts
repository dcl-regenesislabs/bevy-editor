// App configuration: where the bevy web build and the editor system scene live,
// and which ports the local stack uses. Persisted to userData/config.json;
// every value can be overridden there or via environment variables.
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export interface AppConfig {
  /** static bevy web build (deploy/web with engine/pkg inside) — the EXTERNAL engine */
  bevyWebDir: string
  /** our own UI bundle output (packages/ui/dist) — served same-origin with the engine */
  uiDir: string
  /** the editor system scene project (served with sdk-commands start) */
  editorSceneDir: string
  webPort: number
  scenePort: number
  editorScenePort: number
  recentProjects: string[]
}

// Resolve a path against the monorepo root (dcl-editor), trying the built
// (dist/) and `electron .` (src run) layouts. __dirname at runtime is
// packages/desktop/dist, so ../../.. is the monorepo root.
function fromMonoRoot(...rel: string[]): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', ...rel),
    path.resolve(process.cwd(), '..', '..', ...rel)
  ]
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0]
}

// The engine ships as an npm package (@dcl-regenesislabs/bevy-explorer-web) whose
// tarball INCLUDES the wasm — so `npm install` yields a runnable engine with no
// Rust compile. Default to it; fall back to a local bevy-explorer build when the
// package isn't installed. BEVY_WEB_DIR overrides both (point it at
// ../bevy-explorer/deploy/web to test a local engine build / new engine feature).
function defaultBevyWebDir(): string {
  if (process.env.BEVY_WEB_DIR !== undefined) return process.env.BEVY_WEB_DIR
  const pkg = fromMonoRoot('node_modules', '@dcl-regenesislabs', 'bevy-explorer-web')
  // engine/boot.js marks the react-web-era layout our engine.html boots against
  // (older packages had a self-booting index.html instead)
  if (fs.existsSync(path.join(pkg, 'engine', 'boot.js'))) return pkg
  return fromMonoRoot('..', 'bevy-explorer', 'deploy', 'web')
}

function defaults(): AppConfig {
  return {
    bevyWebDir: defaultBevyWebDir(),
    // our own UI bundles (the `ui` package's build output)
    uiDir: process.env.EDITOR_UI_DIR ?? fromMonoRoot('packages', 'ui', 'dist'),
    // the editor system scene is the `scene` package
    editorSceneDir: process.env.EDITOR_SCENE_DIR ?? fromMonoRoot('packages', 'scene'),
    webPort: Number(process.env.BEVY_WEB_PORT ?? 3010),
    scenePort: Number(process.env.SCENE_PORT ?? 8004),
    editorScenePort: Number(process.env.EDITOR_SCENE_PORT ?? 8005),
    recentProjects: []
  }
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

export function load(): AppConfig {
  try {
    return { ...defaults(), ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) }
  } catch {
    return defaults()
  }
}

export function save(cfg: AppConfig): void {
  const { recentProjects, bevyWebDir, uiDir, editorSceneDir, webPort, scenePort, editorScenePort } = cfg
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(
    configPath(),
    JSON.stringify(
      { recentProjects, bevyWebDir, uiDir, editorSceneDir, webPort, scenePort, editorScenePort },
      null,
      2
    )
  )
}
