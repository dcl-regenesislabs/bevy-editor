// Assemble staging/editor-scene for electron-builder's extraResources: the
// scene package plus a vendored copy of @dcl-editor/contract. The contract is a
// private workspace package (not on the registry), so the packaged scene's
// `npm install` — run on first launch from its userData copy — would 404 on it;
// rewriting the dependency to file:./vendor/contract keeps the install offline.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(desktop, '..', '..')
const sceneDest = path.join(desktop, 'staging', 'editor-scene')

// build/runtime output of a dev checkout — never ship it
const skip = new Set(['node_modules', 'bin', '.dclcache', '.git'])
const copy = (from, to) =>
  fs.cpSync(from, to, { recursive: true, filter: (src) => !skip.has(path.basename(src)) })

fs.rmSync(path.join(desktop, 'staging'), { recursive: true, force: true })
copy(path.join(repo, 'packages', 'scene'), sceneDest)
copy(path.join(repo, 'packages', 'contract'), path.join(sceneDest, 'vendor', 'contract'))

const pkgPath = path.join(sceneDest, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
pkg.dependencies['@dcl-editor/contract'] = 'file:./vendor/contract'
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// The scene is a workspace member, so it has no lockfile of its own. The
// packaged app npm-installs this copy on end-user machines at first launch —
// generate a lockfile NOW so that install resolves to exactly what this build
// (and its CI validation) saw, instead of a fresh float against the registry.
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: sceneDest,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})

console.log(`staged editor scene → ${sceneDest}`)
