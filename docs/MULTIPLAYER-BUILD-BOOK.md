# Multiplayer Core — Build Book

> Repo-side record of the build book. Presentation artifact is published from Studio sessions; this file is the source of truth for content. Chapters: Introduction · Architecture Layers · Step-by-Step Build · Editor Design.

# Introduction — the multiplayer bet in ten minutes

## 1. Why authoritative-by-default

Every Decentraland Studio scene is a multiplayer game with its own server — free, sleeps when empty — and there is **no toggle**. This is the product bet: authority is physics, not a setting. The controlling precedent is Roblox's FilteringEnabled arc — they shipped client authority as the easy default, spent a decade paying for exploited and divergent worlds, then forced the flip anyway. An authority switch is not a creative choice; it is a way to ship an insecure or divergent world without knowing it. So we skip the decade: server-authoritative from the first scene, and the entire DX job is making that default feel effortless instead of expert.

## 2. The mental model

**Every scene runs one shared copy: the game — it decides what's true and remembers.** Creators talk to it through one object, `game`. The fork between "in the game, for everyone" (**green ●**) and "on this player's screen" (**blue ●**) is expressed by *which callback you write*, never by an `if`. Players never change the game directly — they **ask** (`game.send`), the game **decides** in a handler (`game.onMessage`), and **tells** the screens with the same pair in the other direction. Facts everyone must agree on live in `game.state`; late joiners see them automatically. Messages are moments, state is facts: *the explosion effect is a message that fades; the health bar is state that stays.*

The four canonical recipes, one line each:

- **Shared spawn** — click asks `openChest`; the game `spawn`s one gold pile everyone (and every late joiner) sees.
- **Seeded local spawn** — `game.layout('rock', rng => …)` scatters identical rocks on every screen, zero wire traffic.
- **Ask the game** — `pray` handler checks `game.state`, flips a flag, returns points; identity from the connection, decision before anything slow.
- **Report and validate** — screens `report('hit', …)`, the game clamps and keeps truth, screens learn the verdict via `send('died')`.

## 3. The system at a glance

**Scene bundle.** One build artifact — your entities, prefab scripts, and the generated `src/scripts/runtime/game.ts` module — with no server/client variants. Arrow: *bundle → deployed once*.

**Runs 1+N times.** That one bundle boots as **1 game copy** (headless, no renderer, wakes on first visitor in ~15 s, sleeps minutes after the last leaves) plus **N screen copies**, one per player. Arrows: *bundle → \[game\]* and *bundle → \[screen 1..N\]*. Same code, different copy — which is why green/blue is decided by callback, not by file.

**Module stack.** The `game` facade composes the shipped runtime-modules kit — `rpc`, `timeSync`, `serverLife`, `protectedSync`, `serverState`, `playerStore`, `schedule`, `rng`, `spawner`, `outcomes`, `zoneBus` — as one `globalThis` singleton shared by creator code and every prefab. Box: *\[game facade\] sitting on \[11 kit modules\]*; creators only ever touch the top box.

**Transport.** Three arrows between the copies: *screen → game* asks ride the rpc layer (retries gated on `serverLife`, so cold starts queue instead of timing out); *game → screens* tells ride a sequenced broadcast ledger (gap-repaired, ~10 s moment horizon) or a targeted `{to}` path; *game state → all screens* rides the CRDT snapshot, which is what makes late joiners free. Screens never talk to screens.

## 4. What creators never think about

Twenty-six documented traps are absorbed by construction. The eight that hurt most elsewhere:

- **Code runs twice** — consequential logic exists only in green handlers, which install server-side only.
- **Registration timing** — `isServer()` is false at load and the engine seals after it; the module registers one envelope once, so `game.onMessage` is legal anywhere, anytime.
- **Zones never fire server-side** — `game.onEnterZone` bakes in detect→ask→re-verify; the broken version is unwritable.
- **Late joiners** — state and round tuples ride the snapshot; there is no readiness flag to lie.
- **Check-then-act races** — spawn keys claim before the first `await`; handlers run FIFO, awaited.
- **Silent message drops** — retry plus sequenced ledger with gap repair; size budgets warned in dev Play.
- **Payload identity trust** — `player` is the verified wallet from the connection, never from `data`.
- **Per-frame sync cost** — no sync-this-entity verb exists; swarms belong to `layout`'s seeded reconstruction.

## 5. Security in three sentences

**Structural:** a hacked client has no verb — shared state has exactly one writer (validators fused at creation), identity comes from the transport envelope, and there is no peer channel to poison. **Validated:** the module owns per-player rate limits, payload size/depth caps, and the doctrine that payloads are claims to check against server truth — positions included. **Honest ceiling:** all logic is public and avatar movement is client-authoritative, so the enforced wording everywhere is *"the game tracks results, players report actions"* — never "cheat-proof."

## 6. How prefabs sit on top

The prefab kit — Game Flow, Health & Respawn, Waves, Pickup, Collectible, Door & Switch, Points, Teams, Save Point, Announcer, the rewritten Leaderboard — is nothing but **compositions of `game.*`**: a Door is one state key plus one message; Points is `playerData` plus a state leaderboard. Each ships an `ai.md` contract in `game` vocabulary, and `game.md` carries the four recipes verbatim so AI-generated glue converges on the same shapes. Target: 90% of game ideas from prefabs alone, AI filling gaps *between* prefabs, never inside them. Because every prefab speaks `game`, this API is the ground every future prefab stands on.

## 7. Where we are

Kit modules and Spawner are shipped; the multiplayer builtins are shelved pending rework. The G-track runs **G1 headless harness → G2 the `game` module (the big one) → G2b AI contract + lints → G3 visibility surfaces → G4 saved data & secrets → G5 the kit returns → G6 two-player Play → G7 Arena demo** — G1 builds first because it gates G2's ship.

---

**Remember three things:** the game is one shared copy of your scene that decides and remembers; where you write the callback decides where it runs — green for everyone, blue for this screen; players ask, the game decides, and the game tracks results — players only ever report actions.
---

# Architecture Layers — what code is behind `game.*`

The `game` module (plan §2.1, milestone G2) is **not** a new runtime — it is a facade over ~4,300 lines of shipped, harness-tested modules in `packages/desktop/runtime-modules/`. Each module is carried per-prefab as a byte-identical copy (`node scripts/sync-runtime-modules.mjs`), shares one live instance through a versioned `globalThis` key probed **by shape, never `instanceof`** (two prefab copies = two class identities), and exists to absorb exactly one class of engine fact from `CLIENT-SERVER-SPAWNING.md` (CSS). SDK-free logic lives in `pure/` (~1,150 lines, unit-tested from `packages/desktop/src/runtime-pure.test.ts`).

Bottom-up:

---

## Layer 1 — `rpc.ts` (134 lines, no globalThis key)

The correlated request/response primitive everything blue→green rides. Registers two message schemas per namespace (`<ns>.rpc.req` / `<ns>.rpc.res`) at **module scope** — absorbing "the engine seals after module load" (CSS:14 / SKILL.md:51) — while the server/client transport halves install lazily on the first `handle()`/`call()`, absorbing "`isServer()` is false at module load" (CSS:13). Payloads are JSON strings inside the envelope (no creator-facing `Schemas.*`, killing CSS:139). Replies are **always targeted `{to:[context.from]}`** — never broadcast-then-filter — and the server **always** responds, because a silent server wedges the caller (CSS:141). Retry: 1 s tick, 4 s timeout, 2 retries via `PendingMap` (`pure/pending.ts`).

```ts
export interface Rpc {
  handle(method: string, handler: (body: unknown, from: string) => unknown | Promise<unknown>): void
  call<T = unknown>(method: string, body?: unknown): Promise<T>
}
export function createRpc(namespace: string): Rpc
```

The targeted reply — identity from the transport, answer to the caller only:

```ts
room.onMessage(`${namespace}.rpc.req`, (raw, context) => {
  if (!context) return
  const data = raw as Req
  void (async () => {
    let ok = true
    let result: unknown = null
    try {
      const handler = handlers.get(data.method)
      if (!handler) throw new Error(`no handler: ${data.method}`)
      result = await handler(data.body === '' ? undefined : JSON.parse(data.body), context.from)
    } catch (e) {
      ok = false
      result = e instanceof Error ? e.message : String(e)
    }
    // always respond, targeted — a silent server wedges the caller
    room.send(`${namespace}.rpc.res`, { id: data.id, ok, body: JSON.stringify(result ?? null) }, { to: [context.from] })
  })()
})
```

Note for the `game.ts` delta: this dispatch is **detached async** — the FIFO-awaited per-name queue the plan promises (trap 12) does not exist here and must be added a layer up.

## Layer 2 — `timeSync.ts` (130 lines, no globalThis key)

One shared clock. NTP-style: client sends 5 probes at 0.15 s spacing, server answers each **targeted** with `{t2,t3}`, client drops best/worst RTT and averages offsets (`pure/time-math.ts`), resyncs every 60 s. Absorbs the readiness-signal unreliability (CSS:138 — "send-and-retry *is* the handshake", no connectivity gate at all) and the BigInt trap (CSS:104): every `Int64` off the wire is `Number()`-coerced before arithmetic. This is `game.now()`, verbatim.

```ts
export function initTimeSync(): void            // both sides, once, from start()
export function getServerTime(): number         // Date.now() + offset on clients
export function isTimeSyncReady(): boolean
export function getTimeSyncOffset(): number
```

```ts
room.onMessage('runtime.timeSyncResponse', (data) => {
  if (data.id !== pendingId) return
  pendingId = null
  // Int64 fields can arrive as BigInt depending on the SDK build — mixing
  // BigInt into number arithmetic throws and silently kills the handler
  samples.push(ntpSample(pendingT1, Number(data.t2), Number(data.t3), Date.now()))
  if (samples.length >= SAMPLES_NEEDED) {
    offsetMs = combineSamples(samples)
    ready = true
  }
})
```

## Layer 3 — `serverLife.ts` (306 lines, `globalThis.__dclServerLife_v1`)

The liveness ladder — the one vocabulary every HUD/strip renders (`waking / running / degraded / asleep / unreachable`). Server pulses `runtime::Heartbeat { beat: Int64 }` every 2 s into a synced, refuse-all-guarded entity; clients judge life by **when they observed the value change**, never the value itself — absorbing "a CRDT snapshot survives restarts, so a stale replay carries a heartbeat value" (CSS:58) and "`isStateSyncronized()` is doubly unreliable" (CSS:58,138). Readiness is an **AND across participants**: no beat goes out until every prefab that called `startServerLife(id)` has answered `markServerReady(id)` — closing the window where a racing client's write hits an unguarded component — and the same tick fires `sealProtectedRegistration()`. This is what gates `game.send`'s queue during the ~15 s production cold start (CSS:21) and drives the Play HUD Game strip.

```ts
export type ServerLifeState = 'running' | 'waking' | 'degraded' | 'asleep' | 'unreachable'
export class ServerLifeLadder { start(nowMs): void; observe(value, nowMs): boolean; state(nowMs): ServerLifeState; ageMs(nowMs): number; everAlive(): boolean }
export function startServerLife(id?: string): void
export function markServerReady(id?: string): void
export function serverLifeState(): ServerLifeState
export function serverLifeAgeMs(): number
export function onFirstHeartbeat(cb: () => void): void
```

```ts
engine.addSystem((dt: number) => {
  const live = driver()
  if (!isReady(live)) { warnWhenReadyIsLate(live); return }
  // The seal waits for a TICK, not for the last markServerReady(): every
  // script's start() runs before the first system, so this is the first
  // moment "every participant has registered" is knowable.
  if (!live.sealed) { live.sealed = true; sealProtectedRegistration() }
  accum += dt
  if (live.beatsSent > 0 && accum < PULSE_S) return
  accum = 0
  pulse(live)   // create-or-mutate Heartbeat, syncEntity on first pulse
}, undefined, 'runtime-server-life')
```

## Layer 4 — `protectedSync.ts` (228 lines, `globalThis.__dclProtectedSync_v1`)

The one legal way to publish a server-owned entity. Fuses create + `syncEntity` + `validateBeforeChange` in a single call "so there is no entity that is synced but unguarded for a frame" — absorbing "`syncEntity` alone is last-write-wins; any client could write back" (CSS:55). The server's own writes bypass the validator (`isServerPeer` vs `AUTH_SERVER_PEER_ID`); a `validate: () => false` is plain "server-owned, read-only to everyone else." Throws on clients (nothing to validate there). Every registration lands in a globalThis ledger and, preview-only, a structured `[SERVER] protected-sync {…}` log line the editor parses for its observed-authority view; registrations after the seal log `"kind":"late"`.

```ts
export function protectedSync(options: { entity: Entity; syncId: number; components: unknown[]; validate: (change: ProtectedChange) => boolean }): void
export function protectSynced(entity: Entity, components: unknown[], validate: (change: ProtectedChange) => boolean): void
export function protectedPooledReset(entity: Entity): void
export function protectedRegistry(): ProtectedEntry[]
export function sealProtectedRegistration(): void
```

The fused guard — server bypass first, creator's validator second:

```ts
for (const component of definitions) {
  componentIds.push(component.componentId)
  component.validateBeforeChange(entity, (change) => {
    if (isServerPeer(change.senderAddress, AUTH_SERVER_PEER_ID)) return true
    return validate({
      entity: change.entity,
      component,
      value: change.newValue,
      from: change.senderAddress
    })
  })
}
```

## Layer 5a — `serverState.ts` (106 lines, `globalThis.__dclServerState_v1`)

Server-private named state with opt-in Storage persistence — where secrets like the next round's seed live (§11 seed secrecy), because a synced component reaches every peer *by construction* and no flag changes that. **Every method throws on a client** — a leak becomes a loud Play crash, not a silent success. Absorbs "`Storage.set` resolves `false` silently on quota breach" (CSS:154): a failed write leaves the store dirty so the next flush retries. Keys are claimed globally so two prefab copies can't silently share a store. Backing for `game.saved`.

```ts
export interface ServerState<T> { get(): T; patch(next: Partial<T>): void; restore(): Promise<void>; flush(): Promise<void> }
export function serverState<T extends object>(options: { key: string; defaults: () => T; persist?: boolean }): ServerState<T>
```

```ts
async flush(): Promise<void> {
  assertServer(`serverState('${options.key}').flush`)
  if (!persist || !store.needsFlush()) return
  const { value, encoded } = store.snapshot()
  if (await Storage.set(storageKey, value)) store.markPersisted(encoded)
  // false ⇒ stays dirty ⇒ next flush retries — Storage never throws, it lies
}
```

## Layer 5b — `playerStore.ts` (244 lines, `globalThis.__dclPlayerStoreKeys_v1`)

Per-wallet write-behind store over `Storage.player`: rows live in memory, are normalize-on-read repaired against a schema version, and flush **only at checkpoints** — 3 s debounce, 15 s hard ceiling from the oldest un-flushed mutation — absorbing the 40-in-flight-host-call / write-quota budget (CSS:154, "a round writes the same row dozens of times a second; the storage quota is the scarce resource"). Second construction on one key **throws** (two stores on one key = data loss days later). Backing for `game.playerData(p)` — the G2 delta awaits `load()` before a player's first green handler so `.get()` never races the restore.

```ts
export class PlayerStore<T extends Versioned> {
  load(address: string): Promise<T>
  get(address: string): T | null
  mutate(address: string, mutator: (value: T) => void): boolean
  markDirty(address: string): void
  save(address: string): Promise<boolean>
  saveDirty(): Promise<string[]>
  flushIfDue(nowMs?: number): Promise<string[]> | null
  flushNow(): Promise<string[]>
  saveAndEvict(address: string): Promise<boolean>
}
export function createPlayerStore<T extends Versioned>(options: PlayerStoreOptions<T>): PlayerStore<T>
export function releasePlayerStoreKey(key: string): void
```

## Layer 6 — `outcomes.ts` (373 lines + `pure/outcomeLedger.ts` 156, `globalThis.__dclOutcomes_v1`)

The sequenced, server-validated gameplay-event ledger — and the **module the plan names as the timing-pattern precedent** (`outcomes.ts:37-42`): rpc schemas register at module scope, but which transport half installs is decided on the first ledger *call*, from a `start()`, when `isServer()` is finally truthful. Absorbs "one dropped broadcast used to mean one client with a permanently wrong alive-set" (CSS:135-136): server appends to an `OutcomeLog` with monotonic seq, broadcasts in ≤48-entry chunks (under the 13 KB silent-drop threshold), clients apply strictly in seq order via `OutcomeStream` and repair gaps over paged `outcomes.since` rpc; `snapshot()/fastForward()` is the rejoin path. This is the chassis for the green→screens broadcast half of `game.send`.

```ts
export type OutcomeValidator = (payload: { instanceId: number; amount?: number }, from: string)
  => { ok: true; value: number } | { ok: false; reason: string }
export interface OutcomeLedger {
  report(kind: string, payload: { instanceId: number; amount?: number }): void   // client → server, never throws
  validate(kind: string, fn: OutcomeValidator): void                             // server, before first heartbeat
  onOutcome(handler: (entry: OutcomeEntry) => void): () => void                  // every client, seq order
  snapshot(): OutcomeEntry[]
  fastForward(entries: OutcomeEntry[]): void
  isSynced(): boolean
}
export function outcomes(key: string): OutcomeLedger
```

Gap detection and repair, the heart of "reliable-but-droppable" (CSS:135):

```ts
function installClient(shared: OutcomeHub): void {
  room.onMessage(BROADCAST, (raw) => {
    const data = raw as { key: string; entries: string }
    const state = ledgerState(shared, data.key)
    const { applied, gapFrom } = state.stream.accept(decode(data.entries))
    deliver(state, applied)                       // strictly in seq order
    if (gapFrom !== null) syncFromServer(shared, data.key, SYNC_RETRIES, SYNC_PAGES)
  })
}
// server repair handler: one page per reply — a whole match's history in a
// single message would cross the transport's size limit and be dropped silently
const page = chunkEntries(state.log.since(request.seq), ENTRIES_PER_MESSAGE)[0] ?? []
return { entries: page, firstSeq: state.log.firstSeq, lastSeq: state.log.lastSeq }
```

## Layer 7 — `spawner.ts` (908 lines — the largest module, `globalThis.__dclSpawner_v1`; + `pure/poolState.ts` 104, `pure/spawnPlan.ts` 137, `pure/scriptInit.ts` 110)

Runtime instancing of editor-authored prefabs from generated snapshots (`src/scripts/spawnables.ts`), with **authority as the pool-open argument** — the shipped decision the Spawner enum flips (plan §3). Four modes: `'server'` (one synced entity the server owns, v1 single-entity limit CSS:62, every synced component armed with refusing validators), `'planned'` (client-local clones from a pure plan of the tuple; `outcomes` declaration **mandatory** — it throws without one, CSS:117), `'seeded'`, `'perPlayer'` (AvatarAttach'd per roster). Clone scripts are constructed **exactly as the SDK runner constructs placed scripts** (`pure/scriptInit.ts`, fingerprint-guarded by `probe-script-runner.mjs`). Absorbs the auto-sync-id rule (CSS:54), unguarded-sync (CSS:55), release/collider-reload (CSS:62), and the rejoin-resurrection trap (CSS:105 — a death landing before its spawn cancels it, via `PlanQueue.suppress`).

```ts
export function registerSpawnables(snapshots: PrefabSnapshot[], components?: Record<string, unknown>): void
export function pool(prefab: string, mode: 'server' | 'seeded', opts?: PoolOptions): Pool
export function plan(prefab: string, planFn: SpawnPlan, opts: PoolOptions & { outcomes: string[] }): PlannedPool
export function perPlayer(prefab: string, opts?: PoolOptions): PerPlayerPool
export function spawnedFrom(entity: Entity): { prefab: string; instanceId: number } | null
export function poolFor(prefab: string): Pool | null
export function snapshotRootComponent(prefab: string, name: string): unknown
export function detach(entity: Entity): void
// Pool: acquire(instanceId?, init?): Entity | null · mutate · release · releaseAll
//       alive() · instanceIdOf(entity) · entityOf(instanceId)
// PlannedPool adds sync(tuple); PerPlayerPool adds addressOf(entity)
```

The `'server'` spawn — sync id auto-assigned, guard fused in the same breath:

```ts
if (serverOwned && parked === null) {
  synced = synced ?? syncedComponents(snapshot)
  syncEntity(
    clone.root,
    synced.map((definition) => definition.componentId)   // NO explicit id: auto (CSS:54)
  )
  // syncEntity alone is last-write-wins, so a modified client could write the
  // clone's synced state and be believed. "Server-owned · read-only on
  // clients" is only true once every one of those components refuses a write
  // that did not come from the auth server.
  protectSynced(clone.root, synced, () => false)
}
```

And the client half — `watchServerClones` adopts what the server created (this is how `game.spawn`'s result appears on every screen):

```ts
engine.addSystem(() => {
  for (const [entity, marker] of engine.getEntitiesWith(SpawnedFrom)) {
    if (marker.prefab !== impl.prefab) continue
    const bound = impl.state.instanceIdOf(entity)
    if (bound === marker.instanceId) continue
    if (bound !== null) impl.release(entity)   // reused slot: rebuild against the new id
    impl.adopt(entity, marker.instanceId)       // starts its scripts locally
  }
  for (const slot of impl.state.slots()) {
    if (SpawnedFrom.has(slot.entity)) continue
    impl.release(slot.entity)                   // server removed it
  }
}, undefined, `runtime-spawner-adopt-${impl.prefab}`)
```

## Layer 8a — `zoneBus.ts` (127 lines + `pure/zoneRegistry.ts` 115, `globalThis.__dclZoneBus_v1`)

Cross-script zone composition keyed by the entity's **Name** (trimmed, case-insensitive via `zoneKey` — "two spellings of one place is a silent failure"). Occupancy is the primary API (`isInZone` can't flicker like an event stream). Client-side by design — trigger zones never fire on the headless server (CSS:23); the server-side re-verification lives in the `trigger-zone-server` prefab (`zone-authority.ts`: 1 m slack, 4 Hz sweep, late-joiner grace, CSS:31), which `game.onEnterZone` absorbs.

```ts
export function isInZone(zone: string): boolean
export function playersInZone(zone: string): Entity[]
export function zoneNames(): string[]
export function zoneOf(entity: Entity): string
export function onZone(zone: string, kind: ZoneListenKind, fn: (event: ZoneEvent) => void): () => void
export function publishZone(zone: string, zoneEntity: Entity, occupants: () => Entity[]): void   // TriggerZone only
export function emitZone(zone: string, kind: ZoneEventKind, who: Entity, zoneEntity: Entity): void
```

## Layer 8b — `rng.ts` (49 lines + `pure/rng.ts` 28, no key)

Seeded mulberry32 draws plus **the draw-order contract** — the five documented rules (one stream per (seed, purpose) via xor constants; draw count depends only on shared values, never player count/local time/frame rate; draw before you branch; iterate in index order; append-only + `configVersion` bump) that make client-side reconstruction agree across peers (CSS:102). `game.layout`'s `(rng, round)`-only callback signature makes rules 2–3 unbreakable by construction.

```ts
export type { Rng } from './pure/rng'
export { createRng, rngRange, rngInt, rngPick } from './pure/rng'
export function seededSequence(seed: number, count: number, draw: (rng: Rng, i: number) => number): number[]
```

## Layer 8c — `schedule.ts` (103 lines + `pure/phase.ts` 151, `pure/countdown.ts` 70, no key)

dt-accumulator ticks and the phase machine. Nothing is a running timer: the durable state is `{phase, phaseStartMs}` + a duration cycle, and "which phase are we in" is *derived from the clock* every frame — so late joiners fast-forward by arithmetic (CSS:97) and a server sleep collapses into the final phase instead of replaying hundreds (`PhaseWatcher`). Backing for `game.every` and half of `game.round`.

```ts
export function interval(seconds: number, tick: (elapsed: number) => void, name?: string): () => void
export function onPhaseBoundary(read: () => { tuple: PhaseTuple; durationsMs: readonly number[] } | null,
                                onEnter: (phase: number, tuple: PhaseTuple) => void, name?: string): () => void
// re-exports: remainingMs, isExpired, countdownRemainingMs, settleExpired, periodId, dailyKey, weeklyKey,
//             advancePhase, phaseOf, phaseElapsedMs, phaseEndsAtMs, phaseRemainingMs, PhaseWatcher, …
```

## Supporting modules

| Module | Lines | Key | Role for `game.ts` |
|---|---|---|---|
| `playerPositions.ts` | 79 | — | Client-side roster; resolves the two coordinate frames (local player is scene-local, remote avatars are WORLD-parented — mixing them only works at parcel 0,0). Returns `[]` on the server (CSS:23) — which is *why* `game.positionOf` needs a new server-side path. |
| `spawnPoints.ts` | 64 | `__dclSpawnPoints_v1` | `requestSpawn(name)` registry; first claimant wins, collisions logged not thrown. |
| `version.ts` | 4 | — | module-suite version stamp. |
| `pure/pending.ts` | 59 | — | `PendingMap` — rpc's timeout/retry bookkeeping. |
| `pure/liveness.ts` | 32 | — | observed-change-time tracker under `ServerLifeLadder`. |
| `pure/membership.ts`, `pure/spawnScatter.ts`, `pure/worldTransform.ts`, `pure/normalize.ts`, `pure/serverStore.ts`, `pure/protectedFields.ts` | ~420 | — | zone membership math, scatter, transforms, schema repair, dirty-tracking store, ledger + `isServerPeer`. |

---

## The mapping table — plan §2.2 verb → modules → the `game.ts` delta

`game.ts` + `pure/gameCore.ts` (G2) is a **singleton facade** at `globalThis.__dclGame_v1`, registering exactly one `createRpc('game')` envelope + one sequenced broadcast stream at module scope, forking lazily on first tick.

| `game.*` verb | Implemented by (shipped) | NEW code `game.ts` must add |
|---|---|---|
| `game.onStart(cb)` | `serverLife` (readiness AND-gate), `protectedSync` (seal) | Boot sequence: re-adopt stale `SharedFact` entities from the surviving CRDT snapshot (CSS:58), delete them respecting defer-a-tick (CSS:61), republish fresh state, *then* run `onStart`, *then* `markServerReady('game')` |
| `game.state` / `setState` / `onStateChange` | `protectedSync.protectSynced` (refuse-all), auto sync ids (CSS:54) | The `runtime::SharedFact {key, json, rev}` component; per-top-level-key entity sharding; per-key per-tick write coalescing; 4 KB dev-Play size guard; client mirror + change events; green-context teaching guard |
| `game.saved.get/.set` | `serverState` (`persist: true`, dirty-retry flush) | Thin rename; checkpoint wiring into round/leave hooks |
| `game.playerData(p).get/.set` | `playerStore` (debounced write-behind, normalize-on-read) | Sync-shaped facade over the async store: await `load()` before the player's first green handler; ~8 KB/player cap (§11) |
| `await game.secret(name)` | — (raw `EnvVar` via `@dcl/sdk/server`) | New thin green-only wrapper; publish-flow key registry feeds off its call sites |
| `onClick(entity, cb)` | — | New: wraps `pointerEventsSystem`, ships in the same module |
| `game.send` (blue→green) + `onMessage` (green) | `rpc` (correlation, targeted replies, retry) + `serverLife` | Name-keyed handlers on ONE envelope; **retry timer gated on `serverLife`** (stock ~12 s budget < ~15 s cold start, CSS:21); per-name FIFO **awaited** dispatch + try/catch (replacing rpc's detached async, CSS:59,154); per-name direction registry; typed unknown-name errors; §11 rate limits + payload size/depth caps |
| `game.send` (green→screens) + `onMessage` (blue) | `outcomes`' seq/gap-repair/48-entry-chunk machinery (CSS:135-136) | A second general-payload sequenced stream with a ~10 s moment horizon; separate plain targeted path for `{to: player}` (can't share the ledger — non-targets would see permanent gaps) |
| `game.spawn/despawn` | `spawner.pool(prefab,'server')` + `protectSynced` + `watchServerClones` | `key` idempotency claimed synchronously before any await (CSS:59); `ownedBy: player` auto-despawn wired to leave detection (orphan rule, CSS:60) |
| `game.layout` / `instanceOf` | `spawner.plan` (mandatory outcomes, `PlanQueue.suppress`) + `rng` (draw-order contract) + `timeSync` (forced init, CSS:97) + `pure/spawnPlan.planInstanceId` (CSS:116) | `(rng, round)`-only callback signature (divergence unbuildable by construction); `instanceOf` = `spawnedFrom(entity).instanceId` |
| `game.report` / `onReport` | `outcomes` — nearly verbatim (`report`/`validate`) | Rename + amount-or-veto return shape sugar |
| `game.onPlayerJoin/Leave` | — (`playerPositions` is client-only; SDK `onEnterScene` never fires headless, CSS:179) | New server-side watcher over synced `PlayerIdentityData`; leave pre-wired to entity release + `playerStore.saveAndEvict` |
| `game.onEnterZone/onExitZone` | `zoneBus` (client detect) + `trigger-zone-server` prefab's `zone-authority` (verify: 1 m slack, 4 Hz, grace, CSS:23,31) | Absorb the detect→ask→verify dance behind one name-bound callback — the broken version becomes unwritable |
| `game.positionOf(player)` | `playerPositions.sceneLocalPosition` (frame math) | Server-side variant reading SDK-synced `PlayerIdentityData` + `Transform` (CSS:23); JSDoc: "feet, ~10×/second — generous checks only" (CSS:152) |
| `game.every(5, cb)` | `schedule.interval` + `pure/countdown` deadline-as-state | Deadline persistence in `serverState` so schedules survive restarts |
| `game.now()` | `timeSync.getServerTime` (`Number()`-coerced, CSS:104) | Nothing — direct re-export |
| `game.newRound` / `round` / `onRoundStart` | Shelved Round Loop prefab (tuple `{seed, phase, phaseStartMs, configVersion}`, sync id 3101, globalThis mirror) + `schedule.onPhaseBoundary` + `rng` | Port the round-loop machinery *into* the module; next-round seed drawn into `serverState`, published only at phase start (§11 seed secrecy, CSS:118) |

---

## Wire story 1 — `await game.send('openChest', { chest: this.entity })` (recipe A, blue→green→screens)

1. **Blue caller, any screen.** `game.send('openChest', …)` runs in the facade. Direction registry says `openChest` is a *player-asks* name (a green-side send of the same name would be a dev-Play error). Unknown name ⇒ immediate typed error + `[you]` error card — never silence.
2. **serverLife gate.** `serverLifeState()` is consulted: `waking`/`asleep` ⇒ the send queues, the Play HUD strip shows "◐ Waking… 12s", and the rpc retry clock does not burn its ~12 s budget against the ~15 s cold start (CSS:21). `running` ⇒ proceed.
3. **rpc envelope.** The facade's single `createRpc('game')` instance sends: `room.send('game.rpc.req', { id: 'game:17:k3x9a', method: 'openChest', body: '{"chest":517}' })`. Schema was registered at module scope (CSS:14); the payload is a JSON string — no creator `Schemas.*` (CSS:139). The request is remembered in `PendingMap` + a resend table.
4. **Transport hop, client→server.** The SDK wraps it as `CommsMessage.CUSTOM_EVENT` and `sendBinary`s it; the engine force-routes to AuthServer — on LiveKit `destination_identities = ["authoritative-server"]`, SFU-enforced, so **no other screen ever receives it** (CSS:130). Reliable + ordered per publisher, but droppable (>13 KB or >300 msgs/s/peer vanish silently, CSS:135-136) — which is what the retry system is for.
5. **Server dispatch.** `room.onMessage('game.rpc.req', …)` fires with `context.from` = the sender's wallet from the comms envelope — the transport-verified identity, lowercased; the payload can never carry one (CSS:134). `game.ts` enqueues onto the **per-name FIFO queue** (awaited, try/catch — the delta over rpc's detached async) after §11 hygiene: rate limit, size/depth caps.
6. **Green handler runs — once, for everyone.** The creator's `game.onMessage('openChest', (data, player) => …)` executes. Inside it: `game.spawn('gold-pile', { key: 'gold-517' })` claims the idempotency key *synchronously before any await* (a simultaneous second click no-ops, CSS:59), then `pool('gold-pile','server').acquire()` builds the clone, `syncEntity` with an **auto id** (CSS:54), `protectSynced(root, synced, () => false)` fuses the refuse-all guard in the same call. A handler throw is caught: `[game]` error card, queue and isolate survive (CSS:154).
7. **Targeted reply.** rpc *always* answers: `room.send('game.rpc.res', { id, ok, body }, { to: [context.from] })` — SFU-enforced targeting, non-targets can't snoop the reply (CSS:132). A silent server would wedge the caller.
8. **Blue resolution.** The caller's rpc client matches the `id`, `pending.settle()` resolves the original `await` with the handler's return value. If the reply was lost: the 1 s retry system resends (2 retries, 4 s timeout each) before rejecting.
9. **Everyone else finds out two ways.** The gold pile itself arrives as CRDT state — each screen's `watchServerClones` system sees the synced `runtime::SpawnedFrom` marker, adopts the entity into its local pool and starts its scripts (CSS:57,62); a player joining ten minutes later gets it in the `RES_CRDT_STATE` snapshot (CSS:58). The *moment* — `game.send('chestOpened', { by: player })` from green — rides the sequenced broadcast stream: seq-ordered, gap-repaired, ≤48 entries/chunk under the 13 KB drop threshold, ~10 s moment horizon; every blue `game.onMessage('chestOpened', …)` fires once. A screen never hears another screen (CSS:130-131).

## Wire story 2 — `game.setState({ doorOpen: true })` (green, the CRDT path)

1. **Green-context guard.** Called outside a green handler it throws the teaching error ("Only the game changes game.state. Move this into game.onMessage…"). Inside one, on the server, it proceeds.
2. **Per-key sharding.** `doorOpen` is a top-level key ⇒ it maps to its **own** `runtime::SharedFact { key: 'doorOpen', json: 'true', rev: n+1 }` entity (the §2.2 verdict fix — no single blob near the 12 KB chunk edge, CSS:57; fast/slow split, CSS:158). Writes coalesce to **at most one component write per key per tick**; a dev-Play guard warns past 4 KB.
3. **First write for this key** creates the entity the fused way: `engine.addEntity()` → `SharedFact.create` → `syncEntity(e, [SharedFact.componentId])` with an auto id (CSS:54) → `protectSynced(e, [SharedFact], () => false)` — synced and guarded in the same call, no unguarded frame (CSS:55). Subsequent writes are `SharedFact.getMutable(e)`.
4. **SDK serialization.** The local `PUT_COMPONENT` is rewritten to `PUT_COMPONENT_NETWORK { entityId, networkId, timestamp, data }` — the whole component, no field deltas — batched and chunked at 12 KB, shipped via `sendBinary` (CSS:57, CSS:149).
5. **Transport hop, server→everyone.** The engine relays the opaque bytes inside an rfc4 `Scene` packet over the LiveKit reliable data channel, broadcast to all connected screens (CSS:19). The server's own write bypassed validation (`senderAddress === "authoritative-server"`, CSS:17).
6. **Each screen materializes it.** The receiving SDK maps network id → local entity via `findOrCreateNetworkEntity` — creating the entity on demand (CSS:57) — and applies the component. The facade's client system observes the `SharedFact` change, updates the `game.state` mirror, and fires `game.onStateChange({ doorOpen: true })`.
7. **Late joiner, for free.** On connect the client emits `REQ_CRDT_STATE` (retrying every 2 s); the server dumps its entire synced state as 12 KB `RES_CRDT_STATE` chunks targeted at the requester alone (CSS:58). The `SharedFact` entities arrive with current values — state, unlike a message, needs no replay and has no horizon.
8. **A hacked client tries to write it back.** Its CRDT write is relayed to the server, dry-run, and handed to the fused validator — `isServerPeer`? no; creator validator? refuse-all ⇒ rejected — and the server fires a **targeted `CRDT_AUTHORITATIVE` correction** that force-resets the sender's local state (CSS:17). The other screens never see the attempt. *A modified client can ask anything and change nothing* (§11.1).
9. **The lifetime promise holds on restart.** The CRDT snapshot outlives the server (CSS:58,61) — so on the next boot, step 1 of `game.onStart`'s sequence re-adopts the stale `SharedFact` entities, deletes them respecting defer-a-tick (CSS:61), and republishes fresh state, which is exactly why "`game.state` resets when the game sleeps" is honest. Durables belong in `game.saved` → `serverState` → Storage.

These two traces are the whole model in miniature: **an ask is an rpc that resolves; a fact is a guarded entity that replicates.** Everything else in `game.*` is one of these two shapes wearing a friendlier name.
---

## Step-by-Step Build

Ordering principle: the module grows outward from the envelope (transport → dispatch → state → boot → facades), every step ends green on a probe or harness scenario, and the §9 entity-ref track runs in parallel (its first two steps predate G2 per the plan). 24 steps. Risk-flagged: **B1, B5, B8, B22**.

Legend: effort S (≤1 day) / M (2–4 days) / L (1–2 weeks). Paths are real; sketches follow the runtime-modules idiom (generated-file header, `globalThis` singleton, lazy role fork per `outcomes.ts:37-42`, JSON-over-envelope).

---

### G1 — Headless harness

#### B1 · Harness scenario runner — **G1 · L · deps: none** ⚠ RISK: bevy-headless has no AvatarBase and foreign transforms sit at origin (CSS:179) — join/leave/position scenarios can only run against hammurabi preview; the harness must declare per-scenario which stack it trusts, or green runs will lie.

**Builds:** `packages/desktop/validate/harness/run.mjs`, `harness/scenarios/` (`restart.mjs`, `spam.mjs`, `duplicate.mjs`), fixture scene under `validate/fixtures/harness-scene/`. Boots one server isolate + N client isolates over the bevy-headless test path, drives them with scripted ticks, asserts on observed CRDT + console output. Budget assertions (Storage 40-cap, 13 KB message, 300/s/peer, CSS:21) are harness-owned because bevy-headless enforces none of them (CSS:179).

```js
// packages/desktop/validate/harness/run.mjs
export async function runScenario(name, { clients = 2, stack = 'bevy' }) {
  const world = await bootWorld({ scene: FIXTURE, clients, stack })
  const scenario = await import(`./scenarios/${name}.mjs`)
  const budget = trackBudgets(world, {
    storageCallCap: 40, messageBytes: 13_000, inboundPerPeerPerSec: 300
  })
  try {
    await scenario.run(world)          // steps: world.tick(n), world.click(c, e),
    budget.assertNeverExceeded()       //        world.restartServer(), world.join()
  } finally {
    await world.dispose()
  }
}
```

**Verify:** a fixture script with a deliberate check-then-act double-spawn fails `duplicate.mjs`; fixing it with an idempotency key turns it green. `restart.mjs` kills and reboots the server isolate mid-run.
**Unblocks:** everything in G2 gates on this; B2.

#### B2 · Two spikes: waypoint verb + synced AvatarAttach — **G1 · M · deps: B1**

**Builds:** `harness/scenarios/spike-waypoint.mjs` (server writes ~1 Hz `{t, from, to}` tuples keyed to `getServerTime()`, clients interpolate; measure divergence + late-join reconstruction) and `spike-avatar-attach.mjs` (does `AvatarAttach` sync? it is absent from the denylist, CSS:56). Both end in a one-line yes/no committed to `docs/MULTIPLAYER-DX-PLAN.md` §G1. If the waypoint verb graduates, it gets its own **typed schema registered at module scope** — static shape + hot path never rides the JSON envelope (plan §2.1 decision).
**Verify:** each spike prints `WAYPOINT: yes/no`, `ATTACH: yes/no` with the measured numbers.
**Unblocks:** the chase-AI decision for G5 Waves; `spawn(…, {attachTo})` as a future verb. Nothing downstream waits on the answers — that is the point of spiking now.

---

### G2 — the `game` module (envelope outward)

#### B3 · Envelope + singleton + lazy role fork — **G2 · M · deps: B1**

**Builds:** `packages/desktop/runtime-modules/game.ts` skeleton + `packages/desktop/runtime-modules/pure/gameCore.ts` (pure dispatch tables, testable without the SDK). Registers exactly one rpc namespace and one sequenced broadcast stream at module scope (engine seals after load, CSS:14); which half installs is decided on first engine tick (`isServer()` false at load, CSS:13). Singleton on `globalThis` so every prefab's byte-identical copy and the creator's generated copy are one instance (the `zoneBus`/`serverState` convention).

```ts
// Generated by Decentraland Studio. Do not edit: …
import { engine } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { createRpc } from './rpc'
import { GameCore } from './pure/gameCore'

const GAME_KEY = '__dclGame_v1'

function core(): GameCore {
  const globals = globalThis as unknown as Record<string, unknown>
  const current = globals[GAME_KEY]
  if (current instanceof GameCore) return current
  const created = new GameCore({
    rpc: createRpc('game'),            // module scope: schemas seal with the engine
    ledger: createGameLedger()         // one sequenced green→screens stream (B4)
  })
  globals[GAME_KEY] = created
  engine.addSystem((dt) => created.tick(dt, isServer()), undefined, 'runtime-game')
  return created
}

export const game = core().surface()   // the ONLY exported object
```

**Verify:** `pure/gameCore` unit tests (Vitest, beside the other `pure/` tests); a scratch scene imports `game` from two prefab copies and both resolve to one instance (log the identity).
**Unblocks:** B4–B11.

#### B4 · Symmetric `send`/`onMessage` dispatcher — **G2 · L · deps: B3** ⚠ RISK: this is the whole API bet in one mechanism — per-name direction, one-handler rule, FIFO, moment horizon, `{to}` fork. Get the error semantics wrong here and every recipe downstream teaches the wrong thing.

**Builds:** in `pure/gameCore.ts` + `game.ts`: name-keyed handlers over the B3 envelope; per-name direction claimed on first use (asked-by-players vs told-by-the-game — using one name both ways is a dev-Play error); one handler per name (same script re-registering reuses it, a *different* script claiming it errors); unknown/wrong-direction name = typed error on the sender + `[game]`/`[you]` error card, never silence. Green→screens rides a sequenced ledger (seq order, gap repair, ≤48 entries/page — the `outcomes.ts` delivery discipline) with a ~10 s moment horizon; `{to}` takes a separate plain targeted path (JSDoc states the weaker delivery). Blue→green rides rpc with retries gated on `serverLife` (B8 wires the gate).

```ts
// pure/gameCore.ts — per-name FIFO, awaited, crash-contained (CSS:59,154)
private queues = new Map<string, Promise<void>>()

dispatch(name: string, data: unknown, player: string): Promise<unknown> {
  const entry = this.handlers.get(name)
  if (!entry) throw new GameNameError(name, this.nearestName(name))
  const prev = this.queues.get(name) ?? Promise.resolve()
  let result: unknown
  const run = prev.then(async () => {
    try {
      result = await entry.fn(data, player)
    } catch (e) {
      this.emitErrorCard(name, entry.script, e)   // [game] card — queue survives
    }
  })
  this.queues.set(name, run)
  return run.then(() => result)
}
```

**Verify:** harness `spam.mjs` — a handler that throws on entry 3 of 10 still processes 4–10 in order; a typo'd `game.send('opnChest')` rejects with the typed error naming the nearest real name.
**Unblocks:** B5, B7, B9, B10.

#### B5 · §11 hardening: rate limiter + payload hygiene — **G2 · S · deps: B4** ⚠ RISK: bevy-headless has **no** per-peer inbound cap (CSS:179) — until this step lands, harness spam scenarios can wedge the FIFO for everyone; land it before any handler-heavy step builds on B4.

**Builds:** in `pure/gameCore.ts`: per-player per-name token bucket (default N/s, tunable per handler), per-player queue cap with oldest-dropped, JSON size (~4 KB) + depth caps checked **before** dispatch, `playerData` write cap (~8 KB/player) reserved for B9.

```ts
allow(name: string, player: string, nowMs: number): boolean {
  const key = `${name}\u0000${player}`
  const b = this.buckets.get(key) ?? { tokens: RATE_PER_S, atMs: nowMs }
  b.tokens = Math.min(RATE_PER_S, b.tokens + ((nowMs - b.atMs) / 1000) * RATE_PER_S)
  b.atMs = nowMs
  if (b.tokens < 1) return false      // dropped-with-error-card, never queued
  b.tokens -= 1
  this.buckets.set(key, b)
  return true
}
```

**Verify:** harness `spam.mjs` asserts a 50 msg/s client is throttled while a second client's messages of the same name still land in order.
**Unblocks:** safe iteration on everything above B4.

#### B6 · `game.state` — SharedFact sharding — **G2 · M · deps: B3**

**Builds:** per-top-level-key synced entity `runtime::SharedFact {key, json, rev}` — auto sync id, `protectedSync` refuse-all validator fused at creation (CSS:54-55); `setState` coalesces to ≤1 component write per key per tick; dev-Play warn at 4 KB per key (CSS:57); `onStateChange(changed)` fires on every screen including late joiners off the CRDT snapshot (CSS:58); green-context teaching guard on `setState` elsewhere (documented as non-airtight).

```ts
// server side of setState — one write per key per tick, far from the 12 KB edge
setState(patch: Record<string, unknown>): void {
  this.assertGreen('game.setState')   // teaching guard, exact copy from the plan
  for (const [key, value] of Object.entries(patch)) this.dirty.set(key, value)
}
flushState(): void {                  // called from tick()
  for (const [key, value] of this.dirty) {
    const fact = this.facts.get(key) ?? this.createFact(key)  // protectedSync inside
    const json = JSON.stringify(value)
    if (json.length > 4096) this.devWarn(`game.state.${key} passed 4 KB — split it`)
    SharedFact.getMutable(fact).json = json
    SharedFact.getMutable(fact).rev += 1
  }
  this.dirty.clear()
}
```

**Verify:** harness: two keys written in one handler produce two component writes; a late-joining client reads both without any message; a hacked-client CRDT write to a fact is force-corrected (`CRDT_AUTHORITATIVE`).
**Unblocks:** B7, B9, B10.

#### B7 · Boot sequence: restart cleanup + `onStart` — **G2 · M · deps: B4, B6** ⚠ RISK: the CRDT snapshot *survives* restarts (CSS:58,61) while `game.state` promises to reset — re-adoption, the defer-a-tick delete rule (CSS:61), and stale-replay overwrite are the three easiest things to get subtly wrong, and the harness restart scenario is the only thing that catches them.

**Builds:** the server boot pipeline in `game.ts`: re-adopt stale `SharedFact` entities from the surviving snapshot → delete them respecting defer-a-tick → republish fresh state so clients holding a stale replay get overwritten → await `playerData` restores → only then run `game.onStart` (JSDoc: *"Runs once when the game wakes up (not per player, not per round)."*).

```ts
private async bootServer(): Promise<void> {
  const stale = this.adoptStaleFacts()          // snapshot outlives the isolate (CSS:58)
  await this.tickOnce()                          // defer-a-tick before delete (CSS:61)
  for (const e of stale) engine.removeEntity(e)
  this.republishState()                          // overwrite any stale client replay
  await this.playerStore.restoreAll()            // .get() never races the load
  this.phase = 'ready'
  for (const fn of this.onStartFns) await this.runGreen(fn)
  this.flushSendQueue()                          // sends queued while waking (B8)
}
```

**Verify:** harness `restart.mjs`: set state, kill server, reboot — clients converge on the fresh `onStart` state, no zombie facts; a value copied into `game.saved` in `onStart` survives.
**Unblocks:** B8, B9, B10.

#### B8 · `serverLife` gating + send queue — **G2 · S · deps: B7**

**Builds:** blue-side `game.send` queues while `serverLife` reports waking (rpc's stock ~12 s budget < ~15 s production cold start, CSS:21); retry timer gated on the ladder state; queue drains on `running`. Exposes the ladder to the play-hud relay for G3's Game strip.
**Verify:** harness with a delayed server boot: a send issued at t=0 resolves after the ~15 s wake instead of timing out at 12 s.
**Unblocks:** B18 (Game strip), B21 (cold-start toggle).

#### B9 · `saved` / `playerData` / `secret` — **G2 · M · deps: B7**

**Builds:** facades in `game.ts` over `serverState` (checkpointed, persist:true), `playerStore` (write-behind, 8 KB/player cap from B5), and `EnvVar` (`game.secret`, server-throws-on-client per `serverState`'s `assertServer` idiom). All green-only with the exact teaching error string from the plan. `playerData(p)` is sync-shaped: B7 already awaited the restore.
**Verify:** harness restart: `playerData` written pre-kill reads back post-boot; `game.saved.set` inside blue code throws the teaching error verbatim; probe asserts `secret` throws on a client.
**Unblocks:** B10, B16 (Saved data tab), B17 (Secrets).

#### B10 · Players, zones, time, rounds — **G2 · M · deps: B4, B7**

**Builds:** `onPlayerJoin/Leave` watching synced `PlayerIdentityData` (SDK `onEnterScene` never fires headless, CSS:179), leave pre-wired to release owned entities + flush data (CSS:60); `onEnterZone/onExitZone` binding by zone name to `zoneBus` and absorbing the full zone-authority dance (detect→ask→re-verify with 1 m slack, 4 Hz, late-join grace — zones never fire server-side, CSS:23,31); `positionOf` (10 Hz/feet JSDoc); `every(n, fn)` as deadline-as-state over `schedule`; `now()` = `Number(getServerTime())` (BigInt trap, CSS:104); `newRound/round/onRoundStart` porting the round-loop prefab's phase machinery into the module, next-round seed drawn into `serverState` and published only at phase start (CSS:118).
**Verify:** `probe-game.mjs` zone leg against hammurabi preview (harness can't, B1 blind spot): client teleported outside the zone who sends the enter ask is refused; `newRound` fast-forwards a late joiner by arithmetic (CSS:97).
**Unblocks:** B11, B20 (kit).

#### B11 · Things in the world: `spawn`/`layout`/`instanceOf`/`report` + `onClick` — **G2 · L · deps: B7, B10**

**Builds:** `game.spawn` = `pool(prefab, 'server')` + `protectSynced` refuse-all + auto sync id, `key` claimed **synchronously before any await** (CSS:59), `ownedBy` auto-despawn on leave; v1 single-entity limit surfaced as a typed error (CSS:62). `game.layout` = seeded/planned machinery, callback receives only `(rng, round)` — no players, no clock, by construction (CSS:102). `report/onReport` over `outcomes`. `onClick` wraps `pointerEventsSystem`. `instanceOf` resolves a laid-out clone to its shared plan instance id:

```ts
instanceOf(entity: Entity): number {
  const hit = this.pools.ownerOf(entity)   // walks layout pools' clone→instance maps
  if (!hit) {
    throw new GameError(
      `game.instanceOf: this entity is not a laid-out copy — ` +
      `only game.layout copies have a shared id (same on every screen)`
    )
  }
  return hit.instanceId                    // planInstanceId — identical everywhere (CSS:116)
}

spawn(prefab: string, opts: SpawnOptions): void {
  this.assertGreen('game.spawn')
  if (!this.claimKey(opts.key)) return     // idempotent: claimed before ANY await
  void this.pools.serverAcquire(prefab, opts)
}
```

**Verify:** harness `duplicate.mjs`: two simultaneous `spawn` calls with one key produce one entity; `Math.random()` inside a layout callback is unreachable (the callback signature simply has no clock/player input — assert the lint catches the import instead in B13).
**Unblocks:** B12 (the recipes now run), B20.

#### B12 · Generation path + template + `probe-game.mjs` — **G2 · M · deps: B11**

**Builds:** `game.ts` added to the per-prefab byte-identical carry set + generated into `src/scripts/runtime/game.ts` on first creator import (the `packages/ui/src/gameconfig/codegen.ts` path); `packages/ui/src/script/template.ts` rescaffolded to the §2.4 two-sentence template; `packages/desktop/validate/probe-game.mjs` covering: state round-trip, idempotent spawn, zone verify, late-join fast-forward, crashed-handler recovery, prefab-placed-twice.
**Verify:** the four §2.3 recipes pasted verbatim into a scratch scene run; a recipe prefab placed twice works (derived keys); `probe-game` + harness green. **This closes G2.**
**Unblocks:** G2b, G3, G5.

---

### G2b — AI contract + lints

#### B13 · Lint pack + legacy policy — **G2b · M · deps: B12**

**Builds:** ~9 blockers + ~5 warnings in the existing pure-lint scene-check registry (AST/text over `src/scripts/` only): `new MessageBus`, bare `syncEntity`, `registerMessages`/`defineComponent` in function bodies, raw `Storage`/`EnvVar` imports, `Math.random()`/`Date.now()` in layout callbacks, `body.player/wallet` identity reads, `{to:` in blue code, unmatched send/onMessage names, cross-color closure reads, green handlers in layout-clone scripts. Blockers only where `game` is imported; same rules as warnings elsewhere (pre-`game` scenes never blocked). FP-benchmark against the four-game corpora before any blocker ships.
**Verify:** zero blockers on dead-surge/towerofmadness/cozy-farm corpora; each recipe deliberately broken one way trips exactly one named check.
**Unblocks:** B14, AI diff gating.

#### B14 · `game.md` + prompt section — **G2b · S · deps: B12, B13**

**Builds:** `game.md` vendored beside the generated module (byte-capped, claims-tested, guide-index-listed, four recipes verbatim); the ~35-line O(1) section in `packages/ui/src/features/ai/` (`ai-prompt.ts`): three-question decision rule, banned-API list, identity-from-connection, honesty ceiling, no player-to-player.
**Verify:** AI prompted with each journey sentence emits the recipe shape (manual, against the corpora prompts); `game.md` byte-cap test green.
**Unblocks:** B20 ai.md rewrites, G7.

---

### G3 — see the model

#### B15 · `guarantees.ts` learns `game.*` + runs-on line — **G3 · M · deps: B12**

**Builds:** extend the scanner in `packages/ui/src/prefabs/guarantees.ts` (same masked-source, per-consumer discipline) to `game.*` call sites; render the derived line in the behavior card the branch already auto-opens (`packages/ui/src/panels/auto-expand.ts`).

```ts
// guarantees.ts — derived, never declared
const GAME_CALLS: Array<{ call: RegExp; dot: 'green' | 'blue'; label: (m: string) => string }> = [
  { call: /game\.onMessage\(\s*['"]([\w-]+)/g, dot: 'green', label: (m) => m },
  { call: /game\.onEnterZone\(\s*['"]([\w-]+)/g, dot: 'green', label: (m) => `enter ${m}` },
  { call: /game\.spawn\(/g,  dot: 'green', label: () => 'Everyone sees it' },
  { call: /game\.layout\(/g, dot: 'blue',  label: () => 'Each screen builds its own — same layout for all' },
  { call: /game\.saved\./g,      dot: 'green', label: () => 'Remembered for everyone' },
  { call: /game\.playerData\(/g, dot: 'green', label: () => 'Remembered per player' }
]
```

**Verify:** recipe A's script shows `● in the game, for everyone: openChest` with the exact hover copy; a `game`-free script shows no line.
**Unblocks:** B20 guarantee chips, B17's provenance lines.

#### B16 · Console tags + Play HUD Game strip — **G3 · M · deps: B8, B12**

**Builds:** `[game]`/`[you]`/`[player 2]` prefixes via the play-hud relay in `packages/ui/src/features/play/`; the Game strip rendering the `serverLife` ladder verbatim (`● Game running / ◔ Game lagging / ◐ Waking… 12s / ○ Asleep / ✕ Can't reach the game server — Logs`); crashed-handler `[game]` error cards with script + line, distinct from asleep.
**Verify:** the trap-1 demo — attach a legacy both-sides script, press Play, the doubled log is self-explanatory in one glance; kill the server process, strip walks the ladder without any page reload (one-way loading-screen rule).
**Unblocks:** B21, B22 demos.

#### B17 · Spawner enum + Modernize prefill — **G3 · S · deps: B15**

**Builds:** "Who sees the copies?" enum on the Spawner card (flip edits the pool-open argument `'seeded'`→`'server'` in the script — never `data.json`; "Everyone" offered only for walk-in/timer triggers); "Modernize this script" AI prefill on the script row menu for legacy-pattern warnings.
**Verify:** flipping the enum makes a crate appear for a second manually-joined client; a click-triggered spawner does not offer "Everyone".
**Unblocks:** G3 done; B20's server-agreed-spawn design has its UI anchor.

---

### §9 — entity references (parallel track; B18–B19 may land before B3)

#### B18 · `childrenOf` + Add-spawn-point verbs — **§9 · S · deps: none**

**Builds:** ~10-line helper in `packages/desktop/runtime-modules/spawnPoints.ts` (or new `pure/childrenOf.ts`), id-sorted per the level-slots precedent; right-click **Add spawn point** verb; teaching empty state on the card; retire the `"Spawn Spot"` name-prefix hack in the spawner prefab.

```ts
// id order = creation order: stable across peers, not author-reorderable —
// ordered collections (elevator floors) use an explicit Entity[] param instead
export function childrenOf(parent: Entity): Entity[] {
  const out: Entity[] = []
  for (const [entity, transform] of engine.getEntitiesWith(Transform)) {
    if (transform.parent === parent) out.push(entity)
  }
  return out.sort((a, b) => a - b)   // deterministic on the game and every screen
}
```

**Verify:** duplicate a spawner with three child spots — the copy's assembly is wired, zero param edits; existing spawner scenes unbroken.
**Unblocks:** B20 (kit prefabs use it), spawner de-hack.

#### B19 · Ref hygiene: delete guard, tombstone, stale sweep — **§9 · M · deps: none**

**Builds:** reverse-referrer walk (new — `packages/ui/src/script/references.ts` computes forward name-sets only) covering delete **and** ungroup/dissolve (⇧⌘G); tombstone chip replacing the `#517 · unnamed` fallback; **load-time stale-ref sweep** (non-negotiable: per-session generation table + no composite tombstone ledger means reopen can silently retarget); the `mergeLayout` fix so the `label` advisory field survives re-parse (`parser.ts:400-404` currently drops it).

```ts
// references.ts — the reverse walk the delete guard needs
export function referrersOf(target: EntityId, layouts: ScriptLayout[]): Referrer[] {
  const hits: Referrer[] = []
  for (const layout of layouts) {
    for (const param of layout.params) {
      if (param.type !== 'entity' && param.type !== 'entityList') continue
      const ids = param.type === 'entity' ? [param.value] : param.value
      if (ids.includes(target)) hits.push({ script: layout.src, param: param.name })
    }
  }
  return hits   // → "2 behaviors point at this door (Trigger Zone, Wall Button)…"
}
```

**Verify:** delete a referenced door → the exact warning copy with both script names; reopen a scene whose ref target was deleted in a previous session → tombstone, never a silent retarget (regression test).
**Unblocks:** B20 (pick gesture builds on healthy refs).

#### B20 · Pick gesture + `entityList` + remap + AI resolution — **§9 · L · deps: B19**

**Builds:** viewport pick mode (reuses selection raycast) + hierarchy pick + hover-flash; `entityList` parser/chip-list/merge/prefab-capture markers (symmetric with shipped `PrefabRef[]`, `parser.ts:90-102`); duplicate copied-set remap incl. `EntityClip` paste-after-death; undo ref-healing joining the existing `idAlias` pass (`history.ts:9-13`); AI executor name→composite-id at write time, refuse-on-ambiguity (`resolvePrefabRef` precedent — reverses `params.ts:73-74` knowingly); spawnables codegen keeps linting entity params on pool clones (`codegen.ts:365-371`).
**Verify:** pick a door from the viewport, rename it — ref survives (nothing stores a name); duplicate a trigger+door pair — internal ref remaps, external ref confirms quietly; AI "make the button open the lobby door" with two "door" entities → refusal with reason.
**Unblocks:** G5 kit prefabs that take refs; B23.

---

### G4 — memory you can touch

#### B21 · Saved data tab + `.editor/` mirror — **G4 · M · deps: B9**

**Builds:** LogsDrawer segments **Build | Game | Saved data | Secrets** in `packages/ui/src/features/preview/`; ValueManager over `server-storage.json`, World/Per-player sub-sections, per-key reset, two-step Clear-all; editor mirrors `node_modules/@dcl/sdk-commands/.runtime-data/server-storage.json` ↔ `.editor/server-storage.json` and restores after reinstall (editor-side only — no toolchain change). **Gotcha owned here:** env values live inside the same file (`runtime-env.js:128`) — the manager excludes env keys and Clear-all never wipes secrets.
**Verify:** reproduce trap 11 (stale saved state resurrecting an old run), fix with one per-key reset; `rm -rf node_modules && npm i` then reopen — saved data intact.
**Unblocks:** B22 (Secrets shares the drawer + the one-file exclusion).

#### B22 · Secrets publish step + masked drawer — **G4 · M · deps: B21**

**Builds:** Publish flow gains a "Secret keys" step in `packages/ui/src/features/publish/`, shown only when a script calls `game.secret()`; key names with call-site-derived provenance lines; the write-only consequence line verbatim; local entry via the preview storage endpoint (the editor never reads `.env` — standing rule); drawer tab names-only, values masked.
**Verify:** a `game.secret('WEATHER_API_KEY')` scene publishes with the key entered in-flow and the value never displayed again anywhere; a scene with no `secret` call never shows the step.
**Unblocks:** G4 done; G7's zero-terminal publish.

---

### G5 — the kit returns

#### B23 · Kit rework + new prefabs on `game` — **G5 · L · deps: B12, B15, B18, B20**

**Builds:** un-shelve the four (delete `hidden: true` after rework — Game Flow, Health & Respawn, Waves *paths-not-chase*, Level Slots) + seven new (Pickup, Collectible, Door & Switch, Points, Teams, Save Point, Announcer) in `packages/desktop/prefabs/` via the `add-builtin-prefab` skill; leaderboard rewritten on `game` as flagship; server-clock dissolves into `game.now()`; per-prefab `ai.md` rewrites in `game` vocabulary; **the server-agreed spawn design** (Spawner "Everyone" server half: detect→ask→verify→server-acquire with idempotency — explicit design item, CSS:174).
**Verify:** each coverage-table game type (hangout, race, wave survival, coin collect, tower defense, treasure hunt) assembled from prefabs alone, zero custom code, two clients (second = external bevy client on a second wallet); `probe-zombie-arena` green on the reworked kit.
**Unblocks:** B25.

---

### G6 — two people in Play

#### B24 · "Start like a real visit" toggle — **G6 · S · deps: B8, B16** *(may ship with G3)*

**Builds:** servers.ts delay flag (~15 s artificial cold start, CSS:21), persisted per project; Play chevron menu scaffold; publish checklist cold-start line.
**Verify:** with the toggle on, pressing Play shows the Game strip walking `◐ Waking… 15s → ● running` and a queued `game.send` resolving after wake — the exact first-visitor experience.
**Unblocks:** B25.

#### B25 · Guest split view + late join + Play hierarchy grouping — **G6 · L · deps: B24, B12** ⚠ RISK: two WebGPU/wasm-threads engines in one Electron window is unmeasured, and the client-side guest-wallet path is unbuilt (CSS:176 proves only the headless test path). Timebox the spike; fallback is the labs-flagged copy-URL second window — decide within the first week, don't let this block G7.

**Builds:** second embedded engine iframe with a guest wallet (never two windows on one identity — non-goal 10); "Player 2 joins late" button; Play-hierarchy grouping **"Shared — one real copy"** vs **"Your screen's copy"** driven by NetworkEntity presence over the existing hierarchy-provenance machinery (axis = ownership, not visibility).
**Verify:** the silent-divergence demo — a seeded Spawner copy under "Your screen's copy" on one tile while a `game.spawn` chest sits under "Shared" on both; Player 2 joining mid-round lands fast-forwarded.
**Unblocks:** B26.

### G7 — the sitting

#### B26 · Arena template + rehearsed demo — **G7 · M · deps: B23, B25 (fallback: B23 + external second client)**

**Builds:** Arena template rebuilt on the B23 kit, complete-but-with-one-obvious-hole; the rehearsed script: new project → prefabs → one AI prompt → linted diff → two-player Play with cold start → publish with a secret key → live-tune.
**Verify:** the sitting completes under 45 min, zero terminal, run by someone who didn't build it; re-run quarterly as regression.

---

### Dependency spine (critical path)

```
B1 ─ B3 ─ B4 ─ B5
         │      └───────────────┐
         B6 ─ B7 ─ B8 ─ B16 ─ B24 ─ B25 ─┐
               ├─ B9 ─ B21 ─ B22          B26
               └─ B10 ─ B11 ─ B12 ─┬─ B13 ─ B14
B18 ─┐                             ├─ B15 ─ B17
B19 ─┴─ B20 ──────────────────────►B23 ────┘
```

Parallelizable from day one: B1 (harness), B18/B19 (§9 track). Longest chain: B1→B3→B4→B6→B7→B10→B11→B12→B23→B26. The four risk steps sit at the ends of their sub-chains on purpose — B1 and B4 fail early and cheap; B7's harness scenario exists before B7 does; B25 has a named fallback so G7 never waits on it.
---

---

# Editor Design — how the multiplayer DX looks in Decentraland Studio

## 0. The chrome that already exists (ground truth, `packages/ui/src`)

Everything below is skinned by the shipped design system — new surfaces reuse it, never invent parallel chrome.

**Shell.** Dark editor over the viewport. Panels are `#161518` (`--panel`) cards, radius `--r-panel: 18px` (cards 14px, controls 10px, pills 999px). Hairlines `rgba(255,255,255,0.08)` (`--line`), washes `--fill-1…5` (4–12% white). Type is Inter Variable, 13px base, `--fs-xs .72rem / --fs-sm .82rem / --fs-md .92rem`; mono `--font-mono` for paths, keys, wallets. Every panel title bar is `--head-h: 42px`.

**Color roles (tokens.css, already tokenized):**

| Role | Token | Value | Meaning |
|---|---|---|---|
| Green | `--success` | `#44b600` | the game / server-owned / "for everyone" |
| Blue | `--client-blue` | `#4ea3ff` | this player's screen / client-decided |
| Amber | `--warning` | `hsl(38,90%,55%)` | "true but needs your attention" (autosave dot, code-created marker) |
| Red | `--error` | `#ff2424` | errors only |
| Purple | `--brand` | `#982de2` | primary actions (Publish, Save, Accept) — never a status |

The comment on `--client-blue` says it verbatim: green says the server owns a value, blue says the client decides it; **it is not a status colour**. `ds/Chip.tsx` already exposes tones `server | client | info` (closed set, guarded by `ds-contract.test.ts` R5b) — every green/blue dot and chip below is a `Chip` or the same two tokens, nothing new.

**Existing components to reuse:** `Chip` (tones above, sizes `md`/`xs`), `Select` (compact density, options with `hint` sub-lines), `Segmented`, `Toggle` (has `presentation` mode for menu checkitems — see `MenuToggleItem` in `Toolbar.tsx`), `MenuItem` + `.eui-menu` / `.eui-ctx`, `.eui-menu-note` (inline note inside a menu — the Preview menu already uses it), `Modal`, `ConfirmButton` (two-step destructive), `Pager`/`PanelState`/`useLoad`, `PropRow`/`GroupLabel`/`Shelf`, `TableEditor`, tooltips via `data-tip`. The Worlds **StorageTab** already contains the full `ValueManager` (paginated rows, value inspect/copy/edit modal, two-step deletes, `Segmented` sub-tabs `Data | Players | Env keys`) — the Saved-data drawer tab is this component re-hosted, not a rewrite.

**Where things live today:**
- **Behavior card** = `.eui-script-entry` inside the Script component view (`panels/views/script-view.tsx`): header row with the file name as a button (`Open src/scripts/….ts` tooltip), `</>` IconButton ("Open the editor + AI assistant"), `⋯` overflow (`Rename script / Reload params / Run earlier / Run later / — / Remove script`), then one `.eui-prop` row per param, with `.eui-param-hint` sentence lines under enum rows. Auto-opens on first selection (`auto-expand.ts`).
- **Play** is in the floating **Toolbar** (`panels/Toolbar.tsx`), not the topbar: transport group `▶ / step / ⏸ / ⏹ / mute`, tooltip `Run the scene (⌘P)`.
- **Topbar** (`SceneTopbar.tsx`): `← · scene title · [Code] · [Publish (purple pill, Button variant="primary" .eui-topbar-publish)] · Preview ▾ · terminal icon (toggles LogsDrawer) · ⚙ · account badge`.
- **LogsDrawer** (`features/editor/LogsDrawer.tsx`): bottom-docked, tab row `.eui-logs-tabs` (today: `Build / Server` + `Scene console`), `<pre class="eui-logs-body">`, ✕ to close.
- **Hierarchy** (`HierarchyPanel.tsx`): labelled provenance **shelves** — `In your scene`, `Made by your code` (note under header: *"Your script builds these while the scene runs…"*), `Engine`, `Unknown` — plus inline per-parent buckets `From your code (N)`. Derived entities render italic. This shelf mechanism is exactly what the Play grouping extends.
- **AI diff review** (`script/code-editor.tsx`): a review banner `.eui-studio-review` over the CodeMirror merge view — dot + **"The assistant changed this script."** + sub *"Review before it runs in the scene."* + `Accept all` / `Discard`.
- **Play HUD** relay exists (`desktop/staging/editor-scene/src/play-hud.ts` → `page-ui.ts`): the page draws crosshair + hover prompts during Play — the Game strip and role-prefixed console ride this same channel.

---

## 1. Behavior card — the runs-on line

**Layout.** Inside the existing `.eui-script-entry`, one derived line directly under the script-name header, above the params. Same `--fs-xs` scale as `.eui-param-hint`. Present only when the script uses `game` (derived by the `guarantees.ts`-style scanner — never declared metadata).

```
┌ chest.ts                              </>  ⋯ ┐
│ ● in the game, for everyone: openChest · enter Vault    ● on this player's screen: goal popup
│ Points        [ 10 ]                          │
└──────────────────────────────────────────────┘
```

- Green dot = `--success`, blue dot = `--client-blue`; 6px filled circles, dot + label + verb list per segment. Verb names (`openChest`, `enter Vault`) render in `--font-mono` at the same size, `--ink-7`.
- Exact copy: `● in the game, for everyone: <names>` `● on this player's screen: <names>`. Either half omitted when empty.
- Hover (via `data-tip`): green half — **"This part keeps running even when no one is looking at it."** Blue half — **"This part is instant and private to each player."**
- **The one interaction:** hovering a verb name highlights the matching handler when the Studio is open on that file; otherwise the line is read-only. No chips per param, no badges — one line, per less-is-more.
- DS constraint: this is text + two inline dots, not `Chip`s — chips at `xs` would double the row height and read as controls.

## 2. Play button chevron menu

**Layout.** The toolbar's ▶ button gains a chevron half (same split-button shape as the topbar `Preview ▾`: main hit = play, chevron opens `.eui-menu` anchored below). Menu uses `MenuItem` rows with `--fs-sm` labels and `--fs-xs` `--ink-6` hint lines (the `Select` option-hint pattern); last row is a `MenuToggleItem` with a presentation `Toggle`.

```
▶ Play ▾
├ Play                          ⌘P
├ Play with a second player        Split view; Player 2 joins as a guest
├ Player 2 joins late              Player 2 gets a "Join now" button mid-round
└ ☐ Start like a real visit        The game takes ~15 s to wake, like it will
                                   for your first real visitor
```

Exact strings: `Play` · `Play with a second player` · `Player 2 joins late` · `Start like a real visit`. Hints verbatim as above. The toggle persists per project (`usePersistentFlag`, same as `toolbar-moved`).
**The one interaction:** picking `Play with a second player` splits the viewport into two tiles; the toggle state changes nothing until the next Play (no live restart).

## 3. Play HUD — Game strip + role-prefixed console

**Game strip.** A pill in the Play HUD (top-center, under the topbar, `--z-hud`), drawn by the page like the crosshair/prompts. One glyph + one string, `--fs-sm`:

| State | Glyph color | Exact copy |
|---|---|---|
| running | green `--success` | `● Game running` |
| lagging | amber `--warning` | `◔ Game lagging` |
| waking | amber, animated | `◐ Waking… 12s` (live countdown) |
| asleep | `--ink-45` | `○ Asleep` |
| unreachable | red `--error` | `✕ Can't reach the game server — Logs` |

`Logs` in the last state is an inline link that opens the LogsDrawer on the **Game** tab. This is the one surface where "server" is honest and allowed. A crashed green handler shows here as a `[game]` error card (script name + line), visually distinct from `○ Asleep`.
**The one interaction:** while `◐ Waking…`, clicks that `game.send` show a small queued spinner beside the strip instead of timing out.

**Role-prefixed console** (LogsDrawer › Game tab, and mirrored in the Play HUD's transient toasts). Every line gets a colored prefix tag — green `[game]`, blue `[you]` / `[player 2]` — mono, then the line in `--ink-85`:

```
[game]      round 2 started — 3 players
[you]       chest clicked, asking the game…
[player 2]  goal popup shown
```

Doubling from a legacy both-sides script becomes self-explanatory: the same line appears once green, once blue.

## 4. Spawner — "Who sees the copies?"

**Layout.** One `.eui-prop` row in the Spawner card, exactly the shape of the shipped `when`/`where` enums: `Select compact` on the right, one `.eui-param-hint` consequence sentence underneath (the `spawner-words.ts` mechanism — labels/hints are display-only words over a stored wire value).

```
Who sees the copies?   [ Only the player who triggers it ▾ ]
  Each player gets their own copies. Nothing is shared, nothing is saved.
```

Switched to **Everyone**:

```
Who sees the copies?   [ Everyone ▾ ]
  The game creates one copy and every player sees the same one.
  Works for one thing at a time, not swarms.
```

- Option labels: `Only the player who triggers it` · `Everyone`.
- `Everyone` is disabled (with its hint as the disabled reason) when `when = when clicked` — offered only for walk-in and timer triggers.
- No color on the row itself; the consequence line stays `--ink-6` like every param hint. The dropdown is the choice; the sentence is the teaching.
- **The one interaction:** flipping the enum edits the pool-open argument `'seeded'`→`'server'` inside the spawner script (authority is a pool argument, never metadata) — and the prefab's chip in the hierarchy/panel flips between the existing `client`/`server` chip tones.

## 5. Hierarchy in Play — ownership grouping

**Layout.** Reuses the labelled **Shelf** exactly as `Made by your code` does today (header + count + note + rows; derived labels italic). During Play, runtime entities group by NetworkEntity presence:

```
▾ Shared — one real copy (2)
    gold-pile — east-gold
    Door — Vault
▾ Your screen's copy (21)
    rock (×20)          ⟵ seeded layout clones, italic
    goal popup
```

On the second player's tile the second shelf reads `Player 2's copy`. Shelf headers carry a small dot in the group color — green for `Shared — one real copy`, blue for the screen shelves — the only place the hierarchy uses the pair.

- Header notes (hover on shelf title): shared — *"One real copy in the game. Every player sees this same one."* screen — *"This screen built its own copy. Other players have their own — same layout, different object."*
- Deliberate axis: **ownership, not visibility** — seeded rocks look identical everywhere yet sit under `Your screen's copy`; never label them "only you see".
- **The one interaction (the silent-divergence demo):** in split view, a seeded Spawner crate appears under `Your screen's copy` on one tile only, while a `game.spawn` chest sits under `Shared — one real copy` on both.

## 6. LogsDrawer — Build | Game | Saved data | Secrets

**Layout.** Same bottom drawer, tab row grows from two to four buttons (`.eui-logs-tabs`, active = `.on`): `Build` · `Game` · `Saved data` · `Secrets` · spacer · ✕. (`Build` absorbs today's `Build / Server`; `Game` is today's `Scene console` with role prefixes, §3.)

**Saved data tab** — the Worlds `ValueManager` re-hosted (rows, Pager, value-edit `Modal`, `ConfirmButton` deletes), with a `Segmented` sub-tab `World | Per-player` (same group names as `game.saved` / `game.playerData` chips). Header line above the table, `--fs-xs --ink-6`:

> **Test data — lives on this computer. Your published world keeps its own; manage it from the world's Storage tab after publishing.**

Sample rows (key mono, value hint truncated, per-row `Reset` as two-step ConfirmButton):

```
highScores        [ {"ana":120,"bo":95} ]           Reset
doorOpenCount     [ 41 ]                            Reset
─ Per-player › 0x3f9a…c21e ─
coins             [ 5 ]                             Reset
```

Footer: `Clear all saved data` — two-step (`ConfirmButton`: first click arms, second confirms). Hard rule from the plan: env keys live in the same `server-storage.json`, so this view **excludes env keys** and Clear-all never touches secrets.

**Secrets tab** — names only, values masked, no reveal affordance anywhere:

```
WEATHER_API_KEY   ••••••••    used by weather-board.ts    Replace…   Delete
```

Empty state: *"No secret keys yet. Scripts ask for one with game.secret('NAME') — you'll be asked for the value when you publish."* `Replace…` opens the value `Modal` with an empty field (never pre-filled). The masked dots are literal — the UI has no unmask state, matching the write-only production promise.

## 7. Publish flow — "Secret keys" step

**Layout.** Inside `PublishModal`, between world pick and `Building your scene`, shown **only** when the scanner finds `game.secret()` calls. Uses the existing `.eui-publish-steps` list chrome (✓ / spinner / ·) once running; before that, a form card per key:

```
Secret keys
Your scene's game needs these to run.

WEATHER_API_KEY                    [ value…          ]
used by weather-board.ts to fetch forecasts

Stored on the game server only. You can replace a key later,
but never read it back.

              [ Cancel ]   [ Save keys & publish ]
```

- Per-key **provenance line** derived from the call site: `used by <script>.ts to <doc-comment gist>` — an unexplained key is un-fillable by design.
- The consequence line is verbatim and sits once under the list, `--ink-6`.
- Keys already stored show as masked rows with `Replace…` instead of an input; the step auto-passes when all keys exist.
- Publish checklist also gains the cold-start line: *"Your first visitor wakes the game (~15 s). Test with 'Start like a real visit' first."*
- **The one interaction:** typing a value and continuing writes via the preview storage endpoint; the value never renders again (field clears to `••••••••`).

## 8. Entity param row — four states

The row is the standard `.eui-prop` (label left, control right); today's `EntityPicker` is a name dropdown with a raw `#517 · unnamed` fallback — that fallback is what the tombstone replaces. Copy per state (Door example, plan §9):

**1 — Unset:**
```
Door        none · [ Pick ]
  This zone won't open anything until you pick a door.
```
Hint in `.eui-param-hint`; `Pick` is a small `eui-btn`.

**2 — Pick mode (after clicking Pick):**
```
Door        Click the door in the scene or the list — Esc cancels
```
Row highlights with `--primary-selected` wash; viewport cursor becomes a picker (reuses the selection raycast); hierarchy rows glow on hover. Esc or outside click cancels.

**3 — Filled:**
```
Door        Lobby Door                            ⋯
```
Value is the entity's name (stored: composite entity id, never the name). **Hovering the row flashes the target** in the viewport — that's the whole trust story. Overflow: `Pick another / Clear`.

**4 — Tombstone (target deleted or stale id on scene open):**
```
Door        ⚠ was "Lobby Door" — gone · [ Pick new ]
```
Amber `--warning` glyph and text; the script no-ops at runtime and logs one sentence. Paired delete guard (dialog, uses the standard `Modal` + danger `Button`): **"2 behaviors point at this door (Trigger Zone, Wall Button). Delete anyway? They'll do nothing until you point them somewhere else."** Same guard covers ungroup/dissolve (⇧⌘G). Duplicate note (toast, quiet): *"Still points at the original Lobby Door."*

DS constraint found: the tombstone's `was "Lobby Door"` label needs the `mergeLayout` advisory-field fix (`parser.ts:400-404` drops extra fields on re-parse) — the mockup depends on it.

## 9. AI diff review — the green stripe

**Layout.** In the Studio's merge view (`.eui-studio-review` banner already: `● The assistant changed this script. Review before it runs in the scene. [Accept all] [Discard]`). Hunks whose added lines contain green calls (`onMessage` / `setState` / `spawn` / `saved` / `onEnterZone` …) get:

- a 3px **left stripe** in `--success` down the hunk gutter,
- a hunk-corner tag, green text `--fs-xs`: **`runs in the game, for everyone`**,
- exclusion from **Accept all** — the button relabels **`Accept all (2 need review)`** and green hunks keep individual `Accept` buttons.

Lint blockers in the diff disable Accept entirely; the banner's right side swaps to the standing **"Fix these"** prefill button (wired to the assistant, same as scene-check blockers). Blue-only hunks get no decoration — the stripe is rare on purpose; a review surface where everything glows teaches nothing.

**The one interaction:** clicking the green tag on a hunk opens the same hover copy as the runs-on line ("This part keeps running even when no one is looking at it."), tying the diff, the card, and the console tags into one color language.

---

## Cross-cutting rules for the artifact mockups

- One vocabulary, everywhere: "the game", "on this player's screen", "everyone sees", "ask the game", `[game]`/`[you]`, "saved", "secret keys". Never: server (except the Game strip's `✕` state and the template card), client, synced, RPC, broadcast, Storage, EnvVar, isServer.
- Green/blue appear only as the pair (dots, tags, stripes, shelf dots, chip tones `server`/`client`); amber only for tombstones/waking/attention; purple only on primary buttons.
- Everything new is composed from: `Chip`, `Select`+hints, `.eui-param-hint`, `Segmented`, `MenuItem`+`.eui-menu-note`, `MenuToggleItem`+`Toggle presentation`, `Shelf` headers with notes, `ConfirmButton`, `Modal`, `ValueManager`, `.eui-publish-steps`, `.eui-logs-tabs`, `.eui-studio-review`, `data-tip` tooltips. Zero new primitives; one-component-per-role stays intact.