// Server logs (multiplayer server).
// Scenes with authoritativeMultiplayer run server-side on the multiplayer
// server, which exposes their runtime output as a signed SSE stream on /logs —
// the same endpoint `sdk-commands sdk-server-logs` tails. The target scene
// travels in the signed metadata: sceneId/realmName carry the world NAME (the
// server resolves it to the current deployment), parcel picks the scene in a
// multi-scene world. Readable by the world owner, deployment collaborators and
// wallets in the scene's `logsPermissions`.
import { multiplayerServer } from './endpoints'
import { signedFetch } from './signed-fetch'
import { parseServerLogLine, type ServerLogLine } from '../../lib/server-logs'

export type { ServerLogLevel, ServerLogLine } from '../../lib/server-logs'

function serverLogsError(status: number): Error {
  if (status === 401 || status === 403)
    return new Error('Only the world owner, collaborators or wallets in logsPermissions can view server logs')
  if (status === 404) return new Error('No server-side scene found for this world')
  return new Error(`The log stream request failed (${status}) — try again`)
}

// Open the signed SSE connection and pump parsed lines to `onLine` until the
// stream ends or `signal` aborts. Resolves on natural end; rejects on a
// non-aborted failure so the caller can surface an error state.
export async function streamServerLogs(opts: {
  world: string
  parcel: string
  signal: AbortSignal
  onOpen: () => void
  onLine: (line: ServerLogLine) => void
}): Promise<void> {
  const name = opts.world.toLowerCase()
  const res = await signedFetch(
    `${multiplayerServer()}/logs`,
    { method: 'GET', headers: { Accept: 'text/event-stream' }, signal: opts.signal },
    { parcel: opts.parcel, realmName: name, sceneId: name }
  )
  if (!res.ok || res.body === null) throw serverLogsError(res.status)
  opts.onOpen()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let counter = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const raw of lines) {
      const parsed = parseServerLogLine(raw, counter, Date.now())
      if (parsed !== null) {
        counter += 1
        opts.onLine(parsed)
      }
    }
  }
}
