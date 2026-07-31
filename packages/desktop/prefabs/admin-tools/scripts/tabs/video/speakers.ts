// Live participants of the DCL Cast room, refreshed from the explorer's comms
// state. The Hub polls on a 5s interval; scenes have no setInterval, so the poll
// rides one engine system registered once for the lifetime of the scene and does
// nothing unless the speaker list is on screen.
import { engine } from '@dcl/sdk/ecs'
import { getActiveStreams, groupTracks } from './api'
import { videoTab } from './state'

const POLL_SECONDS = 5

let registered = false
let countdown = 0
let inFlight = false

async function poll(): Promise<void> {
  inFlight = true
  try {
    videoTab.participants = groupTracks(await getActiveStreams())
  } finally {
    inFlight = false
  }
}

export function refreshSpeakers(): void {
  if (inFlight) return
  countdown = POLL_SECONDS
  void poll()
}

export function ensureSpeakerPolling(): void {
  if (registered) return
  registered = true
  engine.addSystem((dt: number) => {
    if (!videoTab.showSpeakers) {
      countdown = 0
      return
    }
    countdown -= dt
    if (countdown > 0 || inFlight) return
    countdown = POLL_SECONDS
    void poll()
  })
}
