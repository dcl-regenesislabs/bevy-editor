// A server-aware prefab needs an SDK that has the auth-server APIs. Its script
// calls isServer / registerMessages; on an older SDK it still bundles (the type
// check is skipped in --watch) and then throws at runtime, inside a file the
// creator never wrote and just dragged in.
//
// So check before placing and offer the install, instead of a crash later.
import { reactive } from '../core/store'
import { readPrefabFolder } from './storage'

export const sdkGate = reactive<{
  /** the prefab we held back, and the folder to retry with once the SDK is in */
  pending: { folder: string; prefabName: string } | null
  installing: boolean
  error: string | null
}>({ pending: null, installing: false, error: null })

function projectDir(): string | null {
  return new URLSearchParams(window.location.search).get('project')
}

/**
 * True when the prefab can't run here yet — the caller must not instantiate.
 * A scene with no node_modules is treated as fine: not installed yet is unknown,
 * not incapable, and blocking a fresh project would be worse than the crash.
 */
export async function blockedBySdk(folder: string): Promise<boolean> {
  const dir = projectDir()
  const probe = window.editorShell?.sdkCapability
  if (dir === null || probe === undefined) return false

  const { data } = await readPrefabFolder(folder)
  if (data.requiresSdk !== 'auth-server') return false

  const cap = await probe(dir)
  if (cap.authServer || !cap.installed) return false
  sdkGate.pending = { folder, prefabName: data.name }
  sdkGate.error = null
  return true
}

export function clearSdkGate(): void {
  sdkGate.pending = null
  sdkGate.installing = false
  sdkGate.error = null
}

/** Install, then return the folder so the caller can place what it held back. */
export async function installSdkForGate(): Promise<string | null> {
  const gate = sdkGate.pending
  const install = window.editorShell?.installAuthServerSdk
  const dir = projectDir()
  if (gate === null || install === undefined || dir === null) return null

  sdkGate.installing = true
  sdkGate.error = null
  const res = await install(dir)
  sdkGate.installing = false
  if (!res.ok) {
    sdkGate.error = res.message
    return null
  }
  sdkGate.pending = null
  return gate.folder
}
