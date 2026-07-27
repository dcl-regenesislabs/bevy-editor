# Worlds — publish & manage

Design and technical notes for the Home **Worlds** tab, the world detail page, and the
publish flow. This doc carries the concepts and rationale; the raw per-request audit
(every endpoint, auth mode, trigger, caching) lives in [`NETWORK.md`](./NETWORK.md).

Code map: data layer + publish state machine in `packages/ui/src/worlds.ts`; UI in
`packages/ui/src/features/worlds/`; the deploy job in `packages/desktop/src/publish.ts`.

---

## Why Worlds is a separate, live-fetched tab

Worlds is deliberately **not** part of the Scenes tab: a world's content is whatever was
deployed to it last — from this editor, the CLI, or another machine entirely — so local
state can never be authoritative. The tab is fetched **live** from the servers on every
load; local project files only *decorate* it (see linking below), they never define it.
A world with no matching local scene still shows up.

## Scene ↔ world linking

Scenes link to worlds via `scene.json`'s `worldConfiguration.name`, **set automatically on
publish** (`set-world-name` IPC → `setWorldName` in `packages/desktop/src/main.ts`; the
name is trimmed + lowercased, and merged into any existing `worldConfiguration` object —
its presence is also what marks the deployment as a World deployment). The link drives
both directions of the UI:

- Scene cards show a badge for the linked world.
- Each world's detail lists the local scenes that publish to it (`linkedScenes`).

## Inventory sources

`refreshWorlds()` assembles the tab from four sources:

| Data | Source |
|---|---|
| NAMEs the wallet owns | marketplace subgraph (GraphQL, `category: ens`) |
| Worlds deployable as a collaborator | signed `GET /wallet/contribute` (worlds-content-server) |
| Live deployment per world (title, deployer, entityId, base parcel, `authoritativeMultiplayer`) | `GET /world/{name}/scenes` |
| Thumbnails + live user counts | places API (batched, enrichment-only — failures are swallowed) |

## Management tabs (world detail)

The world detail is a full-page view with tabs (`WorldDetail.tsx`):

| Tab | What it does | API |
|---|---|---|
| **Overview** | Cover, facts, linked local scenes | reads the worlds store — no requests |
| **Permissions** | Deployment / access / streaming allow-lists; **owner-only** | `PUT`/`DELETE /world/{name}/permissions/...` (worlds-content-server) |
| **Streaming** | Generate / reset / revoke the OBS streaming key | comms-gatekeeper `/scene-stream-access` |
| **Moderation** | Scene admins + bans; add by wallet address **or** DCL name (the gatekeeper resolves names) | comms-gatekeeper `/scene-admin` + `/scene-bans` |
| **Server storage** | Full storage manager (below) | storage API, via the `storageFetch` relay |
| **Logs** | Live tail of the world's server-side runtime output (below) | multiplayer server `/logs` (SSE) |

Gatekeeper calls are **scoped to the live deployment**: the signed metadata carries the
sceneId (entityId of the current deployment) + base parcel + realm, so Streaming and
Moderation only work once something is deployed.

### Server storage

Gated on the deployed scene's `authoritativeMultiplayer` flag (scenes without it get an
explainer instead). A full manager:

- Paginated **data / players / env** lists (page size 50).
- Expandable rows with **authoritative re-reads** (`GET /values/{key}` on expand — the
  list payload is never trusted for the full value) and pretty-printed JSON.
- Copy key/value; **edit and add** values (JSON or plain text).
- **Per-player drill-down** (`/players/{addr}/values`).
- **Two-step** delete and delete-all (delete-all sends `X-Confirm-Delete-All: true`).

### Logs

Same `authoritativeMultiplayer` gate. A **signed SSE stream** from the multiplayer
server's `/logs` — the in-app counterpart of `sdk-commands sdk-server-logs`. Opened only
on an **explicit Connect**; output is level-colored and bounded (500-line buffer).

## The `storageFetch` relay

The storage API's CORS allowlist rejects localhost origins, so **only those calls** relay
through a main-process forwarder (`storage-fetch` IPC in `packages/desktop/src/main.ts`).
The relay is **host-pinned** (https + `storage.decentraland.org`/`.zone` only — it must
never become a general-purpose proxy), and **signing stays in the renderer**: the request
arrives at main already carrying its `x-identity-*` headers. Every other worlds call is a
plain renderer fetch.

## Publish flow

Publish is reachable from the scene card menu, the in-editor topbar button, or the world
detail. Split so credentials never leave the renderer:

1. The renderer writes `worldConfiguration.name`, then main spawns the scene's **own**
   `sdk-commands deploy --no-browser --port N --target-content <worlds-content-server>`
   (`packages/desktop/src/publish.ts`). Main only builds and hosts.
2. When the CLI's local linker server is up (`ready`), the **renderer acts as the linker
   dapp**: it fetches `/api/info`, signs the entity id (rootCID) with the stored
   AuthIdentity, and POSTs the auth chain to `localhost:N/api/deploy`, which uploads to
   the worlds content server.
3. **Credentials never reach the main process or disk.** (Main also scrubs any inherited
   `DCL_PRIVATE_KEY` from the child's env so the CLI can't sign as some other key.)
4. Progress streams over `PUBLISH_EVENT_CHANNEL` into the modal
   (choose world → build → upload → jump in), with a raw-log drawer.

## Signed fetch (ADR-44)

All authenticated management calls are signed-fetch — ADR-44 `x-identity-*` headers
(payload `method:path:timestamp:metadata`, each auth-chain link as an
`x-identity-auth-chain-<i>` header) — **renderer-side**, in `packages/ui/src/worlds.ts`,
using the AuthIdentity from sign-in.
