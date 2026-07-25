// electron-builder afterPack hook: ship a Node.js runtime (with npm) inside the
// image at resources/node. The app spawns npm for scene dev servers, installs
// and deploys (servers.ts spawnNpm); requiring a system Node would break on
// machines without one — and even with one, GUI-launched apps get a minimal
// PATH that usually misses it. Downloads the official dist for the TARGET
// platform/arch (not the build host), caches it in .node-cache/, prunes docs +
// corepack, and copies it into the packed app before signing.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

// current active LTS (Krypton); must satisfy the repo's engines field (>= 22)
const NODE_VERSION = process.env.EDITOR_BUNDLED_NODE_VERSION ?? '24.18.0'

// builder-util Arch enum: 0=ia32 1=x64 2=armv7l 3=arm64 4=universal
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' }

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

module.exports = async function bundleNode(context) {
  const platform = context.electronPlatformName // 'darwin' | 'win32' | 'linux'
  const arch = ARCH_NAMES[context.arch]
  if (arch === undefined) throw new Error(`unsupported arch: ${context.arch}`)

  const distName =
    platform === 'win32' ? `node-v${NODE_VERSION}-win-${arch}` : `node-v${NODE_VERSION}-${platform}-${arch}`
  const archiveExt = platform === 'win32' ? 'zip' : 'tar.gz'
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${distName}.${archiveExt}`

  const cacheRoot = path.join(__dirname, '..', '.node-cache')
  const extracted = path.join(cacheRoot, distName)
  if (!fs.existsSync(path.join(extracted, platform === 'win32' ? 'node.exe' : 'bin/node'))) {
    fs.rmSync(extracted, { recursive: true, force: true })
    fs.mkdirSync(cacheRoot, { recursive: true })
    const archive = path.join(cacheRoot, `${distName}.${archiveExt}`)
    console.log(`  • downloading bundled node runtime  url=${url}`)
    await download(url, archive)
    // bsdtar extracts both tar.gz and zip. On Windows, PATH's `tar` is Git's
    // GNU tar, which chokes on drive-letter paths (treats C: as a host) and
    // can't unzip — pin the System32 bsdtar and use a relative archive path.
    const tarBin =
      process.platform === 'win32'
        ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
        : 'tar'
    execFileSync(tarBin, ['-xf', `${distName}.${archiveExt}`], { cwd: cacheRoot })
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
      fs.rmSync(path.join(extracted, rel), { recursive: true, force: true })
    }
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
