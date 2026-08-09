// Editing a built-in prefab is a version bump.
//
// A project gets new bytes for a prefab exactly one way: its owner accepts the
// update offer, and that offer exists only while the master's `version` is ahead
// of the copy's (packages/ui/src/prefabs/outdated.ts). A folder edited without a
// bump therefore reaches nobody — the change lives in this repo and in scenes
// created after it, and every scene that already holds the prefab keeps the old
// files with nothing to tell anyone they are old. That is not a thing to
// remember; it is a thing to fail.
//
// So: prefab-digests.json records a SHA-256 over every file each prefab ships,
// beside the version it shipped under. A moved digest under an unchanged version
// is refused, which keeps `npm test` red until data.json says a new version (and,
// the same edit, what changed for the creator in its changelog).
//
// The twin of scripts/sync-runtime-modules.mjs, which does the same for the
// runtime masters. Kept apart because they answer to different versions.
//
// Usage:
//   node scripts/sync-prefab-digests.mjs           write the changes
//   node scripts/sync-prefab-digests.mjs --check   print what would change, exit 1
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

// --- pure core (unit-tested in sync-prefab-digests.test.mjs) ---

// One hash over everything a prefab folder ships. `files` is [rel, bytes] pairs;
// the path and the byte length go in beside the body, so a rename or a file split
// in two moves the digest even when the bytes are the same overall.
export function digestOf(files) {
  const hash = createHash('sha256')
  for (const [rel, bytes] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    hash.update(`${rel} ${bytes.length} `)
    hash.update(bytes)
  }
  return hash.digest('hex')
}

/**
 * What prefab-digests.json should hold, which folders are edited-but-unbumped,
 * and whether the file on disk already agrees.
 *
 * `current` is a Map of folder → { version, digest } read off the repo;
 * `recorded` is the parsed file (`{}` when there is none yet).
 */
export function digestPlan(current, recorded) {
  const next = {}
  const stale = []
  for (const folder of [...current.keys()].sort()) {
    const entry = current.get(folder)
    const was = recorded[folder]
    // a first sighting records whatever it finds: the guard is about a folder
    // that MOVED, and a new prefab has nothing to have moved from
    if (was !== undefined && was.version === entry.version && was.digest !== entry.digest) {
      stale.push(folder)
    }
    next[folder] = entry
  }
  return { next, stale, changed: JSON.stringify(next) !== JSON.stringify(recorded) }
}

export function staleMessage(stale) {
  return (
    `${stale.join(', ')}: a shipped file changed but data.json still names the same version — ` +
    'bump it and add a changelog entry, then re-run. Without the bump no project that already ' +
    'holds the prefab is ever offered the change.'
  )
}

// --- fs driver ---

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const prefabsDir = path.join(root, 'packages/desktop/prefabs')
// beside the folders, not inside them: the prefabs directory ships in the app
// (electron-builder.yml) and this is repo bookkeeping
const digestFile = path.join(root, 'packages/desktop/prefab-digests.json')

function listFiles(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    const at = path.join(dir, name)
    if (fs.statSync(at).isDirectory()) listFiles(at, base, out)
    else out.push(path.relative(base, at).split(path.sep).join('/'))
  }
  return out
}

export function prefabFolders() {
  return fs
    .readdirSync(prefabsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(prefabsDir, e.name, 'data.json')))
    .map((e) => e.name)
    .sort()
}

/** folder → { version, digest } for every built-in, read off this working tree. */
export function currentDigests() {
  const current = new Map()
  for (const folder of prefabFolders()) {
    const dir = path.join(prefabsDir, folder)
    const files = listFiles(dir).map((rel) => [rel, fs.readFileSync(path.join(dir, rel))])
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'))
    current.set(folder, { version: data.version ?? '0.0.0', digest: digestOf(files) })
  }
  return current
}

export function recordedDigests() {
  if (!fs.existsSync(digestFile)) return {}
  return JSON.parse(fs.readFileSync(digestFile, 'utf8'))
}

function main() {
  const check = process.argv.includes('--check')
  const plan = digestPlan(currentDigests(), recordedDigests())
  if (plan.stale.length > 0) {
    console.error(`sync-prefab-digests: ${staleMessage(plan.stale)}`)
    process.exit(1)
  }
  if (!plan.changed) {
    console.log('sync-prefab-digests: every built-in prefab digest is recorded against its version')
    return
  }
  if (check) {
    console.error('sync-prefab-digests: prefab-digests.json is out of date — run `node scripts/sync-prefab-digests.mjs`')
    process.exit(1)
  }
  fs.writeFileSync(digestFile, `${JSON.stringify(plan.next, null, 2)}\n`)
  console.log(`sync-prefab-digests: wrote ${Object.keys(plan.next).length} entries`)
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
