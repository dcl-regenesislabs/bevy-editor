// Publish flow (module singleton state machine).
// Publishing drives the local linker server that main spawns (see publish.ts in
// the desktop package): GET /api/info → sign rootCID → POST /api/deploy.
// building: main is installing deps / building / hashing (until linker `ready`)
// uploading: we signed the entity and POSTed — the linker uploads to the server
import { useSyncExternalStore } from 'react'
import { Authenticator } from '@dcl/crypto'
import { getAccount, getIdentity, hasValidIdentity } from '../account/auth'
import { chainId, jumpInUrl, worldsServer } from '../worlds/endpoints'
import { fetchWorldPermissions } from '../worlds/inventory'
import { refreshWorlds } from '../worlds/worlds-store'

export type PublishPhase = 'idle' | 'building' | 'uploading' | 'success' | 'error'
export interface PublishState {
  phase: PublishPhase
  dir: string | null
  world: string | null
  logs: string[]
  error: string | null
  jumpIn: string | null
}
let publishStore: PublishState = { phase: 'idle', dir: null, world: null, logs: [], error: null, jumpIn: null }
const publishListeners = new Set<() => void>()
function setPublishStore(patch: Partial<PublishState>): void {
  publishStore = { ...publishStore, ...patch }
  for (const l of publishListeners) l()
}

// The live job's token. Every async continuation (event handler, driveLinker
// then/catch, the pre-flight chain) checks `alive` before touching the store —
// a cancelled/replaced job must not stamp state over its successor. `id` is
// main's jobId; null while publishStart is still in flight (early install logs
// arrive before it resolves).
interface JobToken {
  id: string | null
  alive: boolean
}
let jobToken: JobToken | null = null
let unsubPublish: (() => void) | null = null
const LOG_CAP = 400

function finishPublish(patch: Partial<PublishState>): void {
  if (jobToken !== null) jobToken.alive = false
  jobToken = null
  unsubPublish?.()
  unsubPublish = null
  setPublishStore(patch)
}

// Sign the entity and hand it to the linker: the POST returns once the upload
// to the worlds content server finished (or failed).
async function driveLinker(port: number): Promise<void> {
  const identity = getIdentity()
  const wallet = getAccount()
  if (identity === null || wallet === null) throw new Error('Your session expired — sign in again')
  const info = (await (await fetch(`http://localhost:${port}/api/info`)).json()) as { rootCID: string }
  const authChain = Authenticator.signPayload(identity, info.rootCID)
  const res = await fetch(`http://localhost:${port}/api/deploy`, {
    method: 'POST',
    body: JSON.stringify({ address: wallet, authChain, chainId: chainId() })
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message ?? `upload failed (${res.status})`)
  }
}

// Advisory pre-flight (the server re-checks authoritatively at upload): can
// `wallet` deploy to `name`? Owner, open deployment, or on the allow-list.
async function canDeploy(name: string, wallet: string): Promise<boolean> {
  try {
    const p = await fetchWorldPermissions(name)
    if (p === null) return true // can't tell — let the server decide
    return p.owner === wallet || p.deployment.type === 'unrestricted' || p.deployment.wallets.includes(wallet)
  } catch {
    return true
  }
}

// Publish `dir` to `world`: writes worldConfiguration.name, then main builds and
// serves the linker; on `ready` we sign + upload. One publish at a time.
export function startPublish(dir: string, world: string): void {
  const shell = window.editorShell
  const publishStartShell = shell?.publishStart
  const setWorldName = shell?.setWorldName
  if (shell === undefined || publishStartShell === undefined || shell.onPublishEvent === undefined || setWorldName === undefined) {
    setPublishStore({ phase: 'error', error: 'Publishing needs the desktop app', dir, world, logs: [], jumpIn: null })
    return
  }
  if (publishStore.phase === 'building' || publishStore.phase === 'uploading') return
  if (!hasValidIdentity()) {
    setPublishStore({ phase: 'error', error: 'Sign in to publish', dir, world, logs: [], jumpIn: null })
    return
  }
  const name = world.toLowerCase()
  const wallet = getAccount()
  const token: JobToken = { id: null, alive: true }
  jobToken = token
  setPublishStore({ phase: 'building', dir, world: name, logs: [], error: null, jumpIn: null })
  let uploading = false
  unsubPublish = shell.onPublishEvent((e) => {
    if (!token.alive) return
    // before publishStart resolves we don't know our jobId — accept only the
    // (cosmetic) install logs then; ready/exit must match our job exactly
    if (token.id === null ? e.kind !== 'log' : e.jobId !== token.id) return
    if (e.kind === 'log') {
      const logs = [...publishStore.logs, e.line]
      if (logs.length > LOG_CAP) logs.splice(0, logs.length - LOG_CAP)
      setPublishStore({ logs })
    } else if (e.kind === 'ready') {
      uploading = true
      setPublishStore({ phase: 'uploading' })
      driveLinker(e.port)
        .then(() => {
          if (!token.alive) return // cancelled mid-upload
          finishPublish({ phase: 'success', jumpIn: jumpInUrl(name) })
          refreshWorlds() // the tab should show the new deployment right away
        })
        .catch((err: unknown) => {
          if (!token.alive) return // cancelled — the connection reset is ours
          void shell.publishStop?.()
          finishPublish({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
        })
    } else if (e.kind === 'exit') {
      // an exit before `ready` (or a non-zero exit before our POST resolved)
      // means the build/validation failed — surface the log tail
      if (!uploading && publishStore.phase === 'building') {
        const tail = publishStore.logs.slice(-6).join('\n')
        finishPublish({ phase: 'error', error: `The build failed.\n${tail}` })
      }
    }
  })
  void (async () => {
    if (wallet !== null && !(await canDeploy(name, wallet))) {
      if (token.alive) {
        finishPublish({
          phase: 'error',
          error: `You don't have permission to publish to ${name} — ask the world owner to add your wallet to its deployment list.`
        })
      }
      return
    }
    if (!token.alive) return // cancelled during pre-flight — nothing started yet
    await setWorldName(dir, name)
    if (!token.alive) return
    const { jobId } = await publishStartShell(dir, worldsServer())
    // cancelled while main was spawning: cancelPublish's publish-stop was sent
    // AFTER our publish-start (IPC is ordered), so main already cancelled this
    // job — calling publishStop again here could kill a newer job instead
    if (!token.alive) return
    token.id = jobId
  })().catch((err: unknown) => {
    if (!token.alive) return
    finishPublish({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
  })
}

export function cancelPublish(): void {
  void window.editorShell?.publishStop?.()
  finishPublish({ phase: 'idle', error: null, jumpIn: null })
}

// clear a finished (success/error) publish so the modal returns to the picker
export function resetPublish(): void {
  if (publishStore.phase === 'success' || publishStore.phase === 'error') {
    finishPublish({ phase: 'idle', dir: null, world: null, logs: [], error: null, jumpIn: null })
  }
}

export function usePublish(): PublishState {
  return useSyncExternalStore(
    (l) => {
      publishListeners.add(l)
      return () => publishListeners.delete(l)
    },
    () => publishStore
  )
}
