// Measure the packaged desktop images in packages/desktop/release.
//
// Emits the same JSON shape that app-size.json tracks, so CI (and a developer
// running `npm run dist && npm run size` locally) produce comparable numbers.
// Sizes are apparent bytes, symlinks counted as zero — that matches `du` on the
// .app closely enough and, unlike block counts, doesn't move with the filesystem.
//
// Usage: node scripts/measure-size.mjs [--out <file.json>]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = path.join(root, 'packages', 'desktop', 'release')

// resource dirs we ship ourselves (electron-builder extraResources + the asar).
// Everything else in the install — Electron, its helpers, locales — is "runtime".
const RESOURCES = ['engine-web', 'node', 'ui', 'editor-scene', 'templates', 'app.asar']

// packaged-output dir -> the key we track it under
const INSTALL_DIRS = {
  'mac-arm64': 'mac-arm64',
  'mac-x64': 'mac-x64',
  mac: 'mac-x64', // electron-builder's x64 default
  'mac-universal': 'mac-universal',
  'win-unpacked': 'win-x64',
  'win-arm64-unpacked': 'win-arm64',
  'win-ia32-unpacked': 'win-ia32'
}

// a size we can't measure must never pass silently — every error here is fatal
const fail = (message) => {
  console.error(message)
  process.exit(1)
}

const arg = (name) => {
  const i = process.argv.indexOf(name)
  if (i === -1) return null
  const value = process.argv[i + 1]
  if (!value || value.startsWith('--')) fail(`${name} needs a value`)
  return value
}

const mb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10

function bytesOf(target) {
  // a missing path is expected — RESOURCES lists everything we *might* ship
  const stat = fs.lstatSync(target, { throwIfNoEntry: false })
  if (!stat || stat.isSymbolicLink()) return 0
  if (stat.isFile()) return stat.size
  if (!stat.isDirectory()) return 0
  let total = 0
  for (const entry of fs.readdirSync(target)) total += bytesOf(path.join(target, entry))
  return total
}

// the installer that belongs to a given install dir: unambiguous when only one
// was built (the PR case), otherwise matched on the arch token in its name
const findInstaller = (files, ext, arch) => {
  const candidates = files.filter((f) => f.endsWith(ext) && f !== 'elevate.exe')
  if (candidates.length === 1) return candidates[0]
  return candidates.find((f) => f.includes(arch)) ?? null
}

function measure() {
  if (!fs.existsSync(releaseDir)) fail(`no packaged output at ${releaseDir} — run \`npm run dist\` first`)
  const files = fs.readdirSync(releaseDir)
  const measurements = {}

  for (const [dirName, key] of Object.entries(INSTALL_DIRS)) {
    const installDir = path.join(releaseDir, dirName)
    if (!fs.existsSync(installDir) || !fs.statSync(installDir).isDirectory()) continue

    // a mac .app is itself the "installed" root and keeps resources under
    // Contents/Resources; on Windows it's the whole dir, resources under resources/
    const macApp = fs.readdirSync(installDir).find((f) => f.endsWith('.app'))
    const installRoot = macApp ? path.join(installDir, macApp) : installDir
    const resourceDir = macApp
      ? path.join(installRoot, 'Contents', 'Resources')
      : path.join(installRoot, 'resources')

    const installedBytes = bytesOf(installRoot)
    const components = {}
    let accounted = 0
    for (const name of RESOURCES) {
      const size = bytesOf(path.join(resourceDir, name))
      components[name] = mb(size)
      accounted += size
    }
    components.runtime = mb(installedBytes - accounted)

    const arch = key.split('-')[1]
    const installer = findInstaller(files, macApp ? '.dmg' : '.exe', arch)
    if (!installer) fail(`no installer found for ${key} in ${releaseDir}`)

    measurements[key] = {
      installerMb: mb(bytesOf(path.join(releaseDir, installer))),
      installedMb: mb(installedBytes),
      components
    }
  }

  if (Object.keys(measurements).length === 0) {
    fail(`no packaged install dirs under ${releaseDir} — run \`npm run dist\` first`)
  }
  return measurements
}

const measurements = measure()

const outPath = arg('--out')
if (outPath) {
  const out = path.resolve(outPath)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(measurements, null, 2) + '\n')
  console.log(`wrote ${out}`)
}

for (const [key, m] of Object.entries(measurements)) {
  console.log(`\n${key}: installer ${m.installerMb} MB · installed ${m.installedMb} MB`)
  const biggestFirst = Object.entries(m.components).sort((a, b) => b[1] - a[1])
  for (const [name, size] of biggestFirst) console.log(`  ${String(size).padStart(7)} MB  ${name}`)
}
