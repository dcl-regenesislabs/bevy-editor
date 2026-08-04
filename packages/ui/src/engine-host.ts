// Engine host page (engine.html): boots the bevy engine in this document using
// the upstream boot contract (deploy/web/engine/boot.js, new since the react-web
// shell replaced the old self-booting index.html). The editor loads this page in
// its same-origin iframe; the RPC seam is unchanged — boot.js/engine.js attach
// window.engine_console_command here after launch, which the host reaches via
// iframe.contentWindow (see ./console.ts).
//
// Contract: set window.__bevyBootConfig BEFORE injecting /engine/boot.js, wait
// for __bevyReadyToLaunch, then call __bevyLaunch(realm, position). PUBLIC_URL
// stays unset so engine.js resolves pkg/ relative to its own module — i.e. the
// same-origin /engine/ dir this server serves from the npm package.

import { EDITOR_BUS_CHANNEL, type BusEnvelope } from '../../scene/src/editor-channel'
import type { PageToSceneMessage } from '../../scene/src/bridge-protocol'
import { isMod } from './lib/keys'

declare global {
  interface Window {
    __bevyBootConfig?: { systemScene?: string; portables?: string; preview?: boolean }
    __bevyReadyToLaunch?: boolean
    __bevyLaunch?: (realm?: string, position?: string) => void
  }
}

// Right-click is the engine's camera-look binding — the browser context menu
// would swallow the hold. react-web suppresses it the same way (main.tsx).
window.addEventListener('contextmenu', (e) => e.preventDefault())

// Cmd+click (Ctrl on Windows/Linux) = editor pick, even while the scene plays.
// The modifier never reaches engine input, so it's detected here in the DOM and
// relayed to the editor scene over the bus; the scene raycasts at the current
// cursor. Shift extends the selection, Alt toggles — mirroring edit-mode clicks.
const bus = new BroadcastChannel(EDITOR_BUS_CHANNEL)
window.addEventListener(
  'pointerdown',
  (e) => {
    if (!isMod(e) || e.button !== 0) return
    const envelope: BusEnvelope<PageToSceneMessage> = {
      to: 'scene',
      msg: { type: 'pick-at-pointer', add: e.shiftKey, toggle: e.altKey }
    }
    bus.postMessage(envelope)
  },
  true
)

// the old boot page registered the service worker (asset caching; the engine's
// wasm asset processor reads/writes the same cache) — that duty is ours now
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service_worker.js').catch((e) => {
      console.warn('[engine-host] service worker registration failed', e)
    })
  })
}

const params = new URLSearchParams(window.location.search)
const realm = params.get('realm') ?? 'http://localhost:8004'
const position = params.get('position') ?? '0,0'
// `?systemScene=off` boots the engine with NO editor scene. It's the A/B for
// "is the editor's own scene what's slowing this project's startup" — same
// engine build, same realm, same parcel, one variable removed. Open this page
// directly in a browser (the app's web server sends the COOP/COEP headers the
// engine needs) to compare against the deployed client.
const systemScene = params.get('systemScene') ?? 'http://localhost:8005'
const noSystemScene = systemScene === 'off'

window.__bevyBootConfig = noSystemScene ? {} : { systemScene }

// runtime script tag (not an import): boot.js ships in the engine npm package
// and must load from the served /engine/ dir, outside the Vite module graph
const boot = document.createElement('script')
boot.type = 'module'
boot.src = '/engine/boot.js'
boot.onerror = () => console.error('[engine-host] failed to load /engine/boot.js')
document.head.appendChild(boot)

// The engine fetches `<systemScene>/about` exactly ONCE at launch
// (restricted_actions lookup_portable) — a refused connection silently drops the
// editor scene forever. The old shell booted slowly enough to always lose that
// race; the new boot is ~instant (GPU/wasm caches), so hold the launch until the
// scene server actually answers.
async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.warn(`[engine-host] ${url} still not answering — launching anyway`)
}

// This frame's own stage of the attach. It can't reach the page's timeline
// module (separate bundle, separate document), so it logs with the same [boot]
// prefix — devtools shows both frames in one console.
const T0 = Date.now()
function hostTrace(phase: string): void {
  console.log(`[boot ${((Date.now() - T0) / 1000).toFixed(1)}s] engine-host: ${phase}`)
}

async function launchWhenReady(): Promise<void> {
  if (noSystemScene) {
    hostTrace('systemScene=off — launching with no editor scene')
  } else {
    hostTrace(`waiting for ${systemScene}/about`)
    await waitForServer(`${systemScene}/about`, 120_000)
    hostTrace('editor scene server answering')
  }
  while (window.__bevyReadyToLaunch !== true) {
    await new Promise((r) => setTimeout(r, 100))
  }
  hostTrace('engine wasm ready to launch')
  window.__bevyLaunch?.(realm, position)
  hostTrace(`launched at ${position} on ${realm}`)
}

void launchWhenReady()

export {}
