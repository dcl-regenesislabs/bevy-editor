// Dev-only macOS helper for the sign-in deep-link. An unpackaged `electron .`
// has no bundle Info.plist, so macOS can't deliver dcl-creator-hub:// to it —
// the browser launches a bare Electron instead and the callback URL is lost.
// This script builds and registers a tiny AppleScript applet that claims the
// scheme: when the auth dapp bounces back, the applet copies the full URL to
// the clipboard (with a notification), and you paste it into the DEV box in
// the app's "Waiting for your browser" panel.
//
//   node scripts/dev-signin-shim.mjs          build + register
//   node scripts/dev-signin-shim.mjs remove   unregister + delete
//
// Not needed once the app ships packaged (the bundle declares the scheme).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const shimDir = path.join(root, '.dev-shim')
const appPath = path.join(shimDir, 'DCL Sign-in Shim (dev).app')
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const plistBuddy = '/usr/libexec/PlistBuddy'

if (process.platform !== 'darwin') {
  console.error('macOS-only (other platforms deliver the deep-link via argv/second-instance)')
  process.exit(1)
}

if (process.argv[2] === 'remove') {
  if (fs.existsSync(appPath)) {
    execFileSync(lsregister, ['-u', appPath])
    fs.rmSync(shimDir, { recursive: true, force: true })
    console.log('✓ shim unregistered and removed')
  } else {
    console.log('nothing to remove')
  }
  process.exit(0)
}

const script = `on open location theURL
  set the clipboard to theURL
  display notification "Sign-in link copied — paste it into the editor's DEV box" with title "DCL Editor"
end open location
`

fs.rmSync(appPath, { recursive: true, force: true })
fs.mkdirSync(shimDir, { recursive: true })
execFileSync('osacompile', ['-o', appPath, '-e', script])

const plist = path.join(appPath, 'Contents', 'Info.plist')
for (const cmd of [
  'Add :CFBundleURLTypes array',
  'Add :CFBundleURLTypes:0 dict',
  'Add :CFBundleURLTypes:0:CFBundleURLName string Decentraland Creator Hub (dev shim)',
  'Add :CFBundleURLTypes:0:CFBundleURLSchemes array',
  'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string dcl-creator-hub'
]) {
  execFileSync(plistBuddy, ['-c', cmd, plist])
}

execFileSync(lsregister, ['-f', appPath])
console.log(`✓ shim built and registered: ${appPath}`)
console.log('  approve the sign-in in your browser → the callback URL lands on your clipboard')
console.log('  undo with: node scripts/dev-signin-shim.mjs remove')
