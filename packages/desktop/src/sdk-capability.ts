// Does the scene's installed SDK have the auth-server APIs?
//
// A server-aware prefab's script calls isServer / registerMessages. Dropped into
// a scene on an older SDK it still bundles — sdk-commands skips the type check in
// --watch mode — and then throws at runtime, inside a file the creator never wrote
// and just dragged in.
//
// Probe the capability rather than compare versions: any build carrying the API
// works, so a creator already on a newer auth-server build is never told to change.
import fs from 'node:fs'
import path from 'node:path'
import { spawnNpm } from './servers'

export interface SdkCapability {
  authServer: boolean
  /** false when the scene has no node_modules yet — unknown, not incapable */
  installed: boolean
}

export function sdkCapability(projectDir: string): SdkCapability {
  const dts = path.join(projectDir, 'node_modules', '@dcl', 'sdk', 'network', 'index.d.ts')
  try {
    const src = fs.readFileSync(dts, 'utf8')
    return { authServer: src.includes('isServer'), installed: true }
  } catch {
    return { authServer: false, installed: false }
  }
}

export async function installAuthServerSdk(
  projectDir: string,
  onLog: (line: string) => void
): Promise<{ ok: boolean; message: string }> {
  const args = ['install', '@dcl/sdk@auth-server', '@dcl/sdk-commands@auth-server', '--no-audit', '--no-fund']
  onLog(`● installing the auth-server SDK in ${projectDir}…`)
  return await new Promise((resolve) => {
    const child = spawnNpm(args, { cwd: projectDir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout?.on('data', (d: Buffer) => onLog(String(d).trimEnd()))
    child.stderr?.on('data', (d: Buffer) => onLog(String(d).trimEnd()))
    child.on('error', (e) => resolve({ ok: false, message: `npm could not start — ${e.message}` }))
    child.on('exit', (code) => {
      if (code !== 0) {
        resolve({ ok: false, message: `npm install exited with ${code} — see the logs` })
        return
      }
      resolve(
        sdkCapability(projectDir).authServer
          ? { ok: true, message: 'Installed the auth-server SDK' }
          : { ok: false, message: 'The install finished but the SDK still has no auth-server API' }
      )
    })
  })
}
