# Client/Server Entity Spawning in `@dcl/sdk@auth-server` Scenes — Final Research Report

Sources: authoritative-server & multiplayer-sync skill docs (`agent/skills/…`), dcl-editor project docs (`docs/MULTIPLAYER-PLAN.md`, `docs/PREFABS.md`), prefab runtime code (`packages/desktop/prefabs/`, `packages/desktop/runtime-modules/`), the actual auth-server SDK source (`@dcl/sdk` 7.24.4-…commit-697ce9e under `towerofmadness/node_modules/@dcl/sdk`, aka `SDK/`), and the bevy-explorer engine (`/Users/boedo/Documents/Decentraland/bevy-explorer`). Where docs and engine/SDK code disagree, **code wins**; each such conflict is called out inline. Note: the dcl-editor repo root pins a non-auth build (`7.22.6`, no `registerMessages`) — never use it as a reference for this feature.

---

## 1. Execution model

**One bundle, two roles.** The identical scene bundle runs on every client and on a headless "Multiplayer Server": no rendering, no Node APIs, no avatar colliders (`SKILL.md:18,141`). Two distinct server runtimes exist — a deployed scene runs on **hammurabi-headless, a QuickJS sandbox** (`SKILL.md`, Testing section); the **bevy-explorer headless server is Deno/V8** (one OS thread + one V8 isolate per scene, `crates/dcl_deno_ipc/src/lib.rs:75-158`) and is the local test double, with a different JS-feature surface. The only fork is `isServer()` from `@dcl/sdk/network` (`SDK/src/network/index.ts:8-17`). Enabled by `"authoritativeMultiplayer": true` in `scene.json`, auto-written by the auth-server sdk-commands on every build — never edit it manually (`SKILL.md:14`).

Three timing traps, all confirmed in code:

- **`isServer()` is false during module load** — the platform resolves the role async, so which half of a transport installs must be decided lazily on first `start()`/`update()` call (`runtime-modules/outcomes.ts:37-42`). In bevy the op must be *synchronous* (`#[op2(fast)] op_is_server`, `crates/dcl/src/js/engine.rs:28-29`) — an async op returns a Promise and `!!Promise === true` would make every **client** run its server branch (`HEADLESS_TOWEROFMADNESS_TEST.md:63,189`).
- **The engine seals after module load**: `registerMessages()` / `defineComponent()` must run via static import at module scope (`SKILL.md:51`; `rpc.ts:10-12`). Combined with the previous point: register schemas at module scope, install role-specific handlers lazily.
- **`MessageBus` is client-only** — the headless server lacks `EngineApi.subscribe('comms')`; constructing it at module scope crashes the server branch with `RemoteError: not implemented` (`SKILL.md:62`).

**Authority model.** The server is the single write authority for synced state. Every client CRDT write is relayed to the server, which dry-runs the update and calls `validateBeforeChange({entity, currentValue, newValue, senderAddress, createdBy})`; accepted writes rebroadcast to all, rejected writes trigger a **targeted `CRDT_AUTHORITATIVE` correction** that force-resets the sender's local state (`SDK/src/network/server/index.ts:108-211`; client applies it at `message-bus-sync.ts:167-184`). Server's own writes bypass validation (`senderAddress === AUTH_SERVER_PEER_ID`, the literal LiveKit identity `"authoritative-server"`, `message-bus-sync.ts:19`). That identity is the trust anchor end to end: bevy clients accept non-player packets **only** from `"authoritative-server"` (`crates/comms/src/global_crdt.rs:752-774`), and the token is minted by comms-gatekeeper's `get-server-scene-adapter` (`crates/comms/src/lib.rs:52-60`).

**Engine's role is transport only.** CRDT reconciliation is entirely in the JS SDK; the engine relays opaque `sendBinary` bytes inside rfc4 `Scene{scene_id, data}` packets over LiveKit data channels (`crates/restricted_actions/src/lib.rs:1479-1515`; `HEADLESS_TOWEROFMADNESS_TEST.md:35`). The server needs no render/physics fidelity for sync to work.

**Lifecycle & limits.** Server alive only while players are present; ~2 min linger after the last leave; ~15 s production cold start (instant in preview — why cold-start bugs escape) (`SKILL.md:120`). Isolate limits (hammurabi-headless, limits-lab scene): 256 MB memory, 10 s sync turn, 40 in-flight host calls, 512 outbound sends/tick, 300 inbound msgs/s/peer (excess **dropped, not queued**), 30,000-byte scene→comms message, 128 KB packet, 100k live entities (`server-patterns.md:257-289`). Client+server deploy paired by hash; existing players keep the old version until rejoin (`SKILL.md:130`).

**Server blind spots** (bevy headless, confirmed): no self position broadcast (`broadcast_position.rs:80-84`), foreign-player bevy Transforms left at origin (`global_crdt.rs:459`) so engine-RPC positions are wrong server-side — server-side position checks must use SDK-synced `PlayerIdentityData` + `Transform` in scene-local metres (`SKILL.md:32,72-74`); trigger zones **never fire on the server** (no avatar colliders, `docs/PREFABS.md:675-677`). `playerPositions()` returns `[]` there (`playerPositions.ts:16-18`).

---

## 2. Pattern A: server-authoritative spawning

*Player enters zone → server spawns an entity everyone sees.*

**Recipe.** Because zones only fire client-side, the flow is: client detects entry locally → sends an *action* (not a result) to the server → server re-verifies position → server spawns and syncs.

```ts
// client: zone fired locally — ask, don't tell
const ok = await rpc.call('zone.enter', { zone: 'Vault' })

// server: rpc.handle('zone.enter', (body, from) => {...})
// - identity from context.from, NEVER the payload (zone-authority.ts:6-7)
// - position re-derived from server-received avatar transforms, geometry
//   checked with ~1m slack (positions arrive ~10 Hz), 4 Hz sweep,
//   10 s grace for late joiners whose position hasn't landed
//   (zone-authority.ts:27-31,102-149)

if (isServer()) {
  const e = engine.addEntity()
  Transform.create(e, {...}); GltfContainer.create(e, {...})
  syncEntity(e, [Transform.componentId, GltfContainer.componentId]) // OMIT the id for dynamic entities
  protectSynced(e, synced, () => false) // refuse all client writes
}
```

**Rules (all code-backed):**

- **Only the server calls `syncEntity` in an auth scene** — client calls error (`SKILL.md:39`). Explicit enum sync IDs only for fixed singletons (pins `networkId=0, entityId=id`, `entities.ts:40-49`); dynamic/per-player entities **omit the id** (auto id = creator networkId + local entity number, collision-free). Never hash a player address into an id — ~50% collision by ~370 players in a 100k range, throws `syncEntity failed because the id provided is already in use` (`server-patterns.md:150-199`).
- **`syncEntity` alone is last-write-wins** — any client could write back. Always pair with a validator. The repo's `protectedSync()` fuses create + sync + `validateBeforeChange` "so there is no entity that is synced but unguarded for a frame" (`protectedSync.ts:62-76`); `protectSynced()` is the guard-only half for pool clones (`protectedSync.ts:87-116`).
- **What syncs:** exactly the listed componentIds, whole-component per change. A denylist never syncs (TweenState, RaycastResult, UI, PointerEventsResult, TriggerAreaResult, `asset-packs::Script`, …, `SDK/src/network/state.ts:33-57`); reserved entities <512 are filtered (`filter.ts:27-29`). Parenting must use `parentEntity(child, parent)` / `NetworkParent`, never `Transform.parent` (`entities.ts:102-126`).
- **How it materializes on clients:** local `PUT_COMPONENT` is rewritten to `PUT_COMPONENT_NETWORK {entityId, networkId, timestamp, data}`, batched, chunked at 12 KB, sent via `sendBinary` (`server/utils.ts:152-177`, `chunking.ts:8`); receivers map network id → local entity, **creating the entity on demand** (`findOrCreateNetworkEntity`, `server/index.ts:61-83`).
- **Late joiners:** on room connect the client emits `REQ_CRDT_STATE`, retrying every 2 s; the server dumps its **entire** synced state (`engineToCrdt`, `state.ts:72-135`) as 12 KB chunks in `RES_CRDT_STATE` targeted at the requester only (`message-bus-sync.ts:117-147,221-254`). Late joiners get current state, never event replay. Gate reads/sends on `isStateSyncronized()` (SDK typo) — but it is doubly unreliable: it flips true on the **first** `RES_CRDT_STATE` chunk received (`message-bus-sync.ts:126-147`), so with a multi-chunk snapshot a client can read "synchronized" while later chunks are still in flight; and even a complete snapshot may be a **stale replay from a dead server run**. Liveness requires a heartbeat: server writes `Date.now()` (`Schemas.Int64`) into a synced field every ~2 s, client judges by *observed change time*, never the value (`SKILL.md:122-126`; the repo's `serverLife.ts` five-state ladder implements this).
- **Idempotency — two players trigger the zone simultaneously → double spawn.** `zone-authority.ts`'s `admit()` only verifies membership; the spawn decision is consumer code, and the rpc server dispatch runs handlers as *detached async* (`void (async () => …)()`, `rpc.ts`), so a handler that awaits anything (Storage, another rpc) interleaves with the next request — check-then-act races exist even on a single-threaded server. Flip the "already spawned" flag in server state **before the first await**, and key spawn handlers idempotently (by zone or instanceId).
- **Per-player cleanup:** nothing removes a per-player synced entity when its player leaves — a long-running server accumulates orphans that every late joiner then receives in the CRDT snapshot. Wire `players.onLeaveScene(...)` (the SDK hook exists, `message-bus-sync.ts:256-258`) to release that player's entities; for `'server'` pool clones whose triggering player disconnects mid-spawn, someone must explicitly decide to release the parked clone.
- **Restart hygiene:** the CRDT snapshot persists across server restarts — restart code must re-adopt existing entities via `engine.getEntitiesWith(Comp)` scans, skipping reserved entities (`server-patterns.md:148-199`). Never removeEntity+recreate the same fixed sync id in one frame (`NetworkEntity` survives until CRDT flush — defer a tick, `networking-patterns.md:260-271`).
- **Production shape in the repo:** `pool(prefab, 'server')` — server acquires from a pool, syncs the `runtime::SpawnedFrom` marker + all authored components, arms refusing validators (`spawner.ts:411-423`); clients run `watchServerClones`, a system that adopts server-created entities into the local pool (starting their scripts locally) and releases removed ones (`spawner.ts:793-812`). Release **parks/reuses** entities (sync id must stay stable) and blanks `GltfContainer.src` so colliders reload (`spawner.ts:567-585`). **v1 limit: single-entity prefabs only** — a clone's `Transform.parent` is meaningless on a client (`spawner.ts:347-349`).

**When to use:** shared, contested, low-cardinality state everyone must agree on — pickups, doors, game-state singletons, scoreboard carriers, anything a late joiner must see exactly as it stands. Not for per-frame-moving swarms (see §6).

---

## 3. Pattern B: seeded deterministic client spawning

*Lobby start → seed broadcast → each client spawns identical local entities; no transform sync.*

The skills docs don't document this pattern at all (Source 1 confirmed by grep); it comes from the repo's kit (lifted from DCL-Hazards-POC: "reconstruct from seed, never stream layout state", `MULTIPLAYER-PLAN.md:225`) and MagmaDash. Client-local entities cost **zero comms** — the engine CRDT is per-client local (bevy confirmation, Source 5).

**Recipe.**

```ts
// server: publish the tuple as SYNCED STATE, not a message
protectedSync({ entity: stateEntity, syncId: SYNC_ID,           // round-loop.ts:231-238; sync id 3101
  components: [RoundPhase], validate: () => false })
// the component is created with schema DEFAULTS (the all-zero placeholder
// clients must guard against, see pitfalls) — the tuple is written afterwards:
const t = RoundPhase.getMutable(stateEntity)
t.seed = Math.floor(Math.random() * 0x7fffffff)                  // round-loop.ts:160-162; seed: Schemas.Int64
t.phase = 'running'; t.phaseStartMs = getServerTime(); t.configVersion = 1

// every client (incl. late joiners, via CRDT snapshot):
const rng = createRng(tuple.seed)                  // mulberry32, pure/rng.ts:7-16
for (let i = 0; i < COUNT; i++) {
  const p = { x: rng() * 14 + 1, y: 0, z: rng() * 14 + 1 } // fixed draw order!
  const e = engine.addEntity()                     // plain local entity — NO syncEntity
  Transform.create(e, { position: p }); GltfContainer.create(e, {...})
}
```

**Seed distribution — synced component wins over message.** MagmaDash broadcasts `room.send('roundGo', {seed, …})` and then needs a `requestGameState` re-broadcast handler plus an unconditional 5 s client retry loop to cover late joiners, because room messages are ephemeral (`DCL-MagmaDash/src/server/server.ts:143,171,398-470`; `client/multiplayer.ts:89-113,253-264`). The repo's Round Loop instead puts the tuple in a server-protected synced component mirrored to `globalThis.__dclRoundTuple_v1` (`round-loop.ts:107-121`) — late joiners get it from the `RES_CRDT_STATE` snapshot automatically, no protocol needed. Use the synced component; the message form is a workaround, not a design.

**Late joiners fast-forward by arithmetic**, not replay: nothing is a timer — all deadlines are `deadline - getServerTime()` computed locally off the tuple, so a mid-wave joiner lands on the same phase as everyone else (`round-loop.ts:5-9`). `getServerTime()` comes from `timeSync.ts` — NTP-style: 5 probes at 0.15 s, replies targeted `{to:[context.from]}`, sort by RTT, drop best/worst, average offsets, resync every 60 s (`timeSync.ts:14-57`, `pure/time-math.ts:9-23`). Planned pools force-init it — without a shared clock "a planned pool would spawn on local wall time" (`spawner.ts:705-708`).

**Pitfalls (each one bitten in practice):**

- **PRNG:** must be a seedable deterministic generator — mulberry32 in the kit (`pure/rng.ts:7-16`). `Math.random()` is only used server-side to *draw* the seed.
- **Draw-order contract** (`runtime-modules/rng.ts:8-33`): one stream per (seed, purpose) — derive a second stream with an xor constant (`createRng(seed ^ 0x9e3779b9)`); draw count must depend only on shared values — **never player count, local time, or frame rate**; draw before you branch; iterate in index order; changes are append-only and bump `configVersion` so mismatched peers detect divergence. `seededSequence(seed, count, draw)` is the canonical shape (`rng.ts:43-49`). A spawn count must never depend on the roster, which differs per client.
- **Drift / re-timing:** a tuple change with the same identity but a moved `phaseStartMs` must re-time the plan without releasing clones (`wave-director.ts:320-342`); config is pinned once per phase (`wave-director.ts:344-357`). RoundLoop suppresses sub-boundary `phaseStartMs` rebases under 1 s so a held lobby doesn't spam the wire (`round-loop.ts:305-316`). Guard against the all-zero first-sync placeholder tuple (`phaseStartMs === 0`, `round-loop.ts:352-360`).
- **BigInt trap:** `Schemas.Int64` values may arrive as BigInt depending on SDK build — always `Number()` them or arithmetic throws and silently kills the handler (`timeSync.ts:80-82`).
- **Rejoin resurrection:** a kill outcome that arrives *before* its spawn must **cancel** the spawn, and catch-up must drain all entries with `atMs <= now` immediately — otherwise rejoiners materialize zombies everyone else already killed (`pure/spawnPlan.ts:12-17`; `spawner.ts:717-721`).

**When to use:** many-entity layouts, waves, scatter, obstacles, decoration — anything derivable from small shared state where per-entity agreement isn't contested. The shipped Spawner prefab (0.3.0) is the fully-local extreme: trigger fires on this player's game, copy built from the `'seeded'` pool, deterministic scatter, "nothing crosses the wire, nothing is stored between plays" — deliberately rebuilt from the 0.2.x server-decided design whose persisted alive-set resurrected copies on every preview boot (`MULTIPLAYER-PLAN.md:119`).

---

## 4. Pattern C: hybrid — server owns state + seed, clients own visuals, server validates outcomes

Fully supported by the sources; this is the kit's `'planned'` pool mode and its most load-bearing pattern.

- **Server owns:** the tuple (seed/phase/clock), an HP/score ledger, and validators. It **never materialises planned clones** (`spawner.ts:722`).
- **Clients own:** the plan — a **pure function of the tuple** (`buildWavePlan(tuple, config, createRng)`, `wave-director.ts:245,332`) — plus all positions and simulation. Instance ids are derived, not allocated: `planInstanceId(phase, index)` yields identical ids on every client *and* the server without any allocation message (`pure/spawnPlan.ts:2-17,39`). A wave costs zero spawn messages (`wave-director.ts:6-8`).
- **Outcomes close the loop:** `plan(prefab, planFn, { outcomes: ['hit','died'] })` — the `outcomes` declaration is **mandatory**, throwing without it: "client-local spawns are only trustworthy where the server validates the results" (`spawner.ts:298-303`). Client `report(kind, {instanceId, amount})` → rpc → server validator (e.g. rate-limit hits at `(1000/fireRate)*0.6` slack, clamp damage from phase-pinned config, `wave-director.ts:183-199`) → accepted entries appended to a **server-sequenced log**, broadcast in ≤48-entry chunks (under the 13 KB drop threshold), applied by clients strictly in seq order, gaps repaired via paged rpc `outcomes.since`, `snapshot()/fastForward()` for rejoin (`outcomes.ts:46-52,228-300`). Server's own reports carry `from:'server'` — a value no wallet can take (`outcomes.ts:201`).
- **Honesty ceiling, stated in code:** with planned pools there is no canonical position, so proximity/hit validation is impossible *in principle* — never claim more than "damage server-tracked, hits client-reported" (`outcomes.ts:20-27`; `MULTIPLAYER-PLAN.md:215,234`). Secrets like the *next* phase's seed live in `serverState()` (server-private Storage wrapper; every method throws on a client, `serverState.ts:11-14,82-86`).

**When to use:** combat waves, hazards, anything with many moving entities where gameplay results still need authority. This is the default architecture for "action game" prefabs.

---

## 5. `room.send` / `room.onMessage` — the contract

Ground truth is SDK source (`SDK/src/network/events/implementation.ts`) and bevy engine code; docs are corrected below where they disagree or were silent.

| Aspect | Client `send` | Server `send` |
|---|---|---|
| Audience | **Server only.** Engine force-routes to `AuthServer` (`restricted_actions/lib.rs:1490-1497`); on LiveKit that becomes `destination_identities = ["authoritative-server"]`, so other clients **never receive** the packet (SFU-enforced, `livekit/room/plugin.rs:340-348`). The SDK's receive-side `sender !== AUTH_SERVER_PEER_ID` filter (`implementation.ts:65-68`) is a second defense layer — it is the *only* mechanism on ws-room, which broadcasts everything. Client→client via room **does not exist**. | Broadcast to all clients, or targeted. |
| `{to}` | **Silently ignored** (`implementation.ts:127`). Docs were silent; SDK code decides. | `{to: [walletAddress]}` → LiveKit `destination_identities` (`livekit/room/plugin.rs:340-348`). |
| `{to}` enforceable? | n/a | **Yes on LiveKit** — SFU-enforced, non-targets never receive the packet (can't snoop rpc replies). **No on ws-room** — that transport ignores recipient and broadcasts everything (`websocket_room.rs:274-287`); there targeting is only the SDK's receive-side filter. Auth-scene rooms are gatekeeper-minted LiveKit, so enforced in practice. |
| Self-delivery | **Never.** Incoming = peer data only; no loopback (`message-bus-sync.ts:94-96`; LiveKit `publish_data` has no loopback; bevy feeds the bus solely from network updates, `global_crdt.rs:601-608,752-777`). | Never. |
| `onMessage` context | Client handler: `context` is `undefined` (`implementation.ts:14-15,62-68`). | Server handler: `context.from` = sender wallet, transport-verified from the comms envelope — never trust payload identity; compare lowercased (`SKILL.md:26,33`). |
| Reliability/ordering | **Docs say "fire-and-forget, unreliable" — engine code wins: transport is reliable + ordered per publisher** (`NetworkMessage::targetted_reliable`, `restricted_actions/lib.rs:1510-1512`; `DataPacket { reliable: true }`, `livekit/room/plugin.rs:350-356`). BUT end-to-end delivery is still not guaranteed: server-side rate limiter drops frames >300/peer/s, >13 KB silently dropped, and a sleeping/cold server hears nothing. `Room.send` itself **fails silently** — its body is wrapped in try/catch and only `console.error`s, and pre-ready sends merely queue (`implementation.ts`); the kit's try/catch at `rpc.ts:94-98` is defensive, not evidence of a throwing contract. Silent failure is worse than throwing: no error path ever tells the caller a send was lost. Observed in production: "one dropped broadcast used to mean one client with a permanently wrong alive-set" (`outcomes.ts:30-31`). Treat as *usually-delivered, never-guaranteed*; keep the rpc/ledger compensations. | Same channel, same caveats. |
| Size limits | ~13 KB → **silently dropped** (`SKILL.md:60`); `CUSTOM_EVENT` payloads are **not chunked** (chunking is CRDT-only at 12 KB, `server/index.ts:24`); hard caps 30,000 B/message, 128 KB/packet (`server-patterns.md:269-278`). Bevy has no engine-side cap (and, noted as a DoS gap, no per-peer inbound rate limit — `HEADLESS_SECURITY_ISOLATION.md:170-171`), but hammurabi's production caps are the budget. | 512 outbound sends/tick, dropped beyond. |
| Ephemerality | **Messages are events, not state.** Engine buffers nothing; packets with no subscriber are dropped (`global_crdt.rs:903-920`). Late joiners never see past messages — durable facts go in synced components or Storage ("state snapshots, not events — anything event-shaped dies with server sleep", `MULTIPLAYER-PLAN.md:16`). | Same. |
| Readiness | Sends before the room is ready are **queued locally** and flushed on ready (`implementation.ts:105-117,80-95`). Client-ready = connected **and** CRDT snapshot applied (`message-bus-sync.ts:140-147`); server-ready = immediately on connect. **But `room.isReady()`/`isStateSyncronized()` are unreliable across SDK builds** — MagmaDash and Hazards-POC both fell back to unconditional periodic retry / "first server message = connected"; `serverLife` codifies that ladder (`MULTIPLAYER-PLAN.md:232`; `timeSync.ts:94-95` uses no gate at all — send-and-retry *is* the handshake). |
| Registration | `registerMessages({ name: Schemas.Map({...}) })` at module scope, static import only (engine seals; dynamic import throws `Engine is already sealed`) (`implementation.ts:245-253`; `SKILL.md:51`). Payloads must be `Schemas.Map` (plain objects fail binary serialization); `Schemas.Boolean` not `.Bool`; `Schemas.Int64` for timestamps (`.Number` corrupts 13+ digits) (`SKILL.md:49,64-70`). Envelope: `CommsMessage.CUSTOM_EVENT` (type 6), unknown eventType throws at encode/decode (`protocol.ts:36-38,69-71`). |

**Request/response layer:** the kit's `createRpc(namespace)` adds requestId correlation (`PendingMap`), 4 s timeout, 2 retries, and replies always targeted `{to:[context.from]}` — "never broadcast-then-filter"; the server **always** responds, since a silent server wedges the caller (`rpc.ts:6-19,71-73,86-100`).

---

## 6. Performance guidance

**Why synced transforms are expensive** (all code-backed, Source 6):

- Every component change re-sends the **whole component** — no field deltas (`SKILL.md:116`). One Transform put = 44-byte value + CRDT header + network ids + comms envelope + rfc4 protobuf, on the **reliable** channel.
- Every client write makes **two hops** (client→server, server→broadcast to N), and per message the server does a linear scan of all network entities to resolve the id mapping (`findExistingNetworkEntity`, `server/index.ts:50-59`) plus a dry-run CRDT + validator call (`server/index.ts:118-133`) — O(entities × messages) against a 300 msgs/s/peer, 512 sends/tick budget.
- Batches chunk at 12 KB; an oversized message is skipped with only a local `console.error` — the drop is silent to the remote side (`server/index.ts:150-155`).
- Contrast: avatar movement, the one thing that *is* streamed, gets a dedicated **unreliable**, compressed path at 10 Hz dynamic / 1 Hz keepalive (`broadcast_position.rs:30-31,118-120,186`) that scene CRDT does not get. Server-side position knowledge is therefore ~10 Hz — hence the 1 m slack in zone verification (`trigger-zone-server.ts:18`).

**Budgets to design against:** 13 KB message drop; 30 KB comms cap; 300 msgs/s/peer inbound (dropped); 512 sends/tick; 40 in-flight host calls (`Storage.set` returns `Promise<false>` silently on breach — check it, checkpoint-only writes, `SKILL.md:85`); 256 MB isolate (breach kills the server for everyone).

**bevy-explorer headless evidence:** server binary runs the towerofmadness bundle at target 30 Hz, measured ~27 Hz (gate ≥29 median / ≥25 p5, `HEADLESS_PLAN.md:109`); target density 15 scenes/engine, per-scene fixed cost 8 MiB thread stack + uncapped V8 heap (one leaky scene OOMs all co-tenants, `HEADLESS_PLAN.md:99,148`); **~401 foreign-player lifetime cap per engine** (`FOREIGN_PLAYER_RANGE = 6..=406`, slots never freed, `global_crdt.rs:46`); 10 s stale-player despawn; benchmark tier loads 10 Hz messagebus + 10 Hz position per peer; towerofmadness's 1500-char `podiumDebug` bursts are flagged as an outbound stress point (`TOWEROFMADNESS:194`).

**The resulting authority spectrum** (`MULTIPLAYER-PLAN.md:129`): synced components only for shared **low-cardinality** state (phase tuple, scoreboard — LevelSlots syncs only `{round, picks[]}`, `level-slots.ts:1-8`); per-player state = RPC + `Storage.player`; many-entity layouts = seed + local reconstruction. For derivable state, broadcast rarely and compute locally between (`SKILL.md:116`). Split fast-changing from slow-changing components (heartbeat separate from board).

---

## 7. Recommendations for Studio prefabs

**The existing runtime is already the right shape — harden, don't redesign.** The carried-module architecture (masters in `packages/desktop/runtime-modules/`, byte-identical copies per prefab, `globalThis.__dcl*_v1` registries probed by shape, `MULTIPLAYER-PLAN.md:51`) plus the layered stack — `rpc` (correlated request/response) → `timeSync` (shared clock) → `serverLife` (liveness ladder) → `protectedSync` (create+sync+guard fused) → `outcomes` (sequenced ledger) → `spawner` (four authority modes) — matches everything the SDK and engine code demand. Specific evolutions:

1. **A "spawner" prefab should default to client-local (`'seeded'`), escalate deliberately.** The 0.3.0 decision stands and the engine evidence supports it: client-local spawns cost zero comms. The prefab's inspector should expose authority as the pool-open argument it already is (`PREFABS.md:78`), with the ladder: `seeded` (decoration/loot visuals) → `planned` + mandatory outcomes (gameplay waves) → `server` (contested singletons). Keep the mixed-pool-authority throw (`spawner.ts:337-340`) as the guard rail.
2. **Seed always rides synced state, never a message.** Fold the RoundPhase tuple pattern (`{seed, phase, phaseStartMs, configVersion}`, pinned sync id, protectedSync, globalThis mirror) into the default spawner path rather than requiring the (currently shelved) Round Loop prefab; MagmaDash's request/rebroadcast dance is the anti-pattern to avoid.
3. **Never trust readiness signals alone.** All prefab networking should keep the send-and-retry handshake (`timeSync.ts:94-95`) and gate UX on `serverLifeState()`, never `isStateSyncronized()` (`serverLife.ts:12-14`) — the SDK's `isReady()` unreliability across pins is a live hazard (`MULTIPLAYER-PLAN.md:232`).
4. **Treat the transport as reliable-but-droppable.** Since LiveKit delivery is reliable/ordered but rate-limits and size caps drop silently, keep the seq+gap-repair ledger as the only correctness mechanism for event streams, and keep every payload under 13 KB with paging (48-entry chunks) as the template.
5. **Honesty in copy.** Prefab descriptions must respect the ceiling the code states: "server-tracked, client-reported" for planned-pool outcomes; no "cheat-proof" claims (`outcomes.ts:20-27`, `MULTIPLAYER-PLAN.md:215`).

**Open questions** (unresolved in all sources):

- **Server-agreed spawns** (contested pickup every player must see, spawned in response to gameplay) — named as a future authoritative pattern, no design yet (`MULTIPLAYER-PLAN.md:119`). Likely shape: `'server'` pool + zone-authority verification, but the single-entity v1 limit bites first.
- **Multi-entity `'server'` pools** — v1 rejects them (`spawner.ts:347-349`); lifting the limit needs `NetworkParent` propagation through pool clones.
- **Second-client identity** — two Play windows share one wallet; guest-wallet mechanism deferred (`MULTIPLAYER-PLAN.md:39,196`). Bevy headless already asserts guest wallets (`headless.rs:288-295`).
- **Headless test harness not built** — the restart/spam/duplicate exit criteria are unverified; standing gate is only `probe-script-runner.mjs` (`MULTIPLAYER-PLAN.md:75-79`).
- **Upstream message-layer guarantees are undocumented** — no stated ordering/reliability contract for `CUSTOM_EVENT`; the repo's ledger is a workaround, not a spec. (Per project policy, fix editor-side, never PR the SDK.)
- **bevy headless gaps:** AvatarBase not published (SDK `onEnterScene`/`getPlayer()` never fire server-side, `HEADLESS_TOWEROFMADNESS_TEST.md:14,69`); foreign-player Transform copier deferred; room `access_token` readable by scene JS (S4 exfiltration risk, `HEADLESS_SECURITY_ISOLATION.md:85`); no per-peer inbound rate limit vs hammurabi's 300/s.