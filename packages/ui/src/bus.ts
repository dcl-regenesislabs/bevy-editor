// Page-side client for the editor message bus: polls `/editor_poll page`,
// pushes with `/editor_send scene <json>`, and exposes an rpc helper that the
// scene answers by proxying to its local BevyApi.
import {
  type PageToSceneMessage,
  type SceneToPageMessage
} from '../../scene/src/bridge-protocol'
import { cmd } from './cmd'
import { RPC_TIMEOUT_MS } from './config'

const POLL_INTERVAL_MS = 100

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
let polling = false

export function onSceneMessage(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function sendToScene(msg: PageToSceneMessage): Promise<void> {
  trace('page→scene', msg)
  await cmd.editorSend('scene', JSON.stringify(msg))
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

export function startBusPolling(): void {
  if (polling) return
  polling = true
  void pollLoop()
}

async function pollLoop(): Promise<void> {
  for (;;) {
    try {
      const messages = await cmd.editorPoll('page')
      for (const raw of messages) {
        let msg: SceneToPageMessage
        try {
          msg = JSON.parse(raw) as SceneToPageMessage
        } catch {
          console.warn('editor bus: bad message', raw)
          continue
        }
        dispatch(msg)
      }
    } catch (e) {
      console.warn('editor bus poll failed', e)
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
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
