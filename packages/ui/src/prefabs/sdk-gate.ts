// A server-aware prefab needs an SDK that has the auth-server APIs. Its script
// calls isServer / registerMessages; on an older SDK it still bundles (the type
// check is skipped in --watch) and then throws at runtime, inside a file the
// creator never wrote and just dragged in.
//
// So check before placing and offer the install, instead of a crash later.
//
// The same hold serves a second reason: a prefab that needs a newer runtime than
// this build ships (prefabs/runtime-gate.ts). One dialog, two reasons — the
// reason carries its own message, and only 'sdk' has an action to offer.
import { reactive } from '../core/store'
import { readPrefabFolder } from './storage'

export type GateReason = { kind: 'sdk' } | { kind: 'runtime'; message: string }

export const sdkGate = reactive<{
  /** the prefab we held back, and the folder to retry with once the SDK is in */
  pending: { folder: string; prefabName: string; reason: GateReason } | null
  installing: boolean
  error: string | null
}>({ pending: null, installing: false, error: null })

/** Hold a prefab back and say why. The caller must not instantiate. */
export function holdPrefab(folder: string, prefabName: string, reason: GateReason): void {
  sdkGate.pending = { folder, prefabName, reason }
  sdkGate.installing = false
  sdkGate.error = null
}

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
  holdPrefab(folder, data.name, { kind: 'sdk' })
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
  // there is nothing to install for a runtime hold — its only recourse is a
  // newer build, so the dialog offers no button and this can never be reached
  if (gate === null || gate.reason.kind !== 'sdk' || install === undefined || dir === null) return null

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
