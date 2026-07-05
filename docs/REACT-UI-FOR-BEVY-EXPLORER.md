# Building the bevy-explorer site UI in React — integration handoff

> **Audience:** the bevy-explorer engine team / a bevy-explorer Claude session.
> **From:** the `dcl-editor` project, which has been running a **React DOM UI on top
> of the bevy-explorer wasm engine** in production (desktop + web) for a while. This
> distills everything we learned so you can build the bevy-web **site UI in React**
> (loading/login/realm screens today; the in-world HUD later) instead of the current
> vanilla `main.js` shell + the in-engine `BevyUiScene`.
>
> Everything below marked **PROVEN** we actually ship; **CONSIDERATION** is advice
> for your site's use case (which differs from an editor).

---

## TL;DR

- A **React DOM page that hosts the engine in a same-origin `<iframe>`** works great
  and is how we run. React owns all the chrome; the engine is just a canvas + an
  RPC/event surface. **PROVEN.**
- The two non-negotiables: **(1) the page and engine must be same-origin**, and
  **(2) the page must be cross-origin isolated** (COOP/COEP/CORP) for
  WebGPU + wasm threads + `SharedArrayBuffer`.
- React ↔ engine talks over **two seams**: **host→engine console-command RPC**
  (`window.engine_console_command_args`) and **scene↔host `BroadcastChannel`**
  (exposed to the super-user scene). The engine also exposes a **`system_bridge`
  Settings/action API** to the (super-user) scene.
- The big product decision for you: the in-world HUD is currently the
  **`BevyUiScene` super-user SDK7 scene (react-ecs *inside* the engine)**. Moving
  "all UI to React" means **decoupling the HUD from that scene** and feeding it
  data/actions through the system bridge instead. That's the real work — the
  embedding/RPC plumbing below is the easy part.

---

## 1. The architecture that works

```
┌──────────────────────── React DOM page (your site) ─────────────────────────┐
│  loading screen · login · realm picker · HUD (chat/map/emotes/nametags) …    │
│                                                                              │
│   host→engine RPC:  iframe.contentWindow.engine_console_command_args(cmd,args)│
│   engine→host events: new BroadcastChannel('<name>')  (from a super-user scene)│
│                                                                              │
│   ┌──────────────── <iframe> SAME-ORIGIN ────────────────────────────────┐  │
│   │  bevy-explorer engine (index.html + main.js + pkg/webgpu_build*.wasm) │  │
│   │  WebGPU canvas · the realm's scenes · optional super-user "system"    │  │
│   │  scene that bridges to the page                                       │  │
│   └────────────────────────────────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────────────────┘
```

The engine is loaded as-is (the existing `deploy/web` bundle). React doesn't touch
the engine's internals — it drives it through the seams. You can also run React as
the **top-level** page and the engine in the same document (no iframe), but the
iframe gives you a clean lifecycle (reload the engine without reloading your UI)
and a hard origin boundary you control.

---

## 2. Hard constraints (these bit us; don't relearn them)

### 2.1 Same-origin — REQUIRED
The host page calls **into** the engine iframe (`iframe.contentWindow.engine_console_command_args(...)`).
Browsers block `contentWindow` access across origins, so the engine **must be served
from the same origin** as your React page. Also, the engine's **login session / OPFS
partition** is keyed by origin — a cross-origin engine iframe gets a different OPFS
partition, breaking "stay logged in" / `getPreviousLogin()`. **Serve the engine from
your own origin** (static-serve the bundle, or reverse-proxy it — see §5).

### 2.2 Cross-origin isolation — REQUIRED
The engine needs `SharedArrayBuffer` (wasm threads) and WebGPU, which require the
document to be **cross-origin isolated**. Every response that makes up the page +
engine must carry:
```
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: cross-origin   (on sub-resources / proxied assets)
```
Any cross-origin resource the page pulls (fonts, catalog CDNs, etc.) must send CORP
or be proxied same-origin, or the isolated context refuses it.

### 2.3 WebGPU needs a recent Chromium — this cost us a day
The engine's **`bevy_atmosphere` compute pipeline writes a float storage texture**
(`rgba16float`). **Chromium ≤130 does not support float-format `STORAGE_BINDING`**, so
the atmosphere compute pipeline comes back **invalid → the whole frame's command
buffer is rejected → black screen**. (The engine even logs it for SSAO:
`R16Float does not support TextureUsages::STORAGE_BINDING`.) **Chromium ~148 works.**
- In a **real browser**: fine — any current Chrome/Edge is new enough.
- If you ever wrap this in **Electron**: you need a recent Electron. We had to bump
  **Electron 33 → 42** (Chromium 130 → 148). Electron 33 rendered a black viewport;
  42 renders. (We confirmed by loading the *same* bundle in both.)
- The same wasm that 404'd/blacked-out for us ran fine at `decentraland.zone/bevy-web`
  in stable Chrome — it was purely the embedding browser's WebGPU version.

---

## 3. Loading & parameterizing the engine

The engine entry is `index.html` → `main.js` (an ES module that
`import`s `./pkg/webgpu_build.js` **relatively**). `main.js` reads query params to
auto-start:

| Query param | Meaning |
|---|---|
| `initialRealm` | realm URL (e.g. `https://realm-provider-ea.decentraland.org/main`) |
| `location` | parcel `x,y` to spawn at |
| `systemScene` | URL of a **super-user** scene to load as the `--ui` scene (the HUD slot) |
| `manualParams` | if present, suppresses auto-start (you call init yourself) |

So the React host just sets the iframe `src` to
`/<engine>/index.html?initialRealm=…&location=…&systemScene=…` and the engine boots.

**Readiness handshake:** the engine attaches its RPC functions to `window` only after
it's booted. Poll for them before calling:
```ts
function engineReady(w: Window): boolean {
  return typeof (w as any).engine_console_command_args === 'function'
      || typeof (w as any).engine_console_command === 'function'
}
// await a few hundred ms in a loop until engineReady(iframe.contentWindow)
```

---

## 4. The two communication seams

### 4.1 Host → engine: console-command RPC (PROVEN)
The engine exposes on its window:
```ts
interface EngineWindow extends Window {
  engine_console_command_args?: (cmd: string, args: string[]) => Promise<string>
  engine_console_command?:      (line: string) => Promise<string>   // older form
}
// every console command is callable; the reply is the command's stringified output
await iframe.contentWindow.engine_console_command_args('move_player_to', ['8','1','16'])
```
This is how we drive **everything** — read state, mutate scenes, control playback,
etc. We wrap it in a typed layer (`makeCommands(raw)`) so each command is a typed
method instead of stringly-typed calls. The full read/write command catalog lives in
`scene_inspector` (and the core console). For a site UI you'd mostly use the
player/realm/scene/settings commands.

> **Tip:** keep the raw transport behind one module (one `consoleCommand(cmd,args)`
> function) so the same typed surface works whether the engine is in this window or
> an iframe — only `setEngineWindow(iframe.contentWindow)` differs.

### 4.2 Engine (scene) ↔ host: `BroadcastChannel` (PROVEN)
For the engine to **push** to the page (selection, state, events) or for the page to
drive an in-engine scene, use a same-origin **`BroadcastChannel`**. Upstream
**exposes `BroadcastChannel` only to the trusted super-user (`--ui`) scene sandbox**
(see `deploy/web/sandbox_worker.js` — the `isSuper` allow-list). Both sides
`new BroadcastChannel('<name>')`; it spans the window, the iframe, and the scene
worker transparently. We use a tiny addressed envelope so each side ignores its own
posts:
```ts
// shared
export const CH = 'your-bus-name'
type Envelope<M> = { to: 'page' | 'scene'; msg: M }
// page:  channel.postMessage({ to:'scene', msg })   ;  onmessage → if e.to==='page' handle(e.msg)
// scene: channel.postMessage({ to:'page',  msg })   ;  onmessage → if e.to==='scene' handle(e.msg)
```
This replaced an older console-command "bus" for us and works on **stock upstream**
(no engine changes), precisely because #843 exposed `BroadcastChannel` to the
super-user scene.

### 4.3 The `system_bridge` Settings/Action API (engine-side, for the scene)
The engine's `system_bridge` crate exposes a **SystemApi** to the (super-user) scene
(`~system/BevyExplorerApi` + `crates/dcl/src/js/modules/SystemApi.js`). Relevant for a
HUD:
- `getSettings()` / `setSetting(name, value)` — graphics/quality settings (e.g. DoF,
  shadows). We used `setSetting` to toggle depth-of-field from the scene.
- `getSystemActionStream()` — an async stream of system actions (jump, emote-wheel,
  etc.) — **super-user only**.
- `getInputBindings()` — current key bindings — **super-user only**.
- login: `getPreviousLogin()`, `loginPrevious()`, `loginGuest()`.
- `liveSceneInfo()` — currently-loaded scenes.

For a React HUD, the pattern is: a thin super-user "system" scene subscribes to these
engine APIs and **relays the data to the React page over `BroadcastChannel`**, and
relays page actions back into the engine (or the page calls console commands
directly). The scene becomes a bridge; React becomes the UI.

---

## 5. Where the engine bundle comes from (serving)

The bundle = `index.html`, `main.js`, `gpu_cache.js`, `sandbox_worker.js`,
`service_worker.js`, `asset_loader.js`, and `pkg/{webgpu_build.js, webgpu_build_bg.wasm}`
(the wasm is ~110 MB). Options:

- **npm package `@dcl-regenesislabs/bevy-explorer-web`** — **the `@next` dist-tag
  tarball includes the wasm** (~111 MB; `npm view …@next dist.fileCount` shows
  `pkg/webgpu_build_bg.wasm`). `npm install` → a complete engine in `node_modules`;
  serve that dir same-origin. **Note the `latest` tag is stale and lacks the wasm —
  use `next`.** (`main.js` loads `./pkg/…` relatively, so serving from `node_modules`
  works same-origin; the published `index.html` sets `window.PUBLIC_URL` to the CDN
  but loads `main.js` relatively.)
- **CDN deterministic snapshots** — CI (`oddish-action`) also uploads each version
  to `https://cdn.decentraland.org/@dcl-regenesislabs/bevy-explorer-web/<version>/…`,
  **wasm included**, **per version** (pinnable). This is what `prebuild.js` hard-codes
  as `PUBLIC_URL` and what `decentraland.zone/bevy-web` serves.
- **unpkg proxy** — `opendcl-studio` proxies
  `https://unpkg.com/@dcl-regenesislabs/bevy-explorer-web@<version>/<path>` through a
  same-origin server function (because Cloudflare Pages refuses to host the >25 MB
  wasm as a static asset). Good pattern if you deploy to a host with asset-size caps.

Whatever you pick, **serve it same-origin with the COOP/COEP/CORP headers (§2.2)**.
A ~30-line static server (or a dev-server middleware) that streams the dir with those
headers is all it takes. For dev, resolving the dir from the installed npm package
(`require.resolve('@dcl-regenesislabs/bevy-explorer-web/package.json')`) is convenient.

---

## 6. Rendering engine content *into* React (optional)

If you want a 3D view composited inside a React panel (not just the fullscreen
canvas), the engine's SDK7 **`TextureCamera` + `CameraLayer`** render a chosen layer
to a texture; a scene-side react-ecs panel can show it as a `videoTexture`. We use
this for editor gizmos (render on a private layer, composite on top, crisp). Gotcha:
**size the render target in *device* pixels** — `UiCanvasInformation.width/height` are
*virtual* (logical) px, so on a retina display sizing to logical px renders at half
resolution and upscales (soft/aliased). Multiply by `devicePixelRatio` and re-sync on
resize. (This is in-engine react-ecs, not React DOM — relevant only if you keep some
in-scene composited views.)

---

## 7. Moving the *site* UI (HUD) to React — the actual work

Today the in-world UI (chat, map, emote wheel, backpack, nametags, loading, login) is
**`BevyUiScene`**, a super-user SDK7 scene that renders **react-ecs UI *inside* the
engine**. "All UI in React (DOM)" means:

1. **React renders the chrome** as DOM overlays on top of the engine canvas (your
   page already owns the layout).
2. **The engine stops rendering that UI** — either drop/trim `BevyUiScene`, or keep a
   minimal super-user "system" scene whose only job is to **bridge** engine state ↔
   the React page (via §4.2/§4.3), not to draw UI.
3. **Each HUD feature needs a data/action path** through the system bridge or console
   commands:
   - chat → a chat stream + send command
   - map/minimap → scene/realm/position queries
   - emotes → the action stream + a trigger command
   - nametags/avatars → comms/profile data
   - settings → `getSettings`/`setSetting`
   - login/realm → the login API + `changerealm`
   Some of these surfaces exist; **some may need new system-bridge endpoints** — that's
   the main engine-side effort, and the thing to scope first.

**Recommendation:** don't boil the ocean. Start with the **shell screens** (loading,
login, realm picker) in React — they're pure DOM + a few login/realm calls and need
no in-world data — then move HUD pieces over one at a time as you expose their
data/actions through the bridge. Keep `BevyUiScene` for the not-yet-migrated pieces so
nothing regresses.

---

## 8. Gotchas & lessons (concrete)

- **Black viewport = WebGPU version, not your code.** If the engine boots but renders
  black, check the console for `STORAGE_BINDING` / atmosphere / invalid-pipeline
  errors → the embedding browser's Chromium is too old (§2.3). Same bundle in a newer
  Chrome works.
- **`contentWindow` is `undefined`/cross-origin** → you're not serving the engine
  same-origin (§2.1).
- **`SharedArrayBuffer is not defined` / threads fail** → missing COOP/COEP (§2.2).
- **Engine API calls fail right after load** → you didn't wait for `engine_console_command_args`
  to exist (§3 readiness).
- **Lost login between reloads** → cross-origin engine iframe → different OPFS
  partition (§2.1). Same-origin fixes it.
- **`BroadcastChannel is not a function` inside the scene** → only the **super-user**
  (`--ui`) scene gets it; an ordinary scene doesn't.
- **npm `latest` tag has no wasm** → use `@next` (or a pinned `…commit-<sha>` version);
  the wasm only ships on the build tags, served via the CDN snapshot / unpkg.
- **Storage-lock flakiness** when launching many engine instances against one
  user-data dir (Electron) — clear IndexedDB/Service-Worker storage between runs.

---

## 9. Minimal end-to-end sketch (React host)

```tsx
// 1. serve the engine bundle same-origin with COOP/COEP/CORP (static server / proxy)
// 2. embed + drive it:
function EngineHost({ realm, position, systemScene }: Props) {
  const ref = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const w = () => ref.current?.contentWindow as any
    let alive = true
    ;(async () => {
      while (alive && typeof w()?.engine_console_command_args !== 'function')
        await new Promise(r => setTimeout(r, 200))
      // engine is ready — drive it
      // await w().engine_console_command_args('move_player_to', ['8','1','16'])
      // const ch = new BroadcastChannel('your-bus-name')  // talk to a super-user scene
    })()
    return () => { alive = false }
  }, [])
  const src = `/engine/index.html?initialRealm=${encodeURIComponent(realm)}`
            + `&location=${position}&systemScene=${encodeURIComponent(systemScene ?? '')}`
  return <iframe ref={ref} src={src} allow="autoplay; xr-spatial-tracking" />
}
```
Headers the engine origin must send (all engine + page responses):
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: cross-origin
```

---

## 10. Reference implementations to look at

- **`dcl-editor`** (this repo) — React DOM UI + engine in a same-origin iframe; the
  RPC seam (`packages/ui/src/console.ts`, `packages/scene/src/commands.ts`), the
  `BroadcastChannel` bus (`packages/scene/src/editor-channel.ts`, `ui/src/bus.ts`),
  the COOP/COEP static server (`packages/desktop/src/servers.ts`, `scripts/dev.mjs`),
  and engine-from-npm resolution (`packages/desktop/src/config.ts`).
- **`opendcl-studio`** — React + the engine on the web; serves the npm package from
  `node_modules` in dev and **proxies unpkg** in prod (`client/functions/bevy-explorer/[[path]].ts`,
  `client/vite.config.ts`) — the cleanest "serve the engine same-origin" reference.
- **`robtfm/editor-scene`** — a super-user scene that drives an external host over
  `BroadcastChannel` (`src/agent.ts`) — the bridge-scene pattern from §7.

---

### Open questions to settle on the engine side (scope these first)
1. Which HUD features already have a system-bridge/console surface, and which need new
   endpoints? (chat send/stream, emote trigger, minimap data, nametag/profile feed.)
2. Do you keep a minimal super-user "bridge" scene, or expose the data directly to the
   host (e.g. more `~system` ops / a richer `system_bridge`)?
3. Is the deployment browser guaranteed new enough for WebGPU (§2.3), or do you need a
   fallback / minimum-version gate?
</content>
