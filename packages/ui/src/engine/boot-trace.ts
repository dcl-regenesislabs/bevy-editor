// One timeline for the whole attach, assembled in the page — the only place that
// can see all three actors. The engine host reports the iframe launch, the page
// reports its own gates, and the editor scene posts its steps over the bus
// (scene/boot-trace.ts) because its console only reaches the engine log.
//
// Everything lands in the devtools console under `[boot]`, and the full table is
// available as `__euiBoot.print()` — the answer to "where did those 90 seconds
// go" without having to catch the log live.
import type { SceneToPageMessage } from '@scene/bridge-protocol'

export interface BootTraceEntry {
  at: number // ms since the page started booting
  source: 'page' | 'scene'
  phase: string
  detail: string
  sceneTotal?: number // the scene's own clock, which starts when its bundle runs
}

const T0 = Date.now()
const entries: BootTraceEntry[] = []

function push(e: BootTraceEntry): void {
  entries.push(e)
  const seconds = e.at / 1000
  const what = `${e.phase}${e.detail === '' ? '' : ` — ${e.detail}`}`
  console.log(`[boot ${seconds.toFixed(1).padStart(5)}s] ${e.source === 'scene' ? 'scene: ' : ''}${what}`)
}

export function pageTrace(phase: string, detail = ''): void {
  push({ at: Date.now() - T0, source: 'page', phase, detail })
}

export function recordSceneTrace(msg: Extract<SceneToPageMessage, { type: 'boot-trace' }>): void {
  // a replay repeats entries the page already has — key on the scene's own clock
  if (entries.some((e) => e.source === 'scene' && e.sceneTotal === msg.total && e.phase === msg.phase)) return
  push({
    at: Date.now() - T0,
    source: 'scene',
    phase: msg.phase,
    detail: msg.detail ?? '',
    sceneTotal: msg.total
  })
}

// Gaps, not timestamps: the interesting row is the one that took 40 seconds.
export function printBootTimeline(): void {
  let prev = 0
  const rows = entries.map((e) => {
    const gap = e.at - prev
    prev = e.at
    return {
      't (s)': (e.at / 1000).toFixed(1),
      '+ (s)': (gap / 1000).toFixed(1),
      where: e.source,
      phase: e.phase,
      detail: e.detail
    }
  })
  console.table(rows)
}

// Wrap a boot step so its duration is recorded even when it throws.
export async function pageTraced<T>(
  phase: string,
  work: () => Promise<T>,
  detail?: (value: T) => string
): Promise<T> {
  const started = Date.now()
  try {
    const value = await work()
    pageTrace(phase, `${Date.now() - started}ms${detail === undefined ? '' : ` — ${detail(value)}`}`)
    return value
  } catch (e) {
    pageTrace(phase, `FAILED after ${Date.now() - started}ms — ${String(e)}`)
    throw e
  }
}

interface BootTraceApi {
  entries: BootTraceEntry[]
  print: () => void
}

;(window as unknown as { __euiBoot: BootTraceApi }).__euiBoot = { entries, print: printBootTimeline }
