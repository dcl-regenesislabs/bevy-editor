// Page-side client for the editor bus over a same-origin BroadcastChannel
// (editor-channel.ts): posts page→scene messages, receives scene→page messages,
// and exposes an rpc helper the scene answers by proxying to its local BevyApi.
// Replaces the old /editor_poll + /editor_send console bus (patched-engine only) —
// BroadcastChannel works on stock main.
import {
  type PageToSceneMessage,
  type SceneToPageMessage
} from '../../scene/src/bridge-protocol'
import { EDITOR_BUS_CHANNEL, type BusEnvelope } from '../../scene/src/editor-channel'
import { RPC_TIMEOUT_MS } from './config'

// `?editorDebug` traces every bus message to the console, timestamped — the
// tool for diagnosing desyncs (stale gizmo, transform snap-back) in the field.
const DEBUG = new URLSearchParams(window.location.search).has('editorDebug')
function trace(dir: 'page→scene' | 'scene→page', payload: unknown): void {
  if (!DEBUG) return
  console.log(`[editor-bus ${new Date().toISOString().slice(11, 23)}] ${dir}`, payload)
}

type Listener = (msg: SceneToPageMessage) => void

const listeners = new Set<Listener>()
const pendingRpcs = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>()
let nextRpcId = 1
let started = false

const channel = new BroadcastChannel(EDITOR_BUS_CHANNEL)

export function onSceneMessage(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function sendToScene(msg: PageToSceneMessage): Promise<void> {
  trace('page→scene', msg)
  channel.postMessage({ to: 'scene', msg } satisfies BusEnvelope<PageToSceneMessage>)
}

export async function sceneRpc<T>(method: string, args?: unknown[]): Promise<T> {
  const id = nextRpcId++
  const reply = new Promise<unknown>((resolve, reject) => {
    pendingRpcs.set(id, { resolve, reject })
    setTimeout(() => {
      if (pendingRpcs.delete(id)) reject(new Error(`rpc ${method} timed out`))
    }, RPC_TIMEOUT_MS)
  })
  await sendToScene({ type: 'rpc', id, method, args })
  return (await reply) as T
}

// Start listening for scene→page messages. (Name kept for the boot caller; it now
// wires the channel listener instead of a poll loop.)
export function startBusPolling(): void {
  if (started) return
  started = true
  channel.onmessage = (ev: MessageEvent): void => {
    const env = ev.data as BusEnvelope<SceneToPageMessage> | null
    if (env === null || typeof env !== 'object' || env.to !== 'page') return
    dispatch(env.msg)
  }
}

function dispatch(msg: SceneToPageMessage): void {
  trace('scene→page', msg)
  if (msg.type === 'rpc-reply') {
    const pending = pendingRpcs.get(msg.id)
    if (pending !== undefined) {
      pendingRpcs.delete(msg.id)
      if (msg.ok) pending.resolve(msg.result)
      else pending.reject(new Error(msg.error ?? 'rpc failed'))
    }
    return
  }
  for (const fn of listeners) fn(msg)
}
