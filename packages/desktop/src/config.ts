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
  /** pinned scene folders (shown in the Home Favourites shelf) */
  favourites: string[]
  /** folder path → last-opened epoch ms, for the Home "last opened" sort */
  lastOpened: Record<string, number>
  /** Home scenes layout preference */
  viewMode: 'grid' | 'list'
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

// Packaged app: everything the monorepo provides at dev time (engine web build,
// UI bundle, templates, editor scene) ships under process.resourcesPath — see
// electron-builder.yml extraResources for the layout.
function fromResources(...rel: string[]): string {
  return path.join(process.resourcesPath, ...rel)
}

// The engine ships as an npm package (@dcl-regenesislabs/bevy-explorer-web) whose
// tarball INCLUDES the wasm — so `npm install` yields a runnable engine with no
// Rust compile. Default to it; fall back to a local bevy-explorer build when the
// package isn't installed. BEVY_WEB_DIR overrides both (point it at
// ../bevy-explorer/deploy/web to test a local engine build / new engine feature).
function defaultBevyWebDir(): string {
  if (process.env.BEVY_WEB_DIR !== undefined) return process.env.BEVY_WEB_DIR
  if (app.isPackaged) return fromResources('engine-web')
  const pkg = fromMonoRoot('node_modules', '@dcl-regenesislabs', 'bevy-explorer-web')
  // engine/boot.js marks the react-web-era layout our engine.html boots against
  // (older packages had a self-booting index.html instead)
  if (fs.existsSync(path.join(pkg, 'engine', 'boot.js'))) return pkg
  return fromMonoRoot('..', 'bevy-explorer', 'deploy', 'web')
}

// sdk-commands installs deps into and writes build output (bin/) inside the
// scene folder, and app resources are read-only on macOS — so the bundled
// editor scene is copied once per app version into userData and run from there.
// Version-keyed: an app update gets a fresh copy instead of last version's.
// The copy goes to a temp dir and is renamed into place (same volume, atomic),
// so a crash/kill mid-copy can never leave a half-tree that passes the "dest
// exists" check on the next launch. Old version dirs (each holding a full npm
// install) are pruned so updates don't accumulate gigabytes in userData.
function packagedEditorSceneDir(): string {
  const root = path.join(app.getPath('userData'), 'editor-scene')
  const dest = path.join(root, app.getVersion())
  if (!fs.existsSync(path.join(dest, 'scene.json'))) {
    const tmp = path.join(root, `.tmp-${process.pid}`)
    fs.rmSync(dest, { recursive: true, force: true })
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.cpSync(fromResources('editor-scene'), tmp, { recursive: true })
    fs.renameSync(tmp, dest)
  }
  for (const entry of fs.readdirSync(root)) {
    if (entry !== app.getVersion()) {
      try {
        fs.rmSync(path.join(root, entry), { recursive: true, force: true })
      } catch {
        /* an old copy in use or locked — retry next launch */
      }
    }
  }
  return dest
}

function defaults(): AppConfig {
  return {
    bevyWebDir: defaultBevyWebDir(),
    // our own UI bundles (the `ui` package's build output)
    uiDir:
      process.env.EDITOR_UI_DIR ?? (app.isPackaged ? fromResources('ui') : fromMonoRoot('packages', 'ui', 'dist')),
    // the editor system scene is the `scene` package
    editorSceneDir:
      process.env.EDITOR_SCENE_DIR ?? (app.isPackaged ? packagedEditorSceneDir() : fromMonoRoot('packages', 'scene')),
    webPort: Number(process.env.BEVY_WEB_PORT ?? 3010),
    scenePort: Number(process.env.SCENE_PORT ?? 8004),
    editorScenePort: Number(process.env.EDITOR_SCENE_PORT ?? 8005),
    recentProjects: [],
    favourites: [],
    lastOpened: {},
    viewMode: 'grid'
  }
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

export function load(): AppConfig {
  const d = defaults()
  try {
    const cfg = { ...d, ...(JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Partial<AppConfig>) }
    // Packaged: the stack paths always come from the current install — a path
    // persisted by a previous version (or a dev run) would point at stale or
    // missing resources. Env overrides still apply (they feed defaults()).
    if (app.isPackaged) {
      cfg.bevyWebDir = d.bevyWebDir
      cfg.uiDir = d.uiDir
      cfg.editorSceneDir = d.editorSceneDir
    }
    return cfg
  } catch {
    return d
  }
}

export function save(cfg: AppConfig): void {
  const {
    recentProjects, bevyWebDir, uiDir, editorSceneDir, webPort, scenePort, editorScenePort,
    favourites, lastOpened, viewMode
  } = cfg
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(
    configPath(),
    JSON.stringify(
      {
        recentProjects, bevyWebDir, uiDir, editorSceneDir, webPort, scenePort, editorScenePort,
        favourites, lastOpened, viewMode
      },
      null,
      2
    )
  )
}
