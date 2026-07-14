# Network Request Audit — dcl-editor

Scope: renderer (`packages/ui/src`) + main process (`packages/desktop/src`), branch `feat/script-component`. All hosts flip prod → `.zone` (Sepolia) when `localStorage['dcl-auth-env'] === 'zone'` (`worlds.ts:16-36`, `auth.ts:38-40`).

Auth legend: **none** = plain fetch; **signed** = ADR-44 `signedFetch` (`worlds.ts:47-70`) with `x-identity-*` headers; **signed+relay** = same, relayed through main's `storage-fetch` IPC for `storage.decentraland.*` (CORS, `worlds.ts:62-68`, `main.ts:492-506`); **body chain** = signed authChain in JSON body.

Cache legend: **module store** = survives remounts (auth store `auth.ts:164`, worlds store `worlds.ts:455`, publish store `worlds.ts:548`); **none/per-mount** = `useLoad` (`ds/hooks.ts:5-22`) or local effect — refetches on every mount and dep change.

---

## 1. Per-section request inventory

### 1.1 Home / Scenes (Picker) — zero HTTP

Entirely IPC (`shell.*`). `getState()` on mount and after every card mutation (rename/favourite/duplicate/delete/remove, `Picker.tsx:43-45`, `SceneCard.tsx:31-34`); `sceneTemplates`/`pickFolder`/`createScene` in NewSceneModal. Thumbnails are `data:` URLs built by main (`main.ts:185`). Nothing to audit for network cost; refetch-full-state-per-mutation is local and cheap.

### 1.2 Worlds tab (WorldsSection)

| Request | Method + URL | Auth | Trigger | Cached today? |
|---|---|---|---|---|
| Owned NAMEs | POST `subgraph.decentraland.org/marketplace[-sepolia]` (GraphQL, first:1000) | none | `refreshWorlds` step 1 (`worlds.ts:96`) | module store until wallet change / sign-out / manual refresh |
| Contributable worlds | GET `{worlds-server}/wallet/contribute` | signed | `refreshWorlds` step 1, parallel with above (`worlds.ts:114`) | same |
| Per-world deployment | GET `{worlds-server}/world/:name/scenes` × N | none | `refreshWorlds` step 2, `mapLimited` concurrency 6 (`worlds.ts:507-508`) | same |
| Places meta | GET `{places-api}/worlds?names=…` (1 batched) | none | `refreshWorlds` step 2, parallel (`worlds.ts:166`) | same |
| World cover img | GET `{worlds-server}/contents/:hash` or places `image` URL | none | `<img loading="lazy">` per visible card (`common.tsx:26-28`) | Chromium HTTP cache (server-header dependent) |

Trigger semantics: `ensureWorlds` (`worlds.ts:468`) fires the cascade only on first load or wallet change — tab switching Scenes↔Worlds is free once `ready`. Full cascade = **3 + N requests** for N worlds, ~2 sequential rounds. Also re-fired after every successful publish (`worlds.ts:643`) and by the Refresh button.

### 1.3 World detail — per tab (`WorldDetail.tsx:55-63`)

All panels are component-state (`useLoad` / local effect): **every tab switch away and back refetches**.

**Overview** — zero requests (reads worlds store).

**Permissions (AccessPanel)**

| Request | Method + URL | Auth | Trigger | Cached today? |
|---|---|---|---|---|
| Read permissions | GET `{worlds-server}/world/:name/permissions` | none | every panel mount / world change (`AccessPanel.tsx:15-18`) | no — per mount |
| Set/unset permission | PUT/DELETE `…/permissions/:kind/:address` | signed | per add/remove click (`worlds.ts:217`) | n/a |
| Reload after mutate | GET permissions again | none | after every mutation (`AccessPanel.tsx:41,62-72`) | no |

**Streaming (StreamingPanel)**

| Request | Method + URL | Auth | Trigger | Cached today? |
|---|---|---|---|---|
| Read stream access | GET `{gatekeeper}/scene-stream-access` (404 = none) | signed + scene metadata | every mount / sceneId change (`StreamingPanel.tsx:12-15`) | no — per mount |
| Create/reset/revoke | POST/PUT/DELETE same URL | signed | per action, then GET reload (`StreamingPanel.tsx:17-24`) | n/a |

**Moderation (ModerationPanel)**

| Request | Method + URL | Auth | Trigger | Cached today? |
|---|---|---|---|---|
| List admins | GET `{gatekeeper}/scene-admin` | signed | every Admins sub-tab mount (`ModerationPanel.tsx:65`) | no — per mount |
| Add/remove admin | POST/DELETE `{gatekeeper}/scene-admin` | signed | per action + full list reload | n/a |
| List bans | GET `{gatekeeper}/scene-bans?limit=100&offset=0` (fixed page) | signed | every Bans sub-tab mount (`ModerationPanel.tsx:105`) | no — per mount |
| Ban/unban | POST/DELETE `{gatekeeper}/scene-bans` | signed | per action + full list reload | n/a |

Switching Admins↔Bans remounts each and refetches both directions every time.

**Storage (StorageTab)** — all signed+relay through main, page size 50

| Request | Method + URL | Auth | Trigger | Cached today? |
|---|---|---|---|---|
| List values | GET `{storage}/values?limit=50&offset=N` (or `/players/:addr/values`) | signed+relay | every Data sub-tab mount + every page change; `usePageClamp` may add one extra (`StorageTab.tsx:278-281`) | no — per mount |
| Read one value | GET `{storage}/values/:key` | signed+relay | **every row expand**, re-fires on reopen (`StorageTab.tsx:191-200`) | no — deliberate authoritative read |
| Write value | PUT same, body `{value}` | signed+relay | per save/add, then list reload | n/a |
| Delete value / clear-all | DELETE (clear-all adds `X-Confirm-Delete-All: true`) | signed+relay | per action, then reload | n/a |
| List players | GET `{storage}/players?limit=50&offset=N` | signed+relay | every Players sub-tab mount / page | no |
| List env keys | GET `{storage}/env?limit=50&offset=N` | signed+relay | every Env sub-tab mount / page | no |
| Set/delete env key | PUT/DELETE `{storage}/env/:key` | signed+relay | per action + reload | n/a |

### 1.4 Publish flow (PublishModal + publish.ts)

| Request | Method + URL | Auth | Trigger | Cached today? |
|---|---|---|---|---|
| Worlds inventory | full 3+N cascade (§1.2) | mixed | modal mount, only if store not `ready` (`PublishModal.tsx:37`); Retry button always | module store |
| canDeploy preflight | GET `{worlds-server}/world/:name/permissions` | none | per publish click (`worlds.ts:596-604`); failure → optimistic true | no — refetched even if AccessPanel just loaded it |
| npm install | registry traffic via `npm install --no-audit --no-fund` | none | only when `@dcl/sdk-commands` missing (`publish.ts:80`) | node_modules is the cache |
| Linker info | GET `http://localhost:{port}/api/info` | none | after linker `ready` (`worlds.ts:582`); main also probe-polls it 1 s × up to 300 as fallback (`publish.ts:146-159`) | n/a |
| Deploy | POST `http://localhost:{port}/api/deploy` `{address, authChain, chainId}` | body chain (signed in renderer) | once per publish; long-lived, resolves after upload | n/a |
| CLI: dedupe check | GET `{worlds-server}/available-content?cid=…` (batched) | inside CLI | per deploy | server-side dedupe — only missing hashes upload |
| CLI: upload | POST `{worlds-server}/entities` multipart, 10-min timeout, no retry | authChain | per deploy | n/a |
| CLI: Segment analytics | deploy started/success/failure events | none | per deploy; opt-out `DCL_DISABLE_ANALYTICS=true` | n/a |
| Post-success refresh | full 3+N cascade again (`worlds.ts:643`) | mixed | every successful publish | wipes and refetches everything |

**Per publish click total (renderer): 3 + (3 + N) = 6 + N requests** plus the CLI's dedupe + upload, for N owned worlds.

### 1.5 Account / Sign-in (auth.ts)

| Request | Method + URL | Auth | Trigger | Cached today? |
|---|---|---|---|---|
| Create sign-in request | POST `{auth-server}/requests` | none | per sign-in click (`auth.ts:63-67`); `inflight` flag dedupes; dapp URL cached for "reopen browser" | n/a |
| Fetch identity | GET `{auth-server}/identities/:id` | none (id is the capability) | deep-link callback, nonce-gated (`auth.ts:87`) | intentionally uncached (single-use) |
| Fetch profile | GET `peer.decentraland.org/lambdas/profiles/:address` (always prod, no zone switch) | none | `useAuth` effect when `wallet && !profile` (`auth.ts:319-321`) | module store once resolved — but **no in-flight dedupe**: up to 5 simultaneous consumers (rail badge, topbar badge, WorldsSection, PublishModal, AccountSection) each fire on cold start |
| Avatar face256 img | GET peer content-server URL | none | `<img crossOrigin>` per render site (`account.tsx:33,54,102,119,276`) | Chromium HTTP cache |

Sign-out: zero network.

### 1.6 Editor in-scene

| Request | Method + URL | Auth | Trigger | Cached today? |
|---|---|---|---|---|
| Proxy probe | GET `/opendcl/ping` (localhost, short-circuits in main, no upstream) | none | first asset-catalog use (`assets.ts:26-29`) | memoized (`proxyBase`) |
| Model catalog | GET `models.dclregenesislabs.xyz/catalog/asset-catalog.json` (via `/opendcl/` proxy) | none | first catalog open; **large** (5.7k-asset JSON) | module cache + in-flight dedupe (`assets.ts:57-63`); proxy stamps `max-age=86400` → Chromium cache 24 h |
| Catalog thumbnails | GET thumbnail URLs via proxy | none | per visible catalog item (`actions.ts:214`) | Chromium cache 24 h via proxy header |
| Import model | GET `{asset.url}` GLB (MBs) via proxy | none | per asset import (`assets.ts:143`) | Chromium cache 24 h via proxy header |
| Engine readiness | GET `{systemScene}/about` poll 500 ms, 1.5 s timeout, ≤120 s | none | engine boot (`engine-host.ts:51-55`) | stops on first success |
| Data layer | WebSocket `ws://{realm}/data-layer` | none | lazy, single connection, reconnect on close (`datalayer.ts:196-213`) | deduped |
| Scene logs poll | `cmd.sceneLogs(200)` — engine RPC, **not HTTP** | n/a | every **2000 ms** while LogsDrawer open on scene tab (`LogsDrawer.tsx:20-37`) | n/a |
| Boot logs poll | `cmd.sceneLogs(40)` RPC every **2500 ms** | n/a | EngineInitOverlay until ready (`Editor.tsx:127-133`) | n/a |
| SceneTopbar state | `shell.getState()` IPC | n/a | mount + twice per publish-modal cycle (deps `[project, publishing]`, `SceneTopbar.tsx:40-45`) | no |

AI panel: local IPC only, zero HTTP (network lives inside spawned provider CLIs).

### 1.7 Desktop background (main process)

| Request | Method + URL | Auth | Trigger | Cached today? |
|---|---|---|---|---|
| Static server | serves UI + engine on localhost:3010, COOP/COEP headers, `Cache-Control: no-cache` | n/a | app startup (`servers.ts:72-117`) | revalidate-always by design |
| /opendcl proxy upstream | GET/HEAD `models.dclregenesislabs.xyz/*`, 20 s timeout, 256 MiB cap, full in-memory buffer | none | per renderer `/opendcl/*` request | no in-process cache; delegates to Chromium via `max-age=86400` |
| storage-fetch relay | forwards signed requests, allowlist exactly `storage.decentraland.org|.zone`, https only, 20 s timeout | passthrough | per renderer storage call | no |
| npm install | registry | none | scene-server start / publish when sdk-commands missing (`servers.ts:218-238`) | node_modules |
| Scene server probes | GET `localhost:{8004,8005}/about` — 1 s × ≤120 readiness/reuse; 400 ms × ≤20 port drain | none | project open / server restart | terminate on first success |
| Crash restart | respawn ≤3 with linear backoff | n/a | non-zero child exit | n/a |
| open-external | default browser, gated `^https://` | n/a | sign-in flow | n/a |
| Deep link | inbound `dcl-creator-hub://` only | n/a | OS delivery | n/a |

---

## 2. Hot paths

Ranked by frequency × cost:

1. **`refreshWorlds` fan-out — 3 + N requests per invocation** (`worlds.ts:480-524`). N = owned + contributable worlds; the N is a classic N+1 (`/world/:name/scenes`, each response tens–hundreds of KB of entity metadata), capped at 6 concurrent. Fires on: first load, wallet change, Refresh button, **every successful publish**. A user with 20 worlds pays 23 requests per publish just to refresh the grid.
2. **WorldDetail tab flipping — 1 signed GET per flip, per tab.** All five panels use per-mount state. Permissions→Streaming→Moderation→Permissions = 4 refetches of data that almost never changed in the interim. Moderation's Admins↔Bans sub-tabs double this.
3. **Storage per-row expand — 1 relayed signed GET per open, every reopen** (`StorageTab.tsx:191-200`). Expanding 10 rows, collapsing, re-expanding = 20 GETs. Each hop is renderer → IPC → main fetch → response rebuild.
4. **Mutate → full-list reload, everywhere.** Permissions, admins, bans, streaming, storage: every single-item mutation costs 2 requests (write + full re-read). Adding 5 admins = 10 requests.
5. **Cold-start profile stampede — up to 5 duplicate GETs** of the same `/lambdas/profiles/:address` from simultaneously mounted `useAuth` consumers (no in-flight dedupe, `auth.ts:319-321`).
6. **canDeploy preflight — 1 redundant permissions GET per publish click** (`worlds.ts:596-604`), never shared with AccessPanel's identical fetch.
7. **Polls (RPC, not HTTP): 2000 ms LogsDrawer + 2500 ms EngineInitOverlay.** Cheap transport, but the LogsDrawer `onStackLog` subscription is never unsubscribed (`LogsDrawer.tsx:15-19`) — leak, and SceneTopbar re-runs `getState` twice per publish-modal cycle.
8. **Model catalog + GLBs** — biggest payloads in the app (catalog JSON + multi-MB GLBs), but already well-mitigated (module dedupe + 24 h HTTP cache via proxy).

---

## 3. Recommendations, ranked by impact / effort

**R1. Per-scope module store for permissions / streaming / moderation (high impact, low effort).**
What: cache `fetchWorldPermissions` keyed by world name; `getStreamAccess`, `listSceneAdmins`, `listSceneBans` keyed by `sceneId`. Where: module store beside the worlds store (same pattern as `worldsWallet` guard). Invalidation: write-through on mutation — the panels already know the delta (added/removed address), so update the cached list in place instead of refetching; hard-invalidate on world change and manual refresh. Reduction: tab flips go from 1 GET each to 0; mutations go from 2 requests to 1 (a 50% cut on every moderation/permission action). A typical detail-page session (5 tab visits, 3 mutations) drops from ~11 to ~4 requests.

**R2. Post-publish targeted refresh instead of full cascade (high impact, low effort).**
What: after a successful deploy, refetch only the published world's `/world/:name/scenes` plus one places-meta call, and patch that entry in the store — skip subgraph + contribute + the other N-1 deployments. Invalidation: names/contributions didn't change because a scene was deployed. Reduction: per publish, 3 + N → 2 requests (a 20-world user saves 21 requests per publish).

**R3. Profile fetch in-flight dedupe (medium impact, trivial effort).**
What: store the in-flight promise in `loadProfile` (same pattern as `assets.ts` `loadPromise`) so concurrent `useAuth` consumers share one fetch. Invalidation: existing rules (sign-out/in) unchanged. Reduction: cold start 5 GETs → 1; it is also the largest per-request payload in the auth path (full avatars profile).

**R4. canDeploy reuses the permissions cache (medium impact, trivial effort — depends on R1).**
What: `canDeploy` reads the R1 permissions store (fetch-on-miss with a short TTL, e.g. 60 s, since permissions can change server-side between sessions). Reduction: 1 GET saved per publish when the user just viewed the Permissions tab; keeps the existing "any failure → optimistic true" behavior.

**R5. Per-world deployment cache shared between grid and future targeted fetches (medium impact, medium effort).**
What: key `/world/:name/scenes` results by name inside the worlds store with a fetched-at timestamp; `refreshWorlds` skips entries younger than a TTL (suggest 5 min) unless the Refresh button forces it; deep-link `initialWorld` for a world not yet in the store gets a targeted single fetch instead of nothing. Invalidation: force on manual refresh; write-through on publish (R2). Reduction: a manual Refresh within the TTL drops from 3 + N to 3 + (stale count only); typical steady-state refresh → 3 requests.

**R6. NAMEs subgraph result in localStorage with TTL (medium impact, low effort).**
What: persist the owned-names list keyed by wallet + env, TTL ~24 h, stale-while-revalidate (paint from cache, revalidate in background). Names change only on ENS mint/transfer. Invalidation: TTL expiry, wallet change, manual refresh forces revalidate. Reduction: 1 request per cascade, but the real win is instant grid paint on app relaunch (combined with R5-style persisted inventory, the Worlds tab can render with 0 blocking requests on a warm start).

**R7. Worlds inventory TTL + stale-while-revalidate (medium impact, low effort).**
What: today the store never expires until wallet change — remounts are free but data can go arbitrarily stale. Add a fetched-at timestamp; on `ensureWorlds` with age > TTL (suggest 5 min), serve the cached list immediately and run the cascade in the background. Invalidation: publish success (patched via R2), manual refresh. Reduction: none directly — this buys freshness without adding blocking requests, and pairs with R5/R6 so the background revalidate is ~3 requests, not 3 + N.

**R8. Storage list page cache keyed `realm + player + offset` (low-medium impact, low effort).**
What: component-adjacent map cache; sub-tab flips and pagination back-and-forth hit cache. Invalidation: any storage mutation (PUT/DELETE/clear) invalidates all pages for that realm(+player) scope — coarse but correct; `usePageClamp` reads cache instead of refetching. Keep the per-row expand GET as-is (authoritative single read is a deliberate correctness feature for live game data) but cache the value for the row's open lifetime so reopen-without-mutation is free — or add an explicit per-row refresh affordance. Reduction: sub-tab flip 1 → 0; page back-nav 1 → 0; row reopen 1 → 0.

**R9. Places meta TTL (low impact, trivial effort).**
What: cache the batched places response for ~5 min keyed by the sorted names list; it is enrichment-only (image + user_count) and failures are already swallowed. Reduction: 1 request per cascade within TTL; skip entirely in the R2 targeted path when the name set is unchanged.

**R10. Verify/exploit content-addressed thumbnail caching (low impact, trivial effort).**
What: `/contents/:hash` is immutable by construction — confirm the worlds-content-server responds with `Cache-Control: immutable` (or long max-age); if it does not, these covers revalidate on every grid render session. No app code needed if headers are right; Chromium's HTTP cache does the rest. Same check for peer avatar face256 URLs. Reduction: up to N image requests per session for returning users.

**R11. Poll and IPC tuning (low impact, low effort).**
What: (a) fix the LogsDrawer `onStackLog` subscription leak (`LogsDrawer.tsx:15-19` — no cleanup); (b) pause both `cmd.sceneLogs` polls when the window is hidden/blurred and consider backing LogsDrawer off to 4–5 s after a few empty polls; (c) drop `publishing` from SceneTopbar's `getState` deps or read the target world from a store — two IPC round-trips per modal cycle for a value that rarely changes. Reduction: RPC/IPC only, no HTTP — this is hygiene, not bandwidth.

Explicitly not recommended: caching the identity fetch (single-use capability by design), adding retry to `signedFetch` for storage 429 without a backoff policy agreed with the service, or caching `/api/info`/`/about` probes (liveness checks must be live).

---

## 4. Already well-handled — do not touch

- **Worlds store lifecycle**: `ensureWorlds` idempotency (fetch only on wallet change or `idle`), `refreshing` dedupe flag, wallet-scoped wipe, sign-out reset (`worlds.ts:462-524`). Tab switching is genuinely free today.
- **Places batching**: one GET for all names regardless of N, failures swallowed as enrichment (`worlds.ts:161-166`).
- **Concurrency cap**: `mapLimited` at 6 keeps the deployment fan-out from stampeding the worlds server (`worlds.ts:180-192`).
- **Graceful degradation**: `fetchContributable` → `[]`, per-world deployment → null, places → ignored, `canDeploy` failure → optimistic — no single upstream outage bricks the Worlds tab.
- **Publish job hygiene**: one-job-at-a-time guard, `JobToken.alive` on every async continuation, 400-line log ring, modal-close survives + reattaches, cancellable at every stage including mid-npm-install; `DCL_PRIVATE_KEY` stripped from the CLI env so signing stays in the renderer.
- **Deploy upload dedupe**: `available-content` batch check means only missing hashes upload — repeat deploys of a mostly-unchanged scene are already near-minimal.
- **Auth flow**: `inflight` sign-in guard, nonce-gated deep link, cached dapp URL for browser reopen, single-use identity fetch, profile module-store once resolved (only the cold-start stampede in R3 is missing).
- **Model catalog**: module-level cache + in-flight promise dedupe + reset-on-failure, plus the `/opendcl` proxy stamping 24 h cache headers so Chromium absorbs repeat catalog/thumbnail/GLB traffic; 256 MiB cap and 20 s timeout bound the relay.
- **storage-fetch relay**: exact two-host https allowlist, 20 s timeout, renderer-signed passthrough — main never holds credentials.
- **Probe loops**: all terminate on first success; no background HTTP polling exists anywhere in the app once things are ready.
- **Security posture worth preserving**: `open-external` gated to https, path-traversal guard on the static server, GET/HEAD-only proxy, COOP/COEP kept intact.