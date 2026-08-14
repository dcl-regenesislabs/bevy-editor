# Worlds — publish & manage

Design and technical notes for the Home **Worlds** tab, the world detail page, and the
publish flow. This doc carries the concepts and rationale; the raw per-request audit
(every endpoint, auth mode, trigger, caching) lives in [`NETWORK.md`](./NETWORK.md).

Code map:

| Concern | Where |
|---|---|
| Inventory, permissions, per-world reads | `packages/ui/src/features/worlds/inventory.ts` |
| Store + refresh | `packages/ui/src/features/worlds/worlds-store.ts` |
| Worlds UI (tab, detail, per-tab panels) | `packages/ui/src/features/worlds/` |
| Scene removal (scene-scoped undeploy) | `packages/ui/src/features/worlds/undeploy.ts` |
| Publish state machine | `packages/ui/src/features/publish/publish-flow.ts` |
| Publish pre-flight (footprint, capability, permission) | `packages/ui/src/features/publish/publish-preflight.ts` |
| Collision arithmetic + the "who is on my parcels" read | `packages/ui/src/features/publish/publish-conflict.ts` |
| Exit classification | `packages/ui/src/features/publish/publish-classify.ts` |
| Publish sentences | `packages/ui/src/features/publish/publish-copy.ts` |
| The deploy job in main | `packages/desktop/src/publish.ts` |
| Deploy capability probe + arg builder | `packages/desktop/src/publish-args.ts` |

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
- Each world's detail lists the local scenes that publish to it.

`worldConfiguration` carries **only the world's name**. There is no per-scene name in it —
see [A scene's identity is its parcel set](#a-scenes-identity-inside-a-world-is-its-parcel-set).

## Inventory sources

`refreshWorlds()` assembles the tab from four sources:

| Data | Source |
|---|---|
| NAMEs the wallet owns | marketplace subgraph (GraphQL, `category: ens`) |
| Worlds deployable as a collaborator | signed `GET /wallet/contribute` (worlds-content-server) |
| Every scene in the world, plus the count | `GET /world/{name}/scenes?limit=100&offset=N` (paginated) |
| The world's own settings (title, description, thumbnail) | `GET /world/{name}/settings` (404 = never configured → empty) |
| Thumbnails + live user counts | places API (batched, enrichment-only — failures are swallowed) |

### `/scenes` is the canonical list — not `/about`

`GET /world/{name}/about` exposes `configurations.scenesUrn`, and it is tempting to read
it as "the scenes in this world". **It is not.** The server builds that field from
`getWorldScenes({ limit: 1, orderBy: createdAt desc })`, so it carries **exactly one urn**:
the most recently created scene. A world holding five scenes reports one urn there.

Everything in this app that needs the world's contents reads `GET /world/{name}/scenes`,
paginated (`PAGE = 100`, `MAX_PAGES = 20`), and nothing reads `scenesUrn`.

### Counting is a union, not a number

`fetchWorldScenes` returns `{ deployment, scenes, sceneCount }` where

```ts
export type SceneCount = { known: true; total: number } | { known: false }
```

A `number | null` would invite `?? 0`, and rendering a failed read as "0 scenes" is the
one failure mode that changes what a creator does: an empty world invites a publish that
a full world would not. A page that 404s, throws, or blows past `MAX_PAGES` yields
`{ known: false }` while keeping whatever scenes were read, and the UI says
*"Couldn't read this world"* rather than *"Empty"*.

Rows whose `status` is explicitly `UNDEPLOYED` are dropped from `scenes`, from
`sceneCount.total` and from the `deployment` pick. A row with **no** `status` field is
kept — older servers send none, and everything they send is live.

`deployment` remains `mapDeployment(live[0])`, the same row `scenes[0]` comes from; six
surfaces read it, so it is computed independently of the coordinate parse.

## Management tabs (world detail)

The world detail is a full-page view with tabs (`WorldDetail.tsx`):

| Tab | What it does | API |
|---|---|---|
| **Overview** | Cover, description, facts, the scenes published here, linked local scenes | reads the worlds store — no requests (removal is signed, below) |
| **Analytics** | Per-scene visitor numbers, trend and weekly chart (below) | creators-data `POST /v2/metrics`, via the `signedRelay` relay |
| **Settings** | The world's own title / description / thumbnail (below) | `GET`/`PUT /world/{name}/settings` |
| **Permissions** | Deployment / access / streaming allow-lists; **owner-only** | `PUT`/`DELETE /world/{name}/permissions/...` (worlds-content-server) |
| **Streaming** | Generate / reset / revoke the OBS streaming key | comms-gatekeeper `/scene-stream-access` |
| **Moderation** | Scene admins + bans; add by wallet address **or** DCL name (the gatekeeper resolves names) | comms-gatekeeper `/scene-admin` + `/scene-bans` |
| **Server storage** | Full storage manager (below) | storage API, via the `signedRelay` relay |
| **Logs** | Live tail of the world's server-side runtime output (below) | multiplayer server `/logs` (SSE) |

### Analytics (visitors)

One `POST /v2/metrics` to creators-data covers **every scene of the world** in a single
signed round trip (`features/worlds/analytics.ts`); the tab is `AnalyticsTab.tsx` with the
chart in `Trend.tsx`, readers in `metrics-read.ts` and arithmetic in `chart-geometry.ts`.

- The service is **prod-only in both environments** (`metricsApi()` in `endpoints.ts`),
  matching the reference config. The URL is built by **concatenation** — `new URL('/metrics',
  base)` would drop the `/v2`, sign a path the server never sees, and 401 with no diagnostic.
- Identity is **positional**: the response is paired to the request by index and keyed by
  our own `sceneKey`, never the service's `location_key`. A length mismatch throws rather
  than risk showing one scene's numbers under another's name.
- **`metrics: {}` is not an error.** It means either "no rows in today's export" or "this
  wallet may not read this location", and the service will not say which — so an empty bag
  renders an empty state and a failed request renders an error with `Retry`. The two paths
  stay structurally distinct all the way to the markup; collapsing them is the worst
  failure in this tab, because "you have no visitors" is actionable in the wrong direction.
- Snapshots are cached per **wallet + world + scene set**, cleared on wallet change and
  **evicted when the local calendar date changes** (a new export can only exist on a new
  date). In-flight requests are single-flighted, because `useLoad` neither aborts nor
  dedupes. This is what makes the absence of a refresh button a decision rather than a gap.
- **No world-level total, ever**: unique visitors do not add across scenes — the same
  non-additivity the API shows inside one scene (`all` ≠ desktop + mobile).
- Scenes come from `w.scenes`, and a scene whose coordinate cannot be read at all is
  dropped rather than defaulted — `0,0` is a real parcel someone else owns. `mapScene`
  falls back from `scene.base` to `parcels[0]` first, mirroring the server's own
  `extractSpawnCoordinates`; only a scene where **nothing** parses is unlocatable, and it
  is still counted in `sceneCount.total`.

### World settings (title, description, thumbnail)

A world can host many scenes, so its own title/description/thumbnail belong to the
**world**, not to whatever is deployed on it — that's what visitors see in Places and
anywhere the world is listed. It's the **Settings** tab (`SettingsTab.tsx`), sitting
next to Overview; the data layer is `features/worlds/settings.ts`.

- The tab **re-reads** `GET /world/{name}/settings` on mount (the store copy is for
  display), and `PUT`s **multipart** with only the fields that changed.
- The server upserts with `COALESCE`, so **an omitted field keeps its value and nothing
  can be blanked** — clearing a field that is already set is blocked in the form, with
  the reason, instead of being sent and silently ignored.
- Server-side limits are mirrored client-side (title 3–100, description 3–1000,
  thumbnail PNG/JPG/GIF/WebP ≤ 1 MB — the server sniffs magic bytes, so a renamed file
  is rejected there too).
- Writers are the **NAME owner or anyone with world-wide deployment permission**; the
  form is shown to everyone and a `403` is surfaced as a sentence, because parcel-scoped
  collaborators can't be told apart client-side.
- A successful save patches the store entry in place (`patchWorldSettings`) — no
  inventory cascade. The world thumbnail is the **first** choice for every cover
  (`WorldCover`), ahead of the deployment's own thumbnail.

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

## The `signedRelay` relay

The storage and creators-data APIs answer `access-control-allow-origin: false` for
localhost origins, so **only those calls** relay through a main-process forwarder
(`signed-relay` IPC in `packages/desktop/src/main.ts`). The relay is **host-pinned** —
https plus exact-hostname equality against `RELAY_HOSTS` (`packages/contract/src/shell.ts`,
enforced by `assertRelayHost` in `packages/desktop/src/relay-host.ts`): the two `storage.`
hosts, the one prod `creators-data.` host, and nothing else. A suffix test would turn it
into an org-wide proxy carrying the user's identity, so it must never become one. Nothing
unreachable belongs on that list either — `creators-data.decentraland.zone` is absent
because the analytics endpoint is prod-only in both environments. **Signing stays
in the renderer**: the request arrives at main already carrying its `x-identity-*`
headers. Every other worlds call is a plain renderer fetch.

---

# Publishing

## A scene's identity inside a world is its parcel set

There is no per-scene name in a world deployment. `worldConfiguration` carries the
**world's** name and nothing else; `display.title` is a label, not an address. What
identifies a scene inside a world is the set of parcels it occupies.

That single fact drives the whole publish design, because it is also what the server keys
on: `POST /entities` undeploys exactly the deployed scenes whose parcels **intersect** the
incoming ones, inserts the new entity, and leaves every other scene untouched. Overlap is
never rejected — it is silently resolved by replacement.

Two consequences:

1. **A world holds many scenes.** Publishing is an *add*, not a *takeover*, as long as the
   footprints don't intersect.
2. **The only way to destroy someone's work is a parcel collision**, and a collision is
   knowable *before* anything is spawned: one `POST /world/{name}/scenes` with
   `{"coordinates": [...]}` — the scene's own parcels — returns exactly the deployed scenes
   standing on them. That request is `fetchScenesAt` in `publish-conflict.ts`. It is
   unsigned, like the plain `/scenes` read next to it: this is public world state.

Coordinates are integers `x,y` in `-150..150`. `parseCoords` is strict and never
defaults; `footprintOf` forgives whitespace only (`"9, 9"` and `"9,9"` are the same parcel
to the server, and comparing them raw would manufacture a conflict out of a space).

The server does **not** require `scene.base` to be a member of `scene.parcels` — its own
`extractSpawnCoordinates` falls back to `base || parcels[0]`, and `mapScene` mirrors that.

## The three rules

1. Always pass `--multi-scene` when the project's `sdk-commands` declares it, so the CLI's
   destructive branch is unreachable.
2. The only remaining way to replace work is a parcel collision, and only that case gets a
   confirmation.
3. Removal is its own named, scene-scoped action in the Worlds surface — never inside
   Publish. No module may ever call `DELETE /entities/`.

## The incident this replaced

`packages/desktop/src/publish.ts` used to spawn the CLI with `stdio: ['ignore','pipe','pipe']`,
so the child's stdin was `/dev/null`.

sdk-commands 7.25 `deploy`, when the target world already holds scenes on **non-overlapping**
parcels and `--multi-scene` was not passed, warns and then blocks on
`promptUser('Continue? (y/N) ')` — Node `readline` over `process.stdin`. With stdin closed,
EOF arrives instantly, the `rl.question` callback **never fires**, and the process
**exits with code 0 without building anything**.

`publish-flow.ts` then treated any exit during `building` as a build failure regardless of
the exit code and printed *"The build failed."* over a run that never compiled a line.

Both halves are fixed: the flag makes the branch unreachable, and
`classifyPublishExit` no longer reads a zero exit as a broken build (below).

## Why `--multi-scene` is always passed when supported

The CLI's entire destructive pre-flight sits inside one guard:

```js
if (isWorld && !multiScene && worldName) { /* fetch world scenes → warn → prompt → needsDelete */ }
```

Passing the flag gates **the whole block** off: no world-scenes fetch, no warning, no
prompt, no `needsDelete`, no `DELETE /entities/{world}`. The uploaded payload is
**byte-identical** either way — the flag changes nothing about what is deployed, only
whether the CLI first offers to empty the world.

So it costs nothing and removes the only path by which a publish could take down scenes
the creator never saw. `buildDeployArgs` appends it whenever the capability probe says
`additive`.

It also moves the server's authorization question from "may this wallet touch this world"
to "may it touch **these parcels**" — which is why `publish-preflight.ts` checks the
per-parcel permission list (`/world/{name}/permissions/deployment/address/{addr}/parcels`)
and not only the world-wide one. A parcel-scoped collaborator would otherwise get no
warning at all before the server refused them.

## Why `--yes` is NEVER passed

`--yes` looks like the obvious way to unblock a prompt. It is the opposite of what we want.

It does not decline the prompt — it **skips** it and then takes the destructive branch:
it sets `needsDelete = true`. The CLI then hard-errors when `linkerResponse.deleteSignature`
is missing, and Studio's linker driver (`driveLinker` in `publish-flow.ts`) posts only
`{ address, authChain, chainId }`. So on a world that already holds scenes, `--yes` fails
the deploy outright with `DEPLOY_DELETE_FAILED`.

Making it "work" would mean signing a delete payload in the renderer — i.e. **shipping a
world-wipe path in the editor**, triggered as a side effect of a publish, over scenes whose
project folders this machine may not even have. That is exactly the outcome the whole
design exists to prevent. `--yes` stays out, permanently.

Also never passed: `--force-upload` and `--skip-version-checks`. Both are declared by the
CLI and never read — passing them would be cargo cult.

## Why stdin is written `"n"` and closed immediately

`publish.ts` now spawns with `stdio: ['pipe','pipe','pipe']` and calls `declineStdin(child.stdin)`
on the statement **right after** `spawnNpm`, before any `await` and before any listener is
registered. `declineStdin` attaches an error handler and does `stdin.end('n\n')`.

There are three possible stdin shapes and only one is safe:

| stdin | what happens if the CLI ever asks a question |
|---|---|
| `'ignore'` (`/dev/null`) | instant EOF; `rl.question`'s callback never fires; **exit 0, nothing built** — the original incident |
| a pipe left open and unwritten | readline waits for a line that never comes; **the child hangs forever** and only the 300 s ready-timeout ends it. This is the variant that genuinely hangs, and it is what you get by "just switching to `pipe`" without writing |
| a pipe written `"n\n"` and closed | the prompt reads *no*, the CLI throws `DEPLOY_CANCELLED`, exits non-zero, and **deletes nothing** |

The flag already makes the known prompt unreachable, so this is belt and braces — but it is
**version-independent**: it holds for a prompt this codebase has never seen, in a CLI
version that does not exist yet, without needing a new probe marker. A future confirmation
gets answered "no" and surfaces as a clean stop instead of a hang.

Writing to an already-dead child raises `EPIPE`/`ENOENT` asynchronously, hence the
unconditional `stdin.on('error', () => {})` before the write and the `try/catch` around it.

## The capability probe

`deployCapability(projectDir)` in `packages/desktop/src/publish-args.ts` scans the
**installed** `dist/commands/deploy` of the project's own `sdk-commands` for two literal
markers:

```ts
const MULTI_SCENE_FLAG = '--multi-scene'
const CONFIRM_PROMPT = 'Continue? (y/N) '   // the trailing space is real
```

Version numbers are not usable here: the flag differs per project install, and the
protocol-squad channel builds this project pins share version numbers across commits
(see the SDK pin note in the repo memory). The source is the only truth.

| result | meaning | what we pass |
|---|---|---|
| `additive` | the flag is declared | `--multi-scene` |
| `legacy-additive` | neither marker — the build predates the whole branch | nothing |
| `destructive` | the prompt exists but the flag does not | nothing; the UI blocks the publish *if the world holds scenes it does not overlap* |
| `unknown` | `node_modules` not installed yet, so the scan cannot answer | nothing |

Three traps, all handled:

- **Never cache `unknown`.** `deployCapability` returns `{ kind: 'unknown' }` *before* any
  `cache.set` when the deploy dir is missing, exactly as `supportsNoClient` does in
  `servers.ts`. Caching a "not installed yet" answer would pin the wrong capability for the
  lifetime of the process.
- **The cache is stamped, not just keyed.** A blocked creator's next move is
  `npm i @dcl/sdk@latest` *in that folder*, so an entry keyed on the path alone would hand
  back the pre-update verdict for the life of the process — the block telling them to do the
  thing they just did. Entries carry the `mtime:size` of the installed
  `dist/commands/deploy/index.js`, and a reinstall moves it.
- **The probe must run after `ensureProjectDeps`.** In `publishStart` it does — the call
  sits between the install and the spawn, so main's decision to pass the flag is always
  made against a real installed CLI.

The renderer has its own copy via `shell.deployCapability(dir)`, used only to decide
whether to *block or warn*. It can legitimately answer `unknown` at pick time (deps not
installed yet). **Main computes the flag independently at spawn time**; the renderer's copy
never decides the arg array. `unknown` means "not yet answerable", never "old SDK".

## Why an old SDK without the flag publishes unchanged, and silently

The destructive block and the flag were added **in the same change**. The guard is
`if (isWorld && !multiScene && worldName)` — so in a build old enough not to declare
`--multi-scene`, the world-scenes fetch, the warning, the prompt and the delete **do not
exist at all**. Such a build goes straight to `POST /entities`, which is additive by
construction: it replaces only the scenes whose parcels intersect.

The result is that a `legacy-additive` build is *safer* than the 7.25-era one, and it
publishes with **no warning of any kind** — there is nothing to warn about.

**And this is exactly why the flag must not be passed to it.** An unknown argument in
sdk-commands is an `ArgError`: the CLI catches it, prints its help text, and **returns
without deploying**. Exit code 0, no upload, no error the creator can act on — a second
silent no-op, indistinguishable from the incident above. The flag can only ever go to a
build that declares it, which is what the three-valued probe is for.

So `legacy-additive` is **not** blocked: there is nothing in such a build to block. It
publishes exactly like `additive` does, minus a flag it would choke on.

`destructive` is the only capability the UI refuses to spawn — and only when the CLI would
actually take its destructive branch. That branch is three conditions deep, not one:

```js
if (isWorld && !multiScene && worldName)        // 1. a world, no flag
  if (existingScenes.length > 0)                 // 2. the world holds something
    if (getScenesOnOtherParcels(...).length > 0) // 3. …that we don't overlap
      warn → promptUser('Continue? (y/N) ') → needsDelete = true
```

Blocking on the SDK version alone would refuse a publish into an empty world — or a plain
republish onto the scene's own parcels — and offer "update your SDK" as the only way out of
a situation that was never dangerous. So `publish-flow.ts` mirrors condition 3:
`destructiveVerdict(world, parcels)` reads the world and blocks with the old-SDK message
only when it holds scenes this publish does **not** overlap. If the world cannot be read at
all, the offline message blocks instead — for `destructive` alone, an unknown world is not
a world worth guessing about.

## The flow

`publish-flow.ts` is a module singleton state machine:

```
idle → checking → [ review | blocked ] → building → uploading → success | error
```

- **checking** — read the scene's own parcels (`sceneSettings` IPC), probe the capability,
  check permissions, then ask who is standing on those parcels.
- **review** — one decision is waiting: either a real collision (`kind: 'conflict'`) or the
  world could not be read (`kind: 'unreadable'`).
- **blocked** — this scene's SDK cannot publish next to other scenes (`old-sdk`), or we are
  offline *and* the SDK is old (`offline`). No spawn happens.
- **building / uploading** — main's job; `ready` is the renderer's cue to sign the rootCID
  and POST to the local linker.

**Everything that could replace someone's work is decided before the spawn.** Once the CLI
runs, the only lever it has is a stdin prompt nobody can answer, so a question asked after
the spawn is a question that never gets asked.

Failing open is the rule for every pre-flight except the capability probe: an unreachable
permissions endpoint, an unrecognised response shape, or an empty allow-list is not proof
of a denial, and refusing to publish on a guess is worse than letting the server answer.
The capability probe is the exception because a check that blocks on its own failure would
be a worse bug than the one it guards.

### The conflict review

Only scenes that would actually be replaced are shown. `conflictsFor` exempts exactly one
row: the **entity id** this project folder published to this world last time.

Wallet + parcel set is *not* an identity, and using it as one was a data-loss bug. Every
project Studio creates starts on `0,0` (`templates/blank/scene.json`, `templates/starter`),
so publishing a second project of yours to a world that already holds the first looked like
a republish of it — the row was filtered out, no dialog opened, and `POST /entities`
replaced a live scene with nothing said. Title is no better: two untouched templates are
both called *New Scene*.

The entity id is the one thing that says "this deployment came out of this folder", and we
know it because we signed it — the linker's `rootCID` **is** the entity id the world stores,
and it comes back as `entityId` on every row of `/scenes`. `publish-identity.ts` records it
per `dir + world` on every successful publish.

Losing that memory — a new machine, cleared storage, a folder that published from the CLI —
costs exactly **one** confirmation on the next publish, after which it is remembered again.
That is the safe direction to fail in: an extra dialog, never a silent replacement.

The creator gets three ways out, and **none is pre-armed** — pressing Return must not
replace anything:

- **Cancel**
- **Move my scene to free parcels** — `nearestFreeFootprint` preserves the footprint's
  shape (offsets from base), searches Chebyshev rings outward with a deterministic
  tie-break, clamps to `-150..150`, and excludes the creator's **own** scene (by entity id)
  from the occupied set so a republish is never pushed off its own parcels. The rows the
  dialog is showing seed that occupied set, because `fetchWorldScenes` never throws — a
  world it could not read comes back as an *empty* one, and taking that at face value would
  let the search accept ring 0 and "move" the scene to the parcels it is already colliding
  on. An unreadable world is reported, not searched. The move is previewed first and only
  written to `scene.json` on confirmation; because a moved scene is a different scene as far
  as the world is concerned, the pre-flight then starts over.
- **Replace and publish**

### The lease

A conflict takes time to read and longer to read *about*. Before spawning, `confirmPublish`
re-reads the same parcels and compares `leaseOf(rows)` — a sorted digest of
`{entityId, parcels}` only, insensitive to server row order and blind to title/timestamp
churn. It fires exactly when the sentence the creator agreed to stopped being true, and
then nothing is published.

A **failed** re-read does not block: it is not evidence that anything moved, and
`--multi-scene` bounds the write to the parcels they just agreed to replace.

### Classifying an exit

`classifyPublishExit({ ready, code, sawPrompt }, world)`:

| facts | verdict |
|---|---|
| `ready` | `ignored` — past `ready` the upload owns the outcome |
| `sawPrompt` (a `(y/N)` line appeared in the log) | `stopped`, **whatever the exit code** |
| `code === 0` before ready | `stopped` |
| `code === null` (signal — including our own `publishStop`) | `stopped` |
| any other non-zero code | `failed` — *"The build failed."* |

Both pre-upload verdicts carry `worldUnchanged: true` as a **typed field**. That is a fact,
not a hope: everything classified here happened before a single byte was signed, and
because `--multi-scene` is always passed the CLI's destructive pre-flight is unreachable.
The approved copy for the failure sentence carries no "nothing changed" clause, so the
assertion lives in the type rather than being invented in prose.

---

## Removing a scene from a world

Removal is a **named, scene-scoped action** in the Worlds surface — the "Scenes published
here" block on a world's Overview tab, opened by right-click → **Remove from world…**
(`ContextMenu` + `MenuItem danger`, never a `⋯` menu), confirmed in a modal that names the
scene, its parcels, and how many other scenes stay live.

`undeployScene(world, coordinate)` in `features/worlds/undeploy.ts` sends a **signed**

```
DELETE {worldsServer}/world/{name}/scenes/{coordinate}
```

Design notes:

- **It never throws.** Every outcome — signed out, transport failure, any HTTP status — comes
  back as a value, because the caller reports the failure inline next to a scene that is
  still on screen. `reason` separates *not-allowed* / *gone* / *unreachable* /
  *bad-coordinate* / *server*, which want different next moves; `404` (`gone`) triggers a
  refresh rather than an error.
- **The coordinate is a parameter, not derived.** The module does not invent one; the caller
  passes what it holds. That caller is `sceneCoordinate` in `inventory.ts`, and it addresses
  the scene **by a parcel of its footprint** — never by its base. The server does not require
  `base ∈ parcels` (that is why the locator needs a fallback at all), and
  `DELETE /world/{name}/scenes/{coordinate}` resolves whichever scene occupies the coordinate:
  a base outside the footprint would remove a *different* scene, or 404 while this one stays
  live.
- An unparseable coordinate is rejected before any request is sent.

### `DELETE /entities/` is forbidden

`DELETE /entities/{world}` is a **whole-world undeploy**. It takes down every scene in the
world at once, there is no undo, and the scenes it removes belong to project folders this
machine may not even have. It is not used anywhere in this app and must not be added.

Two guard tests enforce it, and the repo-wide one is the load-bearing half:

- `packages/ui/src/features/worlds/no-whole-world-undeploy.test.ts` walks **every source file
  in the repo** and fails on any line that builds the `/entities/` path, or on any `DELETE`
  aimed at `/world/{name}` with no sub-resource. Prose does not fail a build, and this failure
  mode is worse than drift: the forbidden request *succeeds* — nothing errors, the world is
  just empty afterwards.
- `packages/ui/src/features/worlds/undeploy.test.ts`, *"never addresses the whole-world
  undeploy"*, pins the sanctioned URL:

  ```ts
  expect(url).toContain('/world/boedo.dcl.eth/scenes/')
  expect(url).not.toContain('/entities')
  ```

`undeploy.ts` is the only module in the app that deletes anything from a world. If a second
deletion path is ever added, the repo-wide scan already covers it — a reviewer should treat a
new `DELETE` against the worlds server as a blocking finding unless it names what inside the
world goes.

## Explicitly not built

Deliberate omissions, so nobody re-adds them as "missing":

- No world map or placement grid in the publish flow.
- No publish-mode setting, no "advanced" toggle.
- No "Don't show this again" checkbox and no persisted skip flag — the confirmation exists
  because it is the only thing standing between a creator and someone else's deleted scene.
- No offline queue.
- No bulk "Empty this world".

## Known unverified

Written down because the code is defensive about them and a future failure will point here
first:

- **The scene-scoped `DELETE` has not been exercised live from this machine.** Three details
  are coded against the documented contract, not an observed response: whether the
  `{coordinate}` segment must be the scene's **base** parcel or any parcel of its footprint;
  which success status the server returns (both `200` and `204` map to `ok`); and whether
  the server matches the segment percent-encoded (we send `encodeURIComponent`, so the comma
  travels as `%2C`, which is also the pathname ADR-44 signs). If a live run 404s or 401s on
  a coordinate that clearly exists, those are the first two suspects.
- **`POST /world/{name}/scenes` with `{"coordinates": [...]}`** is likewise coded against the
  documented contract rather than a live call; the response mapping is defensive about every
  optional field.
- **Whether the reference explorer renders more than the single urn from `/about` is
  unknown.** The worlds content server clearly stores many scenes per world and serves them
  from `/scenes`, but `/about`'s `configurations.scenesUrn` carries only the newest one, and
  we have not confirmed what a visitor entering the world actually loads. If it turns out the
  explorer renders only that one urn, additive publishing is still correct on the server side
  — but "your scene is live at x,y" would be overpromising to a creator, and the success copy
  would need revisiting. Nothing in this app depends on the answer; the creator-facing
  sentence does.

## Signed fetch (ADR-44)

All authenticated management calls are signed-fetch — ADR-44 `x-identity-*` headers
(payload `method:path:timestamp:metadata`, each auth-chain link as an
`x-identity-auth-chain-<i>` header) — **renderer-side**, in
`packages/ui/src/features/worlds/signed-fetch.ts`, using the AuthIdentity from sign-in.

The world reads that are public state are deliberately **unsigned** plain fetches:
`GET /world/{name}/scenes`, `POST /world/{name}/scenes` (the collision question), and
`GET /world/{name}/permissions`. Anything that **writes** — settings, permissions, and the
scene removal — is signed.
