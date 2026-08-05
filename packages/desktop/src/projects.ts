// Home / scene management: reading a scene folder's metadata for the grid, and
// the CRUD the Home screen offers over it (favourite, rename, duplicate, create
// from a template, delete to Trash).
//
// Everything here takes the config (and, where a native dialog is involved, the
// window) as an argument rather than reaching for main.ts's module state, so the
// logic is exercisable without booting Electron. Callers that change the recents
// list are responsible for rebuilding the native menu.
import { BrowserWindow, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as config from './config'
import { templatesDir } from './app-paths'
import type { ProjectInfo, SceneTemplate } from '@dcl-editor/contract'

const IMG_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

// Read a scene project's metadata + thumbnail (as a data URL) for the home grid.
// Enriched with Home state: favourite/lastOpened from config, and `missing` when
// the folder or its scene.json is gone (so the card greys instead of throwing).
export function projectInfo(dir: string, cfg: config.AppConfig): ProjectInfo {
  const name = path.basename(dir.replace(/\/+$/, ''))
  const info: ProjectInfo = {
    path: dir,
    name,
    title: name,
    world: null,
    parcels: 0,
    thumbnail: null,
    favourite: cfg?.favourites?.includes(dir) ?? false,
    lastOpened: cfg?.lastOpened?.[dir]
  }
  if (!fs.existsSync(path.join(dir, 'scene.json'))) {
    info.missing = true
    return info
  }
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8')) as {
      display?: { title?: string; navmapThumbnail?: string }
      scene?: { parcels?: string[] }
      worldConfiguration?: { name?: string }
    }
    if (meta.display?.title) info.title = meta.display.title
    if (meta.worldConfiguration?.name) info.world = meta.worldConfiguration.name
    if (Array.isArray(meta.scene?.parcels)) info.parcels = meta.scene.parcels.length
    const thumbRel = meta.display?.navmapThumbnail
    if (thumbRel !== undefined) {
      const thumbPath = path.join(dir, thumbRel)
      if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size < 4_000_000) {
        const ext = path.extname(thumbPath).toLowerCase()
        const mime = IMG_MIME[ext] ?? 'image/png'
        info.thumbnail = `data:${mime};base64,${fs.readFileSync(thumbPath).toString('base64')}`
      }
    }
  } catch {
    /* keep folder-name fallback */
  }
  return info
}

const SCENE_TEMPLATES: SceneTemplate[] = [
  { id: 'blank', name: 'Blank', description: 'An empty parcel — start from scratch' },
  // named "Example", not "Starter": the field itself is now labelled Starter, and
  // the whole point of the rename was to stop one word meaning three things
  { id: 'starter', name: 'Example', description: 'A clickable cube with a bit of SDK7 code' }
]

export function sceneTemplates(): SceneTemplate[] {
  return SCENE_TEMPLATES.filter((t) => fs.existsSync(path.join(templatesDir(), t.id)))
}

export const slugify = (s: string): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'my-scene'

// First non-existing "<base>[ suffix]" folder path, so copies never clobber.
export function freeFolder(base: string, suffix: (n: number) => string): string {
  let dest = base
  let n = 2
  while (fs.existsSync(dest)) dest = suffix(n++)
  return dest
}

export function toggleFavourite(cfg: config.AppConfig, dir: string): void {
  cfg.favourites = cfg.favourites.includes(dir)
    ? cfg.favourites.filter((p) => p !== dir)
    : [dir, ...cfg.favourites]
  config.save(cfg)
}

export function removeFromRecents(cfg: config.AppConfig, dir: string): void {
  cfg.recentProjects = cfg.recentProjects.filter((p) => p !== dir)
  config.save(cfg)
}

// Move a scene folder to the OS Trash (recoverable), confirmed first — a
// creator's folder is often their only copy, so never fs.rm.
export async function deleteProject(win: BrowserWindow, cfg: config.AppConfig, dir: string): Promise<boolean> {
  const res = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Move to Trash', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Delete "${path.basename(dir)}"?`,
    detail: `The scene folder will be moved to your Trash — you can restore it from there.\n\n${dir}`
  })
  if (res.response !== 0) return false
  try {
    await shell.trashItem(dir)
  } catch (e) {
    dialog.showErrorBox('Could not delete', String(e))
    return false
  }
  cfg.recentProjects = cfg.recentProjects.filter((p) => p !== dir)
  cfg.favourites = cfg.favourites.filter((p) => p !== dir)
  delete cfg.lastOpened[dir]
  config.save(cfg)
  return true
}

// Rename edits scene.json's display.title — NOT the folder — so recents paths stay valid.
export function renameProject(dir: string, title: string): void {
  const sj = path.join(dir, 'scene.json')
  const meta = JSON.parse(fs.readFileSync(sj, 'utf8')) as { display?: Record<string, unknown> }
  meta.display = { ...(meta.display ?? {}), title: title.trim() }
  fs.writeFileSync(sj, JSON.stringify(meta, null, 2))
}

// Set the scene's target world (scene.json worldConfiguration.name) — same
// write pattern as renameProject. sdk-commands treats any non-empty
// worldConfiguration as "this is a World deployment".
export function setWorldName(dir: string, name: string): void {
  const sj = path.join(dir, 'scene.json')
  const meta = JSON.parse(fs.readFileSync(sj, 'utf8')) as { worldConfiguration?: Record<string, unknown> }
  meta.worldConfiguration = { ...(meta.worldConfiguration ?? {}), name: name.trim().toLowerCase() }
  fs.writeFileSync(sj, JSON.stringify(meta, null, 2))
}

export function duplicateProject(cfg: config.AppConfig, dir: string): string | null {
  if (!fs.existsSync(dir)) return null
  const base = dir.replace(/\/+$/, '')
  const dest = freeFolder(`${base} copy`, (n) => `${base} copy ${n}`)
  fs.cpSync(dir, dest, {
    recursive: true,
    filter: (src) => !['node_modules', 'bin', '.git'].includes(path.basename(src))
  })
  cfg.recentProjects = [dest, ...cfg.recentProjects.filter((p) => p !== dest)]
  config.save(cfg)
  return dest
}

// Scaffold a new scene by copying a bundled template folder (offline, deterministic
// — no global sdk-commands init). Deps install on first open (ensureProjectDeps).
export function createScene(
  cfg: config.AppConfig,
  parentDir: string,
  name: string,
  template: string
): string | null {
  const tdir = path.join(templatesDir(), template)
  if (!fs.existsSync(tdir)) throw new Error(`template not found: ${template}`)
  const slug = slugify(name)
  const dest = freeFolder(path.join(parentDir, slug), (n) => path.join(parentDir, `${slug}-${n}`))
  fs.cpSync(tdir, dest, { recursive: true })
  try {
    const sj = path.join(dest, 'scene.json')
    const meta = JSON.parse(fs.readFileSync(sj, 'utf8')) as { display?: Record<string, unknown> }
    meta.display = { ...(meta.display ?? {}), title: name.trim() }
    fs.writeFileSync(sj, JSON.stringify(meta, null, 2))
  } catch {
    /* template had no/invalid scene.json — leave as copied */
  }
  cfg.recentProjects = [dest, ...cfg.recentProjects.filter((p) => p !== dest)]
  cfg.lastOpened[dest] = Date.now()
  config.save(cfg)
  return dest
}

export async function pickFolder(win: BrowserWindow): Promise<string | null> {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a folder for the new scene',
    properties: ['openDirectory', 'createDirectory']
  })
  return res.canceled ? null : (res.filePaths[0] ?? null)
}
