// Timings for the editor scene's attach sequence (run → login → resolve → pin →
// snapshot). A slow attach used to be indistinguishable from a wedged one: the
// page just sat on "waiting for scene" with no way to tell whether the engine
// was still loading a 70-parcel scene's models or nothing was running at all.
//
// Every step is logged AND posted on the bus, because the scene's console goes
// to the engine's own log — devtools never shows it. The page turns the posts
// into a single timeline (ui/boot-trace.ts).
//
// The whole trace is replayed on `init`: the page's listener attaches later than
// the scene's first steps, and BroadcastChannel does not buffer.
import { EDITOR_BUS_CHANNEL, type BusEnvelope } from './editor-channel'
import { type SceneToPageMessage } from './bridge-protocol'

declare const BroadcastChannel: {
  new (name: string): { postMessage: (msg: unknown) => void }
}

interface TraceEntry {
  phase: string
  step: number
  total: number
  detail: string
}

// module init = the first instant the scene can measure (the engine has fetched
// the bundle and started running it)
const T0 = Date.now()
const entries: TraceEntry[] = []
const channel = new BroadcastChannel(EDITOR_BUS_CHANNEL)
let last = T0

function post(e: TraceEntry): void {
  const msg: SceneToPageMessage = {
    type: 'boot-trace',
    phase: e.phase,
    step: e.step,
    total: e.total,
    detail: e.detail
  }
  channel.postMessage({ to: 'page', msg } satisfies BusEnvelope<SceneToPageMessage>)
}

export function trace(phase: string, detail = ''): void {
  const now = Date.now()
  const e = { phase, step: now - last, total: now - T0, detail }
  last = now
  entries.push(e)
  console.log(`[boot ${(e.total / 1000).toFixed(1)}s +${e.step}ms] ${phase}${detail === '' ? '' : ` — ${detail}`}`)
  post(e)
}

export function replayTrace(): void {
  for (const e of entries) post(e)
}

// Run `work`, trace how long it took, and let the caller describe the result.
// Failures are traced too — a step that threw after 8s is the interesting one.
export async function traced<T>(
  phase: string,
  work: () => Promise<T>,
  detail?: (value: T) => string
): Promise<T> {
  const started = Date.now()
  try {
    const value = await work()
    trace(phase, `${Date.now() - started}ms${detail === undefined ? '' : ` — ${detail(value)}`}`)
    return value
  } catch (e) {
    trace(phase, `FAILED after ${Date.now() - started}ms — ${String(e)}`)
    throw e
  }
}
