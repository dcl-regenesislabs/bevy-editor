// electron-builder afterPack hook: ship a Node.js runtime (with npm) inside the
// image at resources/node. The app spawns npm for scene dev servers, installs
// and deploys (servers.ts spawnNpm); requiring a system Node would break on
// machines without one — and even with one, GUI-launched apps get a minimal
// PATH that usually misses it. Downloads the official dist for the TARGET
// platform/arch (not the build host), verifies it against SHASUMS256.txt,
// caches it in .node-cache/, prunes docs + corepack, and copies it into the
// packed app before signing.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

// current active LTS (Krypton); must satisfy the repo's engines field (>= 22)
const NODE_VERSION = process.env.EDITOR_BUNDLED_NODE_VERSION ?? '24.18.0'

// builder-util Arch enum: 0=ia32 1=x64 2=armv7l 3=arm64 4=universal
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' }

// One transient nodejs.org 5xx must not fail a whole packaging job that
// already spent minutes on install+validate — bounded retries with backoff.
async function fetchBytes(url, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      if (i >= attempts) throw e
      console.log(`  • retrying node runtime download (${i}/${attempts - 1})  error=${e.message}`)
      await new Promise((r) => setTimeout(r, 3000 * i))
    }
  }
}

// The shipped runtime ends up inside the signed installer — never trust the
// bytes without checking them against the release's published checksums.
async function verifySha256(archive, archiveName, baseUrl) {
  const shasums = (await fetchBytes(`${baseUrl}/SHASUMS256.txt`)).toString('utf8')
  const line = shasums.split('\n').find((l) => l.trim().endsWith(archiveName))
  if (line === undefined) throw new Error(`${archiveName} not found in SHASUMS256.txt`)
  const expected = line.trim().split(/\s+/)[0]
  const actual = crypto.createHash('sha256').update(archive).digest('hex')
  if (actual !== expected) {
    throw new Error(`sha256 mismatch for ${archiveName}: expected ${expected}, got ${actual}`)
  }
}

module.exports = async function bundleNode(context) {
  const platform = context.electronPlatformName // 'darwin' | 'win32' | 'linux'
  const arch = ARCH_NAMES[context.arch]
  if (arch === undefined) throw new Error(`unsupported arch: ${context.arch}`)

  const distName =
    platform === 'win32' ? `node-v${NODE_VERSION}-win-${arch}` : `node-v${NODE_VERSION}-${platform}-${arch}`
  const archiveExt = platform === 'win32' ? 'zip' : 'tar.gz'
  const archiveName = `${distName}.${archiveExt}`
  const baseUrl = `https://nodejs.org/dist/v${NODE_VERSION}`

  const cacheRoot = path.join(__dirname, '..', '.node-cache')
  const extracted = path.join(cacheRoot, distName)
  // validity probe: BOTH binaries the app runs must exist — bin/node alone can
  // survive an interrupted extraction and would poison the cache forever
  const nodeBin = platform === 'win32' ? 'node.exe' : 'bin/node'
  const npmCli =
    platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js'
  const cacheValid = fs.existsSync(path.join(extracted, nodeBin)) && fs.existsSync(path.join(extracted, npmCli))

  if (!cacheValid) {
    fs.rmSync(extracted, { recursive: true, force: true })
    fs.mkdirSync(cacheRoot, { recursive: true })
    console.log(`  • downloading bundled node runtime  url=${baseUrl}/${archiveName}`)
    const bytes = await fetchBytes(`${baseUrl}/${archiveName}`)
    await verifySha256(bytes, archiveName, baseUrl)
    // extract into a temp dir and rename into place so an interrupted run can
    // never leave a half-populated dir under the final cache path
    const tmpRoot = path.join(cacheRoot, `.tmp-${process.pid}`)
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    fs.mkdirSync(tmpRoot, { recursive: true })
    const archive = path.join(tmpRoot, archiveName)
    fs.writeFileSync(archive, bytes)
    // bsdtar extracts both tar.gz and zip. On Windows, PATH's `tar` is Git's
    // GNU tar, which chokes on drive-letter paths (treats C: as a host) and
    // can't unzip — pin the System32 bsdtar and use relative paths via cwd.
    const tarBin =
      process.platform === 'win32'
        ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
        : 'tar'
    execFileSync(tarBin, ['-xf', archiveName], { cwd: tmpRoot })
    fs.rmSync(archive)
    // prune what the app never uses; npm stays (the whole point)
    for (const rel of [
      'include',
      'share',
      'CHANGELOG.md',
      'README.md',
      'bin/corepack',
      'lib/node_modules/corepack',
      'corepack',
      'corepack.cmd',
      'node_modules/corepack',
      'nodevars.bat',
      'install_tools.bat'
    ]) {
      fs.rmSync(path.join(tmpRoot, distName, rel), { recursive: true, force: true })
    }
    fs.renameSync(path.join(tmpRoot, distName), extracted)
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }

  const resourcesDir =
    platform === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources')
  const dest = path.join(resourcesDir, 'node')
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(extracted, dest, { recursive: true, verbatimSymlinks: true })
  console.log(`  • bundled node runtime  version=${NODE_VERSION} platform=${platform} arch=${arch}`)
}
