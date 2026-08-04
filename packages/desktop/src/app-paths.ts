// Where the app keeps the resources it ships and the ones it accumulates.
// Every one of these has the same shape: packaged builds read from
// process.resourcesPath, an unpackaged run reads from the repo (where __dirname
// is dist/ at runtime, so the folder sits one level up).
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { type LibraryDirs } from './prefab-library'

function shippedDir(name: string): string {
  const candidates = [
    ...(app.isPackaged ? [path.join(process.resourcesPath, name)] : []),
    path.resolve(__dirname, '..', name),
    path.resolve(__dirname, name)
  ]
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0]
}

// Bundled scene starters (a packaged app ships them in resources — createScene's
// cpSync can't read asar).
export function templatesDir(): string {
  return shippedDir('templates')
}

// The prefab library's two trees: read-only builtins ship next to the scene
// templates; the user's own library lives in userData so it survives updates
// and spans every project.
export function prefabLibraryDirs(): LibraryDirs {
  return {
    user: path.join(app.getPath('userData'), 'prefabs'),
    builtin: shippedDir('prefabs')
  }
}

export function prefabStagingRoot(): string {
  return path.join(app.getPath('userData'), 'prefab-imports')
}
