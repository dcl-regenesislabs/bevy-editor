# Multiplayer Core — Final Review

**Branch:** `feat/multiplayer-core` · **Repo root:** `/Users/boedo/Documents/Decentraland/dcl-editor` (all `file:line` below are relative to that root; docs cited live under `/Users/boedo/Documents/Decentraland/dcl-editor/docs/`)

---

## 1. Verdict

**Tower of Madness cannot be built on this branch today.** Four of the walkthrough's eight steps fail outright — step 3 throws and self-deletes its registration (`game.ts:525-527`), step 5 wedges the round loop permanently the first time a player disconnects mid-round (`gameCore.ts:550-558`), step 6 imports a symbol that does not exist (`docs/MULTIPLAYER-GAME-WALKTHROUGHS.md:450`), and steps 4/5/6 produce nine TypeScript errors because every read off the surface is `unknown` (`game.ts:574,595,669,677`). Separately, two of the three headline guarantees in §11.1 are false as shipped: any modified client can forge or permanently freeze `game.state` (`game.ts:227`), and every "targeted" whisper is broadcast to all peers with the recipient's address in the payload (`game.ts:209`). The architecture is sound and most of the machinery works — this is a fix list, not a redesign, with one exception (**V1**) that must be answered by measurement before the position-dependent half of the design can be trusted at all.

---

## 2. Blockers

### B1 · Any client can forge or permanently freeze any `game.state` key
- **Breaks:** `game.ts:227` calls `protectSynced(entity, [SharedFact], () => false)`, which arms only the *per-entity* overload (`protectedSync.ts:99`). `@dcl/ecs/dist/engine/lww-element-set-component-definition.js:319-325` returns `true` from `__run_validateBeforeChange` when no per-entity **and** no component-global callback exists; `@dcl/sdk/src/network/server/index.ts:61-83` mints a fresh local entity for an unknown `networkId:entityId`, `:108-141` validates against that fresh id (no callback → allow), `:259-266` rebroadcasts. `game.ts:487-493` ingests every `SharedFact` entity unconditionally.
- **Repro:** modified client emits one `PUT_COMPONENT_NETWORK` with `SharedFact{key:'round', json:…, rev:2147483647}` → every screen adopts it; `applyFact`'s `rev <= known` drop (`gameCore.ts:471`) then freezes that key for the session, and `fork()` re-adopts the poison next wake (`game.ts:455-459`).
- **Fix:** in `fork()`'s server branch before `markServerReady` (~`game.ts:449`), arm the component-global form once — `SharedFact.validateBeforeChange(({ senderAddress }) => isServerPeer(senderAddress, AUTH_SERVER_PEER_ID))`, the shipped precedent being `serverLife.ts:242`. Keep the per-entity call. Clamp `Number(fact.rev)` at `game.ts:457` to a finite `0…2^30`.
- **Effort:** M (fix is ~6 lines; `game-module.test.ts:59-68` currently discards the component-global form and must be reworked).
- **Note:** `spawner.ts:422` has the identical hole for `'server'` pools — same class, outside this diff.

### B2 · `{to}` is a broadcast; every whisper is readable by everyone
- **Breaks:** `game.ts:209` — `self().tell.send(TELL, { name, body: json, to: to ?? '' })` with **no options argument**; filtering happens on the receiver at `game.ts:463`. Probe-verified frame: `{"name":"game.tell","value":{…,"to":"0xBob"}}`, `opts` undefined. The real mechanism is used two files over: `rpc.ts:72` passes `{ to: [context.from] }` → `@dcl/sdk/src/network/events/implementation.ts:120-125` routes it to `destination_identities`.
- **Repro:** any `game.send(name, body, {to})`; capture the comms frame on a third peer.
- **Fix:** `game.ts:207-213` pass `to !== undefined ? { to: [to] } : undefined` as the third arg; lowercase `to` on the way out (**N3**); keep the receive-side filter as defense-in-depth. `game-module.test.ts:399` currently asserts the defect as correct and must flip.
- **Effort:** S.

### B3 · One packet runs a screen-only handler inside the game and kills that message name for the session
- **Breaks:** `gameCore.ts:390` calls `claimDirection(name,'ask')` **before** the handler-exists check (`:391`) and the rate limit (`:393`); `game.ts:450` arms an rpc method for every registered name, including screen-side ones.
- **Repro:** `game.rpc.req {method:'roundOver'}` from any wallet → probe-verified the blue handler ran server-side (`[{"top3":"pwned"}]`, `ok:true`); afterwards `game.send('roundOver', …)` emits zero `game.tell` frames and rejects with `GameDirectionError`, permanently. In ToM this disables round-end teleport + podium. (`send` is `async` at `gameCore.ts:365`, so the caller's handler continues — it surfaces as a silent unhandled rejection with no `[game]` card.)
- **Fix:** `gameCore.ts:383-396` — resolve `entry` first and reject unknown names without touching `directions`; reject an ask when `directions.get(name) === 'tell'` without mutating; let a green `send` override a wire-set `'ask'` (log, don't throw). Emit a `[game]` error card on a failed `send` claim.
- **Effort:** M.

### B4 · The boot drain can throw synchronously and deadlock the whole scene
- **Breaks:** `handleAsk` is not `async` (`gameCore.ts:383`), so `claimDirection` (`:390`) throws synchronously; `:610-612` calls it bare inside the drain loop with `hasBooted` already set at `:607`; `game.ts:460` has no `.catch` on `bootServer(...).then(markServerReady)`.
- **Repro:** a pre-boot ask (reachable via B3's packet during the ~15 s cold start) for a name `onStart` already claimed `'tell'` → `bootServer` rejects → `markServerReady` never runs → `serverLifeState()` stays `'waking'` (`serverLife.ts:238-242`) → every client's `send` parks in `d.held` forever (`game.ts:196`, drained only at `game.ts:500`). The `preBootZoneClaims` drain (`gameCore.ts:613-617`) never runs.
- **Fix:** try/catch per drain iteration (or make `handleAsk` async), plus `.catch()` at `game.ts:460` that emits an error card **and** still calls `markServerReady`.
- **Effort:** S.

### B5 · `playerData` for a departed player throws — and wedges the round loop forever
- **Breaks:** `gameCore.ts:684` deletes the record on leave; `:550-558` then throws *"playerData for X was read before their restore finished"* — blaming an internal wiring bug for a normal event.
- **Repro:** probe-verified — after a wallet leaves, a `game.every(1, …)` reading their data logs the error **every second** and nothing after the read runs. In ToM this is `round-results.close()` (`docs/MULTIPLAYER-GAME-WALKTHROUGHS.md:413`): one finisher logging off mid-round aborts `close()` before `setState({clock: freshClock()})`, so `remainingNow(...) <= 0` stays true and no round ever starts again.
- **Fix:** `gameCore.ts:550-558` — `playerRecord` returns `{}` for an unknown/departed player (same shape a first visit yields, `game.ts:257`). Keep a hard error only if the genuine wiring case can be distinguished.
- **Effort:** S.

### B6 · `game.layout()` keys on the prefab UUID, but every doc teaches the name
- **Breaks:** `game.ts:650` types `layout(prefab: string, …)`; `game.ts:525` → `spawner.ts:334-346` looks up `snapshots`, keyed at `spawner.ts:875` by `entry.prefab` = `input.data.id`, the prefab **UUID** (`packages/ui/src/prefabs/spawnable.ts:177`). The only creator-reachable form is `Spawnables.<Alias>`, typed `PrefabRef` (`codegen.ts:313,334`).
- **Repro:** `game.layout('chunk-01', …)` (walkthrough step 3; `MULTIPLAYER-DX-PLAN.md:96,141`) → `unknown spawnable 'chunk-01' — is it Spawnable in the Prefabs tab?`, and `game.ts:527` **deletes** the registration so it never retries. The error names a toggle that is not the cause.
- **Fix:** type the parameter as the generated `PrefabRef` (raw string becomes a compile error); correct the error string; drop `d.layouts.delete(prefab)` at `game.ts:527`. Update `MULTIPLAYER-DX-PLAN.md` §2.2 and the walkthrough to `Spawnables.X`.
- **Effort:** M (code S, docs M).

### B7 · Presence and position derive from unvalidated synced components
- **Breaks:** `game.ts:377-385` (`presentAddresses`) and `playerPositions.ts:34-45` iterate `PlayerIdentityData` with no provenance check. `PlayerIdentityData` is not in `NOT_SYNC_COMPONENTS` (`@dcl/sdk/src/network/state.ts:33-51`); the server's inbound path applies no sync filter — `network/filter.ts:13-30` is an *outbound* filter on an honest client.
- **Repro:** a modified client syncs an entity carrying `PlayerIdentityData{address: victim}` + `Transform` → server fires `onPlayerJoin(victim)`, loads and mutates the victim's durable record, writes it back on the synthetic leave (`gameCore.ts:677-685`). Placing the attacker's own address inside a zone volume wins `playerPositions.ts:49`'s first-match lookup, defeating zone re-verification and `game.positionOf`.
- **Fix:** in `presentAddresses()` and `playerPositions()`, skip candidates that arrived over the scene sync bus (`NetworkEntity`/`CreatedBy` present, or `EntityUtils.fromEntityId(entity)[0] < RESERVED_STATIC_ENTITIES`). **Gated on V1** — the exact predicate must be probed on a real headless server first or the filter deletes every real avatar.
- **Effort:** L (blocked on V1).

---

## 3. Majors (ranked)

| # | What breaks | Repro | Fix | Effort |
|---|---|---|---|---|
| **M1** | Zone-claim ask bypasses every §11.2 hygiene check — `game.ts:387-401` wires `ZONE_ASK` straight into `d.core.zoneClaim`, never through `handleAsk`. Exits honored unconditionally (`gameCore.ts:727-730`). | Alternate `{kind:'exit'}`/`{kind:'enter'}` at transport rate from inside a zone → green enter/exit code at ~100 Hz, each paying a full `findZoneVolumes` scan (`game.ts:353-372`) + full avatar scan (`playerPositions.ts:47-51`). Free re-entry through ToM's `Start` gate. | `game.ts:388` — route through the same front-end as `handleAsk`; rate-limit key `game.zone\|<zone>` at ~4/s to match the sweep. | M |
| **M2** | `admitZoneMember` resets the lost-sight timer — `gameCore.ts:749-753` does `members.set(player, 0)` unconditionally. The shipped precedent does the opposite: `prefabs/trigger-zone-server/scripts/zone-authority.ts:151-155`. | A client whose position the server cannot see takes the grace branch (`gameCore.ts:734-740`, `verified:false`) and re-claims every 9 s (unrated, M1) → the 10 s drop at `:784` never fires. Indefinite unverified membership from any position. | Restore `if (!members.has(player))`; track admission time separately so grace is granted once. | S |
| **M8** | No idempotency — `rpc.ts:91-99` resends the same id after 4 s (`pure/pending.ts:41-55`); `rpc.ts:57-74` dispatches every `req` with no seen-id set, and `gameCore.ts:383` adds none. Refutes §11.1's "idempotency keys claimed before the first await… double-click dupes are structurally dead". | Drop the `res` packet (or take >4 s in a handler) → duplicate id `game:7:abc` → a `collect`/`openChest` handler credits twice. | Bounded seen-id → reply cache in `handleAsk` (or `rpc.ts`'s server branch); replay the stored reply for a duplicate id. | M |
| **M5** | `inGreen` is a boolean, not a depth counter (`gameCore.ts:282`, set/cleared at `:414`/`:421`, `:627`/`:637`). Concurrent green spans revoke each other's permission. | Two registered callbacks in one family + two concurrent spans: `runGreen` awaits per callback (`:631`), so the inner span's `finally` (`:637`) clears `inGreen` before the outer span's second callback runs → `setState`/`saved.set`/`playerData.set`/`newRound` throw *"Only the game can change game.state."* from inside green. Concurrency sources are structural: two joins in a tick (`:660-664`), `newRound`'s deferred microtask (`:820`), `admitZoneMember` (`:758`), `runEvery`. Inner `flushState()` also publishes half-written state a rev early. | Replace with `greenDepth: number`; guard tests `> 0`; `flushState` only on outermost exit. | M |
| **M6** | Unserializable state value throws every frame out of the engine system — `gameCore.ts:457` `JSON.stringify(value ?? null)` with no try/catch, reached from a `finally` (`:422`, `:638`) and the engine tick (`game.ts:472`), unguarded in `armTick` (`game.ts:426-440`). | `setState` with a BigInt (the `Int64` trap documented at `timeSync.ts:80-82`) or a cyclic object → (a) the `finally` throw rejects `run`, which `queues.set(name, run)` (`:425`) stores, killing that name's FIFO forever; (b) `dirty.clear()` (`:466`) never runs, so `serverTick`'s `flushState` throws every frame, aborting the rest of the frame's systems and republishing earlier keys with a new rev each frame. | Try/catch the stringify per key, error card, `dirty.delete(key)`; move `dirty.clear()` into a `finally`. | S |
| **M7** | `game.send` from a placed script's `start()` — `gameCore.ts:367` branches on `isServer()`, which is `false` until `fork()` calls `setRole` on the first tick (`game.ts:445`). The comment at `game.ts:48-51` claims this hazard is "solved here once"; it is solved for transport install, not for `send`. | Any script whose `start()` calls `game.send(...)` → on the server copy it takes the blue path: `claimDirection(name,'ask')` poisons the name (B3) and `sendAsk` (`game.ts:194`) parks in `d.held`. `serverTick` (`game.ts:470-483`) never drains `d.held` — only `clientTick` does (`:500`) — so the promise never settles. | `gameCore.ts:365` — queue `send` until `setRole` resolves when `this.server === null`; have `serverTick` drain `d.held` into the tell path. | M |
| **M3** | `restorePlayerData` has no in-flight dedupe and runs before the rate limit — `game.ts:332`; the `playerRecords.has` check (`gameCore.ts:562-564`) reads a map written only after the await. | A fresh wallet fires N asks in one tick → N concurrent `Storage.player.get` host calls, unmetered. `docs/CLIENT-SERVER-SPAWNING.md:21` caps in-flight host calls at 40; past it `Storage.set` resolves `false` scene-wide. M1 amplifies via `admitZoneMember`/`dropZoneMember` (`:758`, `:768`). | Memoize the in-flight promise in `loading: Map<Player, Promise<void>>`, cleared in `finally`. | S |
| **M4** | The reserved key `round` is not reserved — `gameCore.ts:112` (`ROUND_STATE_KEY='round'`) shares the map `setState` writes, and `setState` (`:440-446`) has no key check. | `game.setState({ round: 3 })` → `asRoundInfo` returns `zeroRound()` (`:129`) → `game.round.number` is 0 → `layoutTick` returns early forever (`game.ts:515`, every layout freezes) and the next `newRound()` computes `0+1`, restarting numbering. Silent both ways. | Throw a teaching error at `gameCore.ts:440` on `key === 'round'`. | S |
| **M9** | Every surface read is `unknown` — `game.ts:574`, `:595`, `:669`, `:677`; no type parameter anywhere. | From `docs/MULTIPLAYER-GAME-WALKTHROUGHS.md`: `remainingNow(game.state.clock, …)` (madness-race:25, round-results:19, clock-board:10) TS2345; `d.top3` (round-results:23) TS18046; `(d.points ?? 0) + …` (round-results:30-31) arithmetic on `unknown`; `bestTimes(game.saved.get('bestTimes') ?? [], …)` (round-results:33-34) TS2345. Under this repo's no-`as any` rule the creator casts at every read. | Optional type params: `onMessage<T = unknown>`, `saved.get<T>(key): T \| undefined`, `playerData<T>`, plus a typed `game.stateOf<T>(key)`. Then rewrite the recipes, which currently teach code that does not build. | M |
| **M10** | `childrenOf` is imported by the walkthrough and does not exist — `docs/MULTIPLAYER-GAME-WALKTHROUGHS.md:450`; no such symbol in `packages/desktop/runtime-modules/`. Step 6 does not compile. Scheduled (§13 Phase 2 / PR 11; `MULTIPLAYER-BUILD-BOOK.md:694-701`), and the walkthrough's own notes flag it at line 596. | `npm run build` on the step-6 scene. | Ship the ~10-line id-sorted helper and re-export from `game.ts`, or rewrite step 6 to hand-roll it. | S |

---

## 4. Security

### Real exploits

| ID | Attack scenario | Fix |
|---|---|---|
| **B1 — state forgery / permanent freeze** | Attacker runs a modified client, emits one `PUT_COMPONENT_NETWORK` carrying `SharedFact{key:'round', rev:2^31-1}`. The server mints a fresh entity for the unknown id (`@dcl/sdk/src/network/server/index.ts:61-83`), the validator is absent so it passes (`lww-element-set-component-definition.js:319-325`), and it is rebroadcast (`:259-266`). Every screen adopts the forged round; `gameCore.ts:471`'s monotonic-rev drop then makes the key un-writable by the real server for the rest of the session. Directly refutes §11.1 *"A modified client can ask anything and change nothing."* | Component-global `SharedFact.validateBeforeChange(({senderAddress}) => isServerPeer(...))` in `fork()`'s server branch (~`game.ts:449`), precedent `serverLife.ts:242`; clamp rev at `game.ts:457`. |
| **B2 — whisper disclosure** | Every `{to}` message is a full broadcast with the recipient's wallet in the body (`game.ts:209`). A passive observer running an unmodified client with a logging patch reads every private warning, every per-player secret. In ToM: all speed-strike warnings are public, plus the addresses of who got them. Refutes §11.1 *"non-targets never receive the packet"* and the walkthrough's "SFU-enforced". | Pass `{ to: [to] }` to `tell.send` (`game.ts:207-213`); the mechanism already works at `rpc.ts:72`. |
| **B7 — identity spoofing / phantom players** | Attacker syncs an entity carrying `PlayerIdentityData{address: victim}` + `Transform`. `PlayerIdentityData` is not sync-excluded (`network/state.ts:33-51`) and the inbound path has no filter. Server fires `onPlayerJoin(victim)`, reads and mutates the victim's durable record, and persists it on the synthetic leave (`gameCore.ts:677-685`). Positioning the forged entity inside a zone wins `playerPositions.ts:49`'s first match, so zone re-verification and `game.positionOf` confirm a player who is not there. | Provenance filter in `presentAddresses()` / `playerPositions()` — gated on **V1**. |
| **M1 + M2 — zone gate bypass** | Unrated `ZONE_ASK` (`game.ts:387-401`) lets an attacker re-enter ToM's `Start` gate at will and run green enter/exit code at transport rate; combined with `admitZoneMember`'s timer reset (`gameCore.ts:749-753`) a client the server cannot see holds membership in any zone indefinitely by re-claiming every 9 s. | Rate-limit the claim; restore the `if (!members.has(player))` guard. |
| **M8 — replay double-credit** | Dropping the `res` packet makes the client resend the same rpc id (`rpc.ts:91-99`); no seen-id set anywhere, so an economy handler credits twice per retry. | Bounded seen-id → reply cache. |
| **M3 — host-call exhaustion** | Fresh wallet fires N asks in one tick before any rate limit applies (`game.ts:332`), each starting a `Storage.player.get`; past the 40 in-flight cap (`docs/CLIENT-SERVER-SPAWNING.md:21`) `Storage.set` starts silently returning `false` **scene-wide**, i.e. one attacker corrupts every player's saves. | In-flight promise memoization. |
| **N12 — namespace disclosure via error text** | `rpc.ts:68-72` + `gameCore.ts:427` relay handler and internal error strings verbatim to the asker; `GameNameError` (`gameCore.ts:183`) even replies *"Closest match: 'openChest'"*, letting an attacker enumerate handler names by fuzzing. | Reply a code; keep detail on the `[game]` console only. |

### Accepted ceilings (state them, don't fix)

- **Public logic** and **client-authoritative movement** — §11.3, unchanged.
- **N13 · `Math.random()` round seeds** (`game.ts:299-301`), and every seed is published — so a client can precompute the layout. The stash itself is sound (`serverState`, throws on clients, fresh draw per take). This is currently *implicit*; write it into §11.3 or fix it, don't leave it unstated.
- **N15 · The one-handler-per-name guard is inert in a real build** — `game.ts:560-566` skips only literal `'game.ts'`/`'gameCore.ts'`, but the deployed scene is an esbuild bundle so `callerScript()` returns one filename for every caller and two scripts silently replace each other. The comment at `:555-559` documents the degradation and defers to G2b's static pass — acceptable **only if G2b actually ships before PR 8 flips the template**. Confirm that.
- **N16 · Placed scripts are outside the "exactly one function export" lint** — `codegen.ts:390-400` covers prefab snapshots only, while `pure/scriptInit.ts:85` takes the first function-valued export. esbuild emits export keys alphabetically with uppercase first, so `TowerBuilder`/`MadnessRace` beat `towerFor`/`remainingNow` — the walkthrough is safe **by naming convention, not by rule**. A PascalCase helper breaks it silently. Extend the lint.

---

## 5. Test gaps that matter

| Gap | Concrete test to add |
|---|---|
| `game-module.test.ts:59-68` **discards** the component-global `validateBeforeChange` form — which is exactly why B1 is invisible to the suite. | Make the mock component record both overloads, then assert: after `fork()` on the server, `SharedFact` has a component-global validator, and a simulated inbound change with a non-server `senderAddress` is rejected. Add the client-side twin: a forged `SharedFact` with `rev = 2^31-1` must not be adopted. |
| `game-module.test.ts:399` **asserts B2's defect as correct** (no options arg on `tell.send`). | Flip it: `game.send('warned', body, {to: '0xBob'})` must call `tell.send` with a third argument `{ to: ['0xbob'] }` (lowercased — covers N3 too). |
| No test drives an ask at a **screen-registered** name (B3). | `game.rpc.req {method:'<blue-only name>'}` from a foreign wallet → assert the handler did **not** run, the reply is an error, and a subsequent `game.send('<same name>', …)` still emits a `game.tell` frame. |
| No test covers boot-drain failure (B4). | Queue a pre-boot ask for a name `onStart` claimed `'tell'`, run `fork()` server-side → assert `markServerReady` was still called and an error card was emitted, and that a client `send` afterwards drains from `d.held`. |
| No test reads `playerData` after leave (B5). | `onPlayerLeave` then `game.playerData(addr).get('points')` → expect `undefined`, not a throw; plus a regression test that a `game.every` callback continues past the read. |
| No test exercises **overlapping** green spans (M5). | Register two callbacks in one family, start two spans concurrently, assert `setState` from the outer span's second callback does not throw and `flushState` publishes once, on the outermost exit. |
| No test feeds `setState` an unserializable value (M6). | `setState({x: 1n})` → assert an error card, `dirty` no longer contains `x`, the next `serverTick` does not throw, and the name's FIFO still accepts a later ask. |
| No test for rpc retry (M8). | Dispatch the same `req` id twice → assert the handler ran once and the second call returned the cached reply. |
| No test for zone-claim flood or grace-timer reset (M1/M2). | Fire 50 alternating enter/exit claims in one tick → assert green handlers ran ≤ the rate cap; separately, re-claim an unverified member twice inside the grace window → assert the sweep still drops them at 10 s from **first** admission. |
| `game.layout` is only tested via UUID (B6). | Once typed, a compile-time test (`expectTypeOf`/`@ts-expect-error`) that a raw string is rejected, plus a runtime test that a failed lookup does **not** delete the registration. |
| Rotated / sphere zone volumes are thinly covered. | Pure-function tests against `rotateVec` from `./worldTransform` (`gameCore.ts:98`) — note the earlier claim that the SDK `Vector3.rotate` identity mock neuters `insideZone` is **wrong**; the mock only weakens `playerPositions.ts:67` parent-chain composition, which is where the coverage test belongs. |

---

## 6. What's solid (survived adversarial review)

- **Seeded layout reconstruction** is byte-identical across screens and fast-forwards a late joiner with zero extra traffic.
- **Round 1 fires `onRoundStart` at boot**; `game.every` is correctly boot-gated.
- **The clock tuple + `game.now()`** needs no NTP round-trip — the design holds.
- **The `saved` / `playerData` aggregate-board idiom** works exactly as §12 #4 describes.
- **The zone-gate → ask → re-verify dance** is the only shape the API lets you express — good constraint design (its *implementation* has M1/M2, the shape is right).
- **The stash** (`serverState`, throws on clients, fresh draw per take) is sound as verified against §11.2.
- **The rate limiter cannot be grown from the wire** — `rpc.ts:64-65` throws `no handler: <method>` for any unarmed name, so `directions`/`buckets` only ever hold creator-armed names. (An earlier report claimed otherwise; refuted.)

---

## 7. Recommended next commits

**Before a human review** — these either falsify a documented guarantee or stop ToM from running at all.

| # | Commit | Findings | Effort |
|---|---|---|---|
| 1 | Return `{}` from `playerRecord` for departed players | B5 | S |
| 2 | Pass `{to:[to]}` to `tell.send`, lowercase on send; flip the test at `game-module.test.ts:399` | B2, N3 | S |
| 3 | Guard the boot drain: try/catch per iteration + `.catch` at `game.ts:460` that still calls `markServerReady` | B4 | S |
| 4 | Restore `if (!members.has(player))` in `admitZoneMember` | M2 | S |
| 5 | Reserve the `round` state key with a teaching throw | M4 | S |
| 6 | Try/catch `flushState`'s stringify per key; `dirty.clear()` in a `finally` | M6 | S |
| 7 | Memoize in-flight `restorePlayerData` | M3 | S |
| 8 | Ship `childrenOf` and re-export from `game.ts` | M10 | S |
| 9 | Arm the component-global `SharedFact` validator + clamp `rev`; rework `game-module.test.ts:59-68` | B1 | M |
| 10 | Reorder `handleAsk` (entry lookup → direction check → rate limit); error card on failed `send` claim | B3 | M |
| 11 | Type `game.layout` as `PrefabRef`, fix the error string, stop deleting the registration | B6 | M |
| 12 | Rate-limit `ZONE_ASK` through the `handleAsk` front-end | M1 | M |
| 13 | Add generics to the surface (`onMessage<T>`, `saved.get<T>`, `playerData<T>`, `stateOf<T>`) | M9 | M |
| 14 | Rewrite the walkthrough: `Spawnables.*` in step 3, `onStateChange` in step 8, typed reads in 4/5/6; update `MULTIPLAYER-DX-PLAN.md` §2.2 | B6, M9, N7 | M |
| 15 | **Probe V1 on a real headless server** — does `playerPosition` return anything? | V1 | M |

**Can follow the first review** — real, but neither a false guarantee nor a build stopper.

| # | Commit | Findings |
|---|---|---|
| 16 | `greenDepth` counter replacing `inGreen`; `flushState` on outermost exit only | M5 |
| 17 | Queue `send` until `setRole` resolves; drain `d.held` in `serverTick` | M7 |
| 18 | Bounded seen-id → reply cache for rpc idempotency | M8 |
| 19 | Provenance filter in `presentAddresses`/`playerPositions` — **only after V1 answers** | B7 |
| 20 | Wire replies become codes; detail stays on the `[game]` console | N12 |
| 21 | Per-(name, player) queue cap + dispatch timeout; cap pre-boot queues at ~256 drop-oldest | N1, N2 |
| 22 | Compute layout `spots` before `releaseAll()`; one `devWarn` per truncated pool per round | N5, N6 |
| 23 | `devWarn` on blue `onRoundStart`; freeze/proxy `game.state`; dedupe `game.every` by call site | N7, N8, N9 |
| 24 | Build the address→position map once per sweep; memoize `findZones` per pass | N4 |
| 25 | `.catch` into an error card for async blue tell handlers; skip republishing unchanged values | N10, N11 |
| 26 | Extend the one-function-export lint to placed scripts; comment the `seenRevs` latent (`game.ts:492`); namespace `serverState` key `'game.round'` (`game.ts:66`) | N16, N14 |

---

## Gating open question — V1

**Does `playerPosition` return anything on a real headless server?** `playerPositions.ts:16-18` states outright that it returns `[]` there, and `docs/CLIENT-SERVER-SPAWNING.md:23` repeats it — while the *same line* says server-side checks must use synced `PlayerIdentityData` + `Transform`, and the shipped, in-production `zone-authority.ts:6-8` says the server *"re-derives the position itself from the avatar transforms it receives over comms."* `game.ts:279` wires that function into the server-only ports behind `settleZoneClaim`, `sweepZones` and `game.positionOf`.

If the header comment is right: every enter takes the unverified grace branch (`gameCore.ts:734-740`), the sweep drops **every** member after 10 s and fires spurious `onExitZone` for players standing still — and since the client only re-claims on a zoneBus edge (`game.ts:407-410`) they never re-enter — and `game.positionOf` always returns `null`, which is ToM's finish check and its entire speed-strike behavior. Inherited from the shipped kit, not introduced here, but **it must be probed on a real headless server before G2 ships**, and it decides the predicate for B7's fix. If the answer is `[]`, the design needs a different answer, not a patch.