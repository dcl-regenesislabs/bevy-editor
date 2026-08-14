// Publish flow (module singleton state machine).
// Publishing drives the local linker server that main spawns (see publish.ts in
// the desktop package): GET /api/info → sign rootCID → POST /api/deploy.
// checking:  reading the scene's own parcels and who is standing on them
// review:    one decision is waiting — a scene would be replaced, or the world
//            couldn't be read
// blocked:   this scene's sdk-commands would clear the world it is aimed at
// building:  main is installing deps / building / hashing (until linker `ready`)
// uploading: we signed the entity and POSTed — the linker uploads to the server
//
// Everything that could replace someone's work is decided BEFORE the spawn.
// Once the CLI runs, the only lever it has left is a stdin prompt nobody can
// answer (that is the incident publish-classify documents), so a question asked
// after the spawn is a question that never gets asked at all.
import { useSyncExternalStore } from 'react'
import { Authenticator } from '@dcl/crypto'
import { getAccount, getIdentity, hasValidIdentity } from '../account/auth'
import { chainId, jumpInUrl, worldsServer } from '../worlds/endpoints'
import { fetchWorldScenes } from '../worlds/inventory'
import { refreshWorlds, worldSceneCount } from '../worlds/worlds-store'
import { classifyPublishExit, looksLikeBlockingPrompt } from './publish-classify'
import { conflictsFor, fetchScenesAt, leaseChanged, leaseOf, nearestFreeFootprint } from './publish-conflict'
import type { Footprint, OccupyingScene } from './publish-conflict'
import {
  leaseChangedMessage,
  MOVE_UNAVAILABLE,
  moveUnreadableLine,
  NEEDS_DESKTOP,
  offlineOldSdkMessage,
  oldSdkMessage,
  SIGN_IN_TO_PUBLISH
} from './publish-copy'
import { lastPublishedEntity, rememberPublishedEntity } from './publish-identity'
import { deployDenial, destructiveVerdict, readCapability, readLocalFootprint } from './publish-preflight'

export type PublishPhase =
  | 'idle'
  | 'checking'
  | 'review'
  | 'blocked'
  | 'building'
  | 'uploading'
  | 'success'
  | 'error'

// The one decision point: these scenes sit on the parcels we are about to
// occupy and publishing replaces them. `move` is the previewed way out — it is
// only written to scene.json once the creator confirms the preview.
export interface ConflictReview {
  kind: 'conflict'
  scenes: OccupyingScene[]
  mine: string[]
  move: Footprint | null
  moveNote: string | null
  working: boolean
}

// We couldn't read what the world holds. Publishing is still allowed: with
// --multi-scene the worst a publish can do is replace a scene on our own
// parcels, and a failed read buys no safety by blocking a bounded write.
export interface UnreadableReview {
  kind: 'unreadable'
}

export type PublishReview = ConflictReview | UnreadableReview

export interface PublishBlock {
  kind: 'old-sdk' | 'offline'
  message: string
}

export interface PublishState {
  phase: PublishPhase
  dir: string | null
  world: string | null
  logs: string[]
  error: string | null
  jumpIn: string | null
  at: string | null // the base parcel this publish lands on, "x,y"
  total: number | null // scenes the world holds AFTER this publish; null = we can't say
  review: PublishReview | null
  blocked: PublishBlock | null
}

const IDLE: PublishState = {
  phase: 'idle',
  dir: null,
  world: null,
  logs: [],
  error: null,
  jumpIn: null,
  at: null,
  total: null,
  review: null,
  blocked: null
}
let publishStore: PublishState = IDLE
const publishListeners = new Set<() => void>()
function setPublishStore(patch: Partial<PublishState>): void {
  publishStore = { ...publishStore, ...patch }
  for (const l of publishListeners) l()
}

// ---- the running job ----

// The live job's token. Every async continuation (event handler, driveLinker
// then/catch) checks `alive` before touching the store — a cancelled/replaced
// job must not stamp state over its successor. `id` is main's jobId; null while
// publishStart is still in flight (early install logs arrive before it resolves).
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

// ---- the attempt ----

// One publish attempt, from the first pre-flight request to the spawn. Every
// async continuation checks it: a cancelled attempt — or one replaced by a
// second Publish press — must not open a dialog or spawn over its successor.
interface Preflight {
  dir: string
  world: string
  own: string | null // the entity this folder published here last time, if we know it
  parcels: string[]
  base: string | null
  lease: string | null // null when we never got to read the world
  total: number | null // what the world will hold once this lands
}
let attempt = 0
let pending: Preflight | null = null

function abandon(): number {
  pending = null
  return ++attempt
}

function live(a: number): boolean {
  return a === attempt
}

function failAttempt(a: number, err: unknown): void {
  if (!live(a)) return
  finishPublish({ phase: 'error', error: err instanceof Error ? err.message : String(err), review: null, blocked: null })
}

function block(a: number, kind: PublishBlock['kind'], message: string): void {
  if (!live(a)) return
  pending = null
  setPublishStore({ phase: 'blocked', blocked: { kind, message }, review: null })
}

// What the world will hold once this publish lands: what it holds now, minus the
// scenes we are about to stand on, plus ours. The count comes from the inventory
// the picker was rendered from, so the success sentence agrees with the sentence
// the creator read a moment earlier — reading the store back after publishing
// would report the count from BEFORE it, since the refresh has not landed yet.
function totalAfter(world: string, replacing: number): number | null {
  const c = worldSceneCount(world)
  return c.known ? Math.max(1, c.total - replacing + 1) : null
}

async function preflight(a: number, dir: string, world: string): Promise<void> {
  const wallet = getAccount()?.toLowerCase() ?? null
  const own = lastPublishedEntity(dir, world)
  const local = await readLocalFootprint(dir)
  if (!live(a)) return
  const capability = await readCapability(dir)
  if (!live(a)) return
  if (wallet !== null) {
    const denial = await deployDenial(world, wallet, local?.parcels ?? [])
    if (!live(a)) return
    if (denial !== null) {
      finishPublish({ phase: 'error', error: denial, review: null, blocked: null })
      return
    }
  }
  if (local === null) {
    // A build that can ask "Continue? (y/N)" is only dangerous when the world
    // holds scenes we don't overlap — and with no footprint of our own we can't
    // ask that question, so we don't spawn it.
    if (capability.kind === 'destructive') {
      block(a, 'old-sdk', oldSdkMessage(world))
      return
    }
    pending = { dir, world, own, parcels: [], base: null, lease: null, total: totalAfter(world, 0) }
    spawn(a)
    return
  }
  let rows: OccupyingScene[]
  try {
    rows = await fetchScenesAt(worldsServer(), world, local.parcels)
  } catch {
    if (!live(a)) return
    if (capability.kind === 'destructive') {
      block(a, 'offline', offlineOldSdkMessage(world))
      return
    }
    pending = { dir, world, own, parcels: local.parcels, base: local.base, lease: null, total: null }
    setPublishStore({ phase: 'review', at: local.base, review: { kind: 'unreadable' }, blocked: null })
    return
  }
  if (!live(a)) return
  if (capability.kind === 'destructive') {
    const verdict = await destructiveVerdict(world, local.parcels)
    if (!live(a)) return
    if (verdict === 'unreadable') {
      block(a, 'offline', offlineOldSdkMessage(world))
      return
    }
    if (verdict === 'block') {
      block(a, 'old-sdk', oldSdkMessage(world))
      return
    }
  }
  pending = {
    dir,
    world,
    own,
    parcels: local.parcels,
    base: local.base,
    lease: leaseOf(rows),
    total: totalAfter(world, rows.length)
  }
  const conflicts = conflictsFor(rows, own)
  if (conflicts.length === 0) {
    spawn(a)
    return
  }
  setPublishStore({
    phase: 'review',
    at: local.base,
    blocked: null,
    review: { kind: 'conflict', scenes: conflicts, mine: local.parcels, move: null, moveNote: null, working: false }
  })
}

// Publish `dir` to `world`. Nothing is spawned until the pre-flight answered:
// worst case it costs one request, best case it is the difference between an
// update and someone else's scene disappearing.
export function startPublish(dir: string, world: string): void {
  const shell = window.editorShell
  if (shell?.publishStart === undefined || shell.onPublishEvent === undefined || shell.setWorldName === undefined) {
    setPublishStore({ ...IDLE, phase: 'error', error: NEEDS_DESKTOP, dir, world })
    return
  }
  if (publishStore.phase === 'checking' || publishStore.phase === 'building' || publishStore.phase === 'uploading') return
  if (!hasValidIdentity()) {
    setPublishStore({ ...IDLE, phase: 'error', error: SIGN_IN_TO_PUBLISH, dir, world })
    return
  }
  const name = world.toLowerCase()
  const a = abandon()
  setPublishStore({ ...IDLE, phase: 'checking', dir, world: name })
  void preflight(a, dir, name).catch((err: unknown) => failAttempt(a, err))
}

// ---- the decisions ----

// Replace and publish / Publish anyway. The world is read once more first: a
// conflict takes time to read, and the sentence the creator agreed to has to
// still be true when they press it.
export function confirmPublish(): void {
  const p = pending
  if (p === null || publishStore.phase !== 'review') return
  const a = attempt
  setPublishStore({ phase: 'checking' })
  void (async () => {
    if (p.lease !== null) {
      // A failed re-read is not evidence that anything moved, and --multi-scene
      // bounds the write to the parcels they just agreed to replace.
      const rows = await fetchScenesAt(worldsServer(), p.world, p.parcels).catch(() => null)
      if (!live(a)) return
      if (rows !== null && leaseChanged(p.lease, leaseOf(rows))) {
        finishPublish({ phase: 'error', error: leaseChangedMessage(p.world), review: null })
        return
      }
    }
    spawn(a)
  })().catch((err: unknown) => failAttempt(a, err))
}

function patchReview(patch: Partial<ConflictReview>): void {
  const r = publishStore.review
  if (r === null || r.kind !== 'conflict') return
  setPublishStore({ review: { ...r, ...patch } })
}

// Where this exact footprint fits without standing on anyone. The creator's own
// scene is excluded from the occupied set — a republish must not be pushed off
// its own parcels.
//
// fetchWorldScenes never throws: a world it could not read comes back as an
// empty one with `sceneCount.known` false. Taking that at face value would let
// the search accept ring 0 — the parcels we are colliding on — and "move" the
// scene exactly where it already is, reopening the same dialog with nothing
// said. So the rows the dialog is showing seed the occupied set, and an unknown
// world is reported rather than searched.
export function previewMove(): void {
  const p = pending
  const r = publishStore.review
  const base = p?.base ?? null
  if (p === null || r === null || r.kind !== 'conflict' || base === null) return
  const a = attempt
  patchReview({ working: true, moveNote: null })
  void (async () => {
    const { scenes, sceneCount } = await fetchWorldScenes(p.world)
    if (!live(a)) return
    if (!sceneCount.known) {
      patchReview({ working: false, moveNote: moveUnreadableLine(p.world) })
      return
    }
    const occupied: string[] = r.scenes.flatMap((s) => s.parcels)
    for (const s of scenes) {
      if (p.own === null || s.entityId !== p.own) occupied.push(...s.parcels)
    }
    const to = nearestFreeFootprint(base, p.parcels, occupied)
    if (to === null) patchReview({ working: false, moveNote: MOVE_UNAVAILABLE })
    else patchReview({ working: false, move: to })
  })().catch((err: unknown) => failAttempt(a, err))
}

export function cancelMove(): void {
  patchReview({ move: null, moveNote: null })
}

// Write the new footprint to scene.json, then start the check over: the moved
// scene is a different scene as far as the world is concerned.
export function confirmMove(): void {
  const p = pending
  const r = publishStore.review
  const shell = window.editorShell
  const read = shell?.sceneSettings
  const save = shell?.saveSceneSettings
  if (p === null || r === null || r.kind !== 'conflict' || r.move === null) return
  if (read === undefined || save === undefined) {
    finishPublish({ phase: 'error', error: NEEDS_DESKTOP, review: null })
    return
  }
  const to = r.move
  const a = attempt
  patchReview({ working: true })
  void (async () => {
    const settings = await read(p.dir)
    if (!live(a)) return
    const err = await save(p.dir, { ...settings, parcels: to.parcels, base: to.base })
    if (!live(a)) return
    if (err !== null) {
      finishPublish({ phase: 'error', error: err, review: null })
      return
    }
    setPublishStore({ phase: 'checking', review: null, at: to.base })
    await preflight(a, p.dir, p.world)
  })().catch((err: unknown) => failAttempt(a, err))
}

// ---- the spawn ----

// Sign the entity and hand it to the linker: the POST returns once the upload
// to the worlds content server finished (or failed). The rootCID we signed IS
// the entity id the world stores, which is how the next publish from this folder
// recognises its own scene instead of asking to replace it.
async function driveLinker(port: number): Promise<string> {
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
  return info.rootCID
}

function spawn(a: number): void {
  if (!live(a)) return
  const p = pending
  const shell = window.editorShell
  const publishStartShell = shell?.publishStart
  const setWorldName = shell?.setWorldName
  if (p === null || shell === undefined || publishStartShell === undefined || shell.onPublishEvent === undefined || setWorldName === undefined) {
    finishPublish({ phase: 'error', error: NEEDS_DESKTOP, review: null, blocked: null })
    return
  }
  const token: JobToken = { id: null, alive: true }
  jobToken = token
  setPublishStore({
    phase: 'building',
    at: p.base,
    total: null,
    logs: [],
    error: null,
    jumpIn: null,
    review: null,
    blocked: null
  })
  let uploading = false
  let sawPrompt = false
  unsubPublish = shell.onPublishEvent((e) => {
    if (!token.alive) return
    // before publishStart resolves we don't know our jobId — accept only the
    // (cosmetic) install logs then; ready/exit must match our job exactly
    if (token.id === null ? e.kind !== 'log' : e.jobId !== token.id) return
    if (e.kind === 'log') {
      if (looksLikeBlockingPrompt(e.line)) sawPrompt = true
      const logs = [...publishStore.logs, e.line]
      if (logs.length > LOG_CAP) logs.splice(0, logs.length - LOG_CAP)
      setPublishStore({ logs })
    } else if (e.kind === 'ready') {
      uploading = true
      setPublishStore({ phase: 'uploading' })
      driveLinker(e.port)
        .then((entityId) => {
          if (!token.alive) return // cancelled mid-upload
          rememberPublishedEntity(p.dir, p.world, entityId)
          finishPublish({ phase: 'success', jumpIn: jumpInUrl(p.world), total: p.total })
          refreshWorlds() // the tab should show the new deployment right away
        })
        .catch((err: unknown) => {
          if (!token.alive) return // cancelled — the connection reset is ours
          void shell.publishStop?.()
          finishPublish({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
        })
    } else if (e.kind === 'exit') {
      const verdict = classifyPublishExit({ ready: uploading, code: e.code, sawPrompt }, p.world)
      if (verdict.kind === 'ignored') return
      const tail = publishStore.logs.slice(-6).join('\n')
      finishPublish({ phase: 'error', error: `${verdict.message}\n${tail}` })
    }
  })
  void (async () => {
    await setWorldName(p.dir, p.world)
    if (!token.alive) return
    const { jobId } = await publishStartShell(p.dir, worldsServer())
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
  abandon()
  void window.editorShell?.publishStop?.()
  finishPublish({ phase: 'idle', error: null, jumpIn: null, review: null, blocked: null })
}

// clear a finished (success/error/blocked) publish so the modal returns to the picker
export function resetPublish(): void {
  if (publishStore.phase === 'idle' || publishStore.phase === 'building' || publishStore.phase === 'uploading') return
  abandon()
  finishPublish({ ...IDLE })
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
