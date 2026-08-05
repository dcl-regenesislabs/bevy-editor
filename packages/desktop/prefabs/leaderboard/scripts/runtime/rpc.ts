import { engine, Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'
import { PendingMap } from './pure/pending'

// Request/response RPC over registerMessages: requestId correlation, replies
// targeted to the caller only (never broadcast-then-filter), timeout + retry.
// The instigator is always context.from — the server-verified wallet — and the
// payload can never carry an identity.
//
// createRpc() registers message schemas, so call it at MODULE SCOPE (the
// engine seals after start). Payloads are JSON strings — keep them small, the
// transport drops messages over ~13 KB.
//
//   const rpc = createRpc('coin')                       // module scope
//   // server: rpc.handle('claim', (body, from) => ({ ok: true }))
//   // client: const res = await rpc.call('claim', { coin: 5 })

const TIMEOUT_S = 4
const RETRIES = 2

type Handler = (body: unknown, from: string) => unknown | Promise<unknown>
type Req = { id: string; method: string; body: string }
type Res = { id: string; ok: boolean; body: string }

export interface Rpc {
  /** Server: register the handler for a method. The return value is the reply. */
  handle(method: string, handler: Handler): void
  /** Client: call a method, resolves with the server's reply. */
  call<T = unknown>(method: string, body?: unknown): Promise<T>
}

export function createRpc(namespace: string): Rpc {
  const room = registerMessages({
    [`${namespace}.rpc.req`]: Schemas.Map({
      id: Schemas.String,
      method: Schemas.String,
      body: Schemas.String
    }),
    [`${namespace}.rpc.res`]: Schemas.Map({
      id: Schemas.String,
      ok: Schemas.Boolean,
      body: Schemas.String
    })
  })

  const handlers = new Map<string, Handler>()
  const pending = new PendingMap<unknown>()
  const resend = new Map<string, { method: string; body: string }>()
  let counter = 0
  let clientStarted = false
  let serverStarted = false

  function startServer(): void {
    if (serverStarted) return
    serverStarted = true
    room.onMessage(`${namespace}.rpc.req`, (raw, context) => {
      if (!context) return
      const data = raw as Req
      void (async () => {
        let ok = true
        let result: unknown = null
        try {
          const handler = handlers.get(data.method)
          if (!handler) throw new Error(`no handler: ${data.method}`)
          result = await handler(data.body === '' ? undefined : JSON.parse(data.body), context.from)
        } catch (e) {
          ok = false
          result = e instanceof Error ? e.message : String(e)
        }
        // always respond, targeted — a silent server wedges the caller
        room.send(`${namespace}.rpc.res`, { id: data.id, ok, body: JSON.stringify(result ?? null) }, { to: [context.from] })
      })()
    })
  }

  function startClient(): void {
    if (clientStarted) return
    clientStarted = true
    room.onMessage(`${namespace}.rpc.res`, (raw) => {
      const data = raw as Res
      resend.delete(data.id)
      if (data.ok) pending.settle(data.id, data.body === '' ? null : JSON.parse(data.body))
      else pending.fail(data.id, new Error(String(JSON.parse(data.body))))
    })
    let accum = 0
    engine.addSystem((dt: number) => {
      accum += dt
      if (accum < 1) return
      accum = 0
      for (const id of pending.tick(Date.now(), TIMEOUT_S * 1000)) {
        const req = resend.get(id)
        if (!req) continue
        try {
          room.send(`${namespace}.rpc.req`, { id, method: req.method, body: req.body })
        } catch {
          /* transport down — next tick retries again */
        }
      }
    }, undefined, `runtime-rpc-${namespace}`)
  }

  return {
    handle(method, handler) {
      handlers.set(method, handler)
      startServer()
    },
    call<T>(method: string, body?: unknown): Promise<T> {
      startClient()
      const id = `${namespace}:${++counter}:${Math.floor(Math.random() * 0xffffff).toString(36)}`
      const payload = body === undefined ? '' : JSON.stringify(body)
      return new Promise<T>((resolve, reject) => {
        pending.add(id, {
          resolve: (v) => {
            resend.delete(id)
            resolve(v as T)
          },
          reject: (e) => {
            resend.delete(id)
            reject(e)
          },
          sentAtMs: Date.now(),
          retriesLeft: RETRIES
        })
        resend.set(id, { method, body: payload })
        try {
          room.send(`${namespace}.rpc.req`, { id, method, body: payload })
        } catch {
          /* transport not up — the retry system resends */
        }
      })
    }
  }
}
