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

declare global {
  interface Window {
    __bevyBootConfig?: { systemScene?: string; portables?: string; preview?: boolean }
    __bevyReadyToLaunch?: boolean
    __bevyLaunch?: (realm?: string, position?: string) => void
  }
}

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
const systemScene = params.get('systemScene') ?? 'http://localhost:8005'

window.__bevyBootConfig = { systemScene }

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

async function launchWhenReady(): Promise<void> {
  await waitForServer(`${systemScene}/about`, 120_000)
  while (window.__bevyReadyToLaunch !== true) {
    await new Promise((r) => setTimeout(r, 100))
  }
  window.__bevyLaunch?.(realm, position)
}

void launchWhenReady()

export {}
