# Multiplayer DX Plan — making authoritative-server scenes easy in Decentraland Studio

Status: proposed, 2026-08-07 — synthesized from a multi-agent design round (3 competing designs, judged, merged, adversarially reviewed twice; all confirmed critique findings folded in). Skeleton: the `game` runtime module, with the editor-visibility suite and copy discipline grafted from the editor-first design and the AI contract + prefab kit grafted from the AI-first design. §9 covers entity references (how scripts point at other entities), designed in its own review round. Extends `docs/MULTIPLAYER-PLAN.md` (M0–M8); does not reset it. Every mechanism below is implementable within the engine facts in `docs/CLIENT-SERVER-SPAWNING.md` (cited as CSS:line). The v1 script contract (`constructor(src, entity, …params)` + `start()`/`update(dt)`) is **untouched** — parser, attach flow, AI pipeline, and all shipped prefabs work unchanged on day one.

---

## 1. The mental model we teach

**Every scene you build runs one shared copy: the game — a copy of your scene that runs for everyone, decides what's true, and remembers.** You talk to it through one object, `game`. Facts everyone must agree on live in `game.state`; a player who walks in late sees them automatically. Players never change the game directly — they **ask** (`game.send`), and the game answers in a handler (`game.onMessage`). Only code inside those green handlers can change shared facts, spawn shared objects, or touch saved data. Everything else in a script — `start()`, `update()`, clicks, sounds, sparkles — is what *this player's screen* draws. The rule of thumb, taught everywhere the pair appears: **the explosion effect is a message that fades; the health bar is state that stays.** (No idioms in load-bearing copy — this sentence must survive translation.)

The fork between "in the game, for everyone" and "on this player's screen" is expressed by **which callback you write**, never by an `if`. Creators never see or type `isServer()`, `syncEntity`, `registerMessages`, `Schemas.*`, `room.*`, `Storage.*`, `EnvVar.*`, sync ids, or timing rules — the module owns all of it (see §2). This is the synthesis of the prior art: Roblox's FilteringEnabled lesson (authority is physics, not a setting — there is no toggle anywhere in this product), Unity's state/event pair, Colyseus's "clients send intents, the server mutates truth," and the callback-decides-location idea in place of Roblox's folder-decides-location.

### The copy vocabulary (used identically in every surface, lint-reviewed)

| Creator word | Means | Never say |
|---|---|---|
| **the game** | the shared authoritative copy of the scene | "server", "backend", "host" |
| **on this player's screen** / **only you see** | client-local | "client", "local instance" |
| **everyone sees** / **shared** | server-owned synced state | "synced", "replicated", "CRDT" |
| **ask the game** | client→server request | "RPC", "message", "packet" |
| **tell the screens** (the game's `send`) | transient game→screens message | "broadcast", "event bus", "announcement" |
| `[game]` / `[you]` console tags | which copy of the scene printed the line | "server log", "client log" |
| **saved** / **kept between visits** | persisted Storage | "Storage API", "persistence layer" |
| **secret keys** | EnvVar | "environment variables" |
| Green ● | runs in the game, for everyone | — |
| Blue ● | runs on this player's screen | — |

One deliberate exception, the single load-bearing sentence where "server" is honest and stays: on the template picker card — *"This scene has its own game server — free, sleeps when empty."* The card carries one more line so the model reaches creators who never open a script: *"Your scene runs a shared copy for everyone — players ask it, it decides."* Everywhere else, "the game." (One metaphor, everywhere: "a shared copy of your scene" — never "brain".)

---

## 2. The creator API

### 2.1 Where it lives and how it dodges the timing traps

New runtime-module master `packages/desktop/runtime-modules/game.ts` (+ `pure/gameCore.ts`), composing the shipped kit — rpc, timeSync, serverLife, protectedSync, serverState, playerStore, schedule, rng, spawner, outcomes, zoneBus. Carried per-prefab byte-identical like every module today; additionally generated into `src/scripts/runtime/game.ts` on first creator import (the `game-config.ts` generation path). Singleton via `globalThis.__dclGame_v1` so the creator's module copy and every prefab's module copy are one instance.

**Timing is solved once, inside the module, forever.** `game.ts` registers exactly one generic message envelope (`createRpc('game')` + one sequenced broadcast stream) at its own module scope — satisfying "engine seals after module load; register at scope" (CSS:14) by construction. Creator handlers are *name-keyed strings riding that envelope*, so `game.onMessage('openChest', …)` is legal anywhere: module scope, `start()`, mid-round. Which transport half installs is decided lazily on first engine tick (the `outcomes.ts:37-42` pattern), because `isServer()` is false at module load (CSS:13). Traps 5 and 6 cease to exist in creator space. Payloads are JSON inside the envelope — no `Schemas.*` reaches a creator; timestamps come from `game.now()` (`getServerTime()`, `Number()`-coerced — the BigInt trap at CSS:104 is dead).

**Wire encoding (decision, 2026-08-07; revised after review):** typed message schemas must register at module scope (sealed engine, CSS:14) and `Schemas` has no bytes or "any object" type (verified against the SDK source — the Map serializer packs spec-ordered fields with no key names), so *runtime*-declared creator payloads can only travel as a JSON string body. Per-name typed schemas are impossible at runtime but **possible via build-time codegen** (scan `game.send` literals, infer shapes, emit `registerMessages` into the generated module). Measured stakes: ~15–25% per ask-message (tens/s vs the 300/s budget — negligible), but up to ~2× ledger page capacity against the 13 KB cap (real, if pages ever fill). Codegen's cost: it reintroduces silent schema-mismatch failures through a mechanism the creator can't see, plus a TS inference engine with a JSON fallback that keeps both codecs alive. Commitments: (1) **the facade's dispatch is codec-per-name behind the API** — `json` today, a generated typed codec is a drop-in later, no API change; (2) **the G1 harness benchmarks real recipe traffic** (bytes/message, page fill rates) so the upgrade decision is data, not taste; (3) **static shape + hot path → dedicated hand-written typed schema at module scope** now (timeSync and the heartbeat already do this; a graduated waypoint verb must too). Every hot path stays binary regardless — component sync rides the CRDT protobuf path, avatar movement rides the engine's unreliable channel, `layout` sends nothing.

### 2.2 The surface (complete — there is no second, rawer way)

```ts
import { game, onClick, type Player } from './runtime/game'
```

**The game's memory**

```ts
game.onStart(() => {                    // GREEN BOOT HOOK: runs once per game boot, server-side,
  game.setState({ doorOpen: false })    //   after restart cleanup — the home of initial state
})
game.state                              // read anywhere: game.state.doorOpen
game.setState({ doorOpen: true })       // green handlers only — elsewhere throws:
  // "Only the game changes game.state. Move this into game.onMessage — code there runs in the game, for everyone."
game.onStateChange((changed) => {})     // every screen, incl. late joiners (CRDT snapshot, CSS:58)

game.saved.get('highScores') / .set(k, v)          // green only; survives restarts & re-publishes
game.playerData(player).get() / .set({coins: 5})   // green only; per-wallet, forever
await game.secret('WEATHER_API_KEY')               // green only; never reaches players

onClick(entity, () => {})               // blue screen helper (wraps pointerEventsSystem) — ships in
                                        //   the same runtime module so the recipes are real code
```

`Player` is a **lowercase wallet address string** (`context.from`, CSS:134) — safe as an object key and in JSON payloads.

**Restart semantics (one honest answer):** `game.state` **resets when the game goes to sleep** — a few minutes after the last player leaves (CSS:21) — and on re-publish, exactly as the §5 lifetime table promises; `onStart`'s JSDoc opens with *"Runs once when the game wakes up (not per player, not per round)."* Because the CRDT snapshot survives restarts (CSS:58,61), the module enforces this on boot: it re-adopts stale `SharedFact` entities, deletes them respecting the defer-a-tick rule (CSS:61), republishes fresh state so clients holding a stale replay get overwritten, and only then runs `game.onStart`. Durable values belong in `game.saved` — the boot hook is where creators copy them back in if they want continuity. (The green-context guard is a teaching guard, not a security boundary: across an awaited span a concurrently ticking server-side `update()` would pass it — acceptable, but never described as airtight.)

**Fix adopted from the verdict:** `game.state` is *not* one blob. Internally each top-level key is its own synced entity (`runtime::SharedFact { key, json, rev }`, auto sync id, `protectedSync` refuse-all validator), honoring the doc's fast/slow split guidance (CSS:158) and keeping any single write far from the 12 KB chunk edge (CSS:57). `setState` coalesces to at most one component write per key per tick; a dev-Play guard warns when one key's value passes 4 KB. The API stays a single object — the sharding is invisible.

**Messages**

```ts
// A screen asks the game — and the game answers
await game.send('openChest', { chest: this.entity })  // blue → green; resolves with the handler's return
game.onMessage('openChest', (data, player) => {})     // green; player = verified wallet (context.from,
                                                      //   lowercased — never from data, CSS:134)

// The game tells the screens — SAME PAIR, other direction
game.send('zombieDied', { instance })                 // green → every screen; moments, never facts
game.send('score', { value: 40 }, { to: player })     // green → one screen (this IS the relay — CSS:130)
game.onMessage('zombieDied', (data) => {})            // blue; hears only the game (CSS:130-131)
```

**One pair, both directions** (product decision, 2026-08-07 review round): where you call `send`/`onMessage` decides which way it flows — a screen's `send` reaches only the game; the game's `send` reaches screens, all or one via `{to}`. There is no third verb: what an earlier draft called `announce`/`onAnnounce` is simply the game's side of the same pair, and screens learn validated facts ("that zombie died", "your score is 40") the same way the game learns intents. **Direction is per-name** — a name is either asked by players or told by the game; using one name in both directions is a dev-Play error. **One handler per name** — re-registering from the same script (a prefab placed twice) reuses the one handler, which is why recipes carry `this.entity` in the payload to tell instances apart; two *different* scripts claiming one name get an error card. **A typo'd or wrong-direction name is an immediate typed error** on the sender plus a `[game]`/`[you]` error card — never silence; G2b's static check flags unmatched send/onMessage names at edit time.

Under the hood (unchanged from the critique round): blue→green rides the rpc layer with its retry timer **gated on `serverLife`** — rpc's stock ~12 s budget is shorter than the ~15 s production cold start (CSS:21), so sends queue while the strip shows "Waking…". Green→screens broadcasts ride the sequenced ledger (seq order, gap repair, ≤48-entry pages under the 13 KB silent-drop threshold, CSS:135-136) with a **~10 s moment horizon**: a laggard misses an old "GOAL!" rather than replaying it — messages are moments; if a late joiner must see it, it's `game.state`. Targeted `{to}` takes a separate plain targeted path (it can't share the ledger — non-targets would see permanent gaps; weaker delivery, fine for a whisper, stated in JSDoc). Handlers of one name run **FIFO, awaited** (kills the detached-async race, CSS:59) and **wrapped in try/catch** — a crash surfaces as a `[game]` error card, never wedges the queue or the isolate (CSS:154). A screen never hears another screen (CSS:130-131) — player-to-player goes through the game.

**Things in the world**

```ts
game.spawn('gold-pile', { at: {x,y,z}, key: 'east-gold', ownedBy?: player }) // green; one shared
game.despawn('east-gold')                                                    //   object, everyone sees it
game.layout('rock', (rng, round) => Vector3[])         // identical on every screen, zero comms
game.layout('zombie', planFn, { outcomes: ['hit'] })   // advanced: planned pool + validation
game.instanceOf(entity)                                // blue; a laid-out copy's shared id — the SAME
                                                       //   id on every screen (planInstanceId, CSS:116)
game.report('hit', { instance, amount })               // blue
game.onReport('hit', (data, player) => amountOrVeto)   // green validator
```

`spawn` = `pool(prefab, 'server')` + `protectSynced` refusing validators + **auto sync id, never explicit** (dynamic-id rule, CSS:54; unguarded-sync rule, CSS:55). `key` is an idempotency key claimed **synchronously before any await** — two simultaneous spawns of the same key no-op (CSS:59). `ownedBy: player` means *everyone sees it, and it's removed when that player leaves* (orphan rule, CSS:60) — deliberately not named `for:`, which reads as visibility. v1 limit respected: single-entity prefabs only (CSS:62,175). `layout` = the seeded/planned machinery: the callback receives *only* `(rng, round)` — no player list, no clock, no way to diverge by construction (draw-order contract, CSS:102); it re-runs from the round tuple on every client and late joiner, and the tuple rides synced state, never a message (CSS:95).

**Players, places, time**

```ts
game.onPlayerJoin(p => {}) / game.onPlayerLeave(p => {})  // green; leave pre-wired to release
game.onEnterZone('Vault', p => {}) / game.onExitZone(...)  //   entities + flush data (CSS:60)
game.positionOf(player)      // green; "feet, ~10×/second — generous checks only" (CSS:152)
game.every(5, () => {})      // green; deadline-as-state schedule, survives restarts
game.now()                   // shared clock, both sides
game.newRound() / game.round / game.onRoundStart(r => {})  // seed + fast-forward by arithmetic (CSS:97)
```

`game.onEnterZone` binds by zone name to a placed Trigger Zone (existing zoneBus) and internally runs the full correct dance — client detects locally → asks → the game re-verifies against SDK-synced positions with 1 m slack, 4 Hz sweep, late-joiner grace (the `zone-authority.ts` logic, absorbed) — because trigger zones never fire server-side (CSS:23,31). The creator cannot write the broken version through this API. Two implementation constraints priced into G2: server-side join/leave detection watches synced `PlayerIdentityData`, because SDK `onEnterScene`/`getPlayer` never fire on the headless server (CSS:179); and `playerData(p)` is sync-shaped over async Storage — the module awaits the player's restore before their first green handler runs, so `.get()` never races the load.

**Namespace discipline (verdict fix):** `game` claims its rpc namespace and sync-id block once; any editor-visible id or namespace registry (`claims-rpc` frontmatter, shared-fact keys pinned by prefabs) is **editor-maintained and append-only** — no creator ever types or reorders one.

### 2.3 The four canonical recipes (verbatim in `game.md`, the prompt, and generated code)

**A. Shared spawn** — "when someone opens the chest, gold appears for everyone":

```ts
start() {
  onClick(this.entity, () => void game.send('openChest', { chest: this.entity }))
  game.onMessage('openChest', (data, player) => {
    game.spawn('gold-pile', { at: { x: 8, y: 0.9, z: 8 }, key: `gold-${data.chest}` })
    game.send('chestOpened', { by: player })            // green → every screen
  })
}
```

Gold exists for the clicker, the bystander, and the player who joins ten minutes later (CRDT snapshot, CSS:58). Two simultaneous clicks spawn one pile. `chest: this.entity` + the derived key make the prefab **safe to place twice** — entity ids are identical on the game and every screen, so the second chest spawns its own pile instead of silently no-oping.

**B. Seeded local spawn** — "scatter twenty rocks, different each round, same for everyone":

```ts
start() {
  game.layout('rock', (rng) => {
    const spots = []
    for (let i = 0; i < 20; i++) spots.push({ x: rng() * 14 + 1, y: 0, z: rng() * 14 + 1 })
    return spots
  })
  game.onMessage('startRound', () => game.newRound())
}
```

Zero wire traffic; a late joiner reconstructs the identical field from the tuple.

**C. Ask the game** — "10 points when a player clicks the shrine, once each":

```ts
start() {
  onClick(this.entity, () => void game.send('pray', { shrine: this.entity }))
  game.onMessage('pray', (data, player) => {
    const key = `${player}:${data.shrine}`
    if (game.state.blessed?.[key]) return { ok: false }
    game.setState({ blessed: { ...game.state.blessed, [key]: true } })
    return { ok: true, points: this.points }
  })
}
```

Identity from the connection, decision before anything slow, fact in state. (Carve-out this recipe teaches deliberately: small everyone-visible per-player *flags* are fine in `game.state`; accumulating per-player *data* — scores, inventory — belongs in `game.playerData`, per the §5 example.)

**D. Report and validate** — "shooting a wave enemy scores when the game accepts it":

```ts
start() {
  game.layout('zombie', (rng, round) => positionsFor(round, rng), { outcomes: ['hit'] })
  game.onReport('hit', (data, player) => {
    const hp = damage(data.instance, Math.min(data.amount, 25))  // clamp; return 0 to veto
    if (hp <= 0) game.send('died', { instance: data.instance })  // green → every screen
  })
  game.onMessage('died', (d) => playDeathAnimation(d.instance))  // blue: all screens agree it's dead
}
// on the weapon: game.report('hit', { instance: game.instanceOf(hitEntity), amount: 20 })
```

The loop every action game needs: players report actions, the game validates and keeps the truth, screens learn the verdict through the same `send`/`onMessage` pair — never "cheat-proof", always "the game tracks results" (CSS:118). **Green handlers live on placed entities only**: a layout clone is client-local, so an `onMessage` registered in *its* `start()` never reaches the game — the wave script lives on the placed director, and clones are identified by `instanceOf` (trap 21, extended).

### 2.4 The script template

`getScriptTemplateClass` scaffolds every new script with the two-sentence model and nothing else — no `isServer()`, no timing lore:

```ts
start() {
  // This player's screen: what they see, hear, and click.
  // Decisions that count for everyone go in green handlers:
  game.onMessage('example', (data, player) => {
    // The game: runs once, for everyone, no matter who asked.
    // Different rooms — variables don't cross between green and blue.
    // Share through game.state, the payload, or script params.
  })
}
```

---

## 3. Editor surfaces

Each surface exists because it changes what a creator does; everything else was cut.

**Inspector — the runs-on line** (merged D1 mechanism + D2 phrasing). One derived line under a script's name, only when the script uses `game`, produced by extending the `guarantees.ts` static scanner to `game.*` call sites — no declared metadata, ever:

```
● in the game, for everyone: openChest · enter Vault    ● on this player's screen: goal popup
```

Green/blue dots per the global color language. Hover: green — *"This part keeps running even when no one is looking at it."*; blue — *"This part is instant and private to each player."* It answers "will my friend see this?" before Play. No per-param chips, no trust badges. The line lives in the behavior card the branch already auto-opens on first selection (`auto-expand.ts`).

**Spawner — "Who sees the copies?"** (graft 4). The one place authority is a visible choice, because discoverability-first demands the shared path exist outside AI-written code:

```
Who sees the copies?   [ Only the player who triggers it ▾ ]
  └ Each player gets their own copies. Nothing is shared, nothing is saved.
```

Switching to **Everyone**: *"The game creates one copy and every player sees the same one. Works for one thing at a time, not swarms."* Flipping the enum edits the pool-open argument `'seeded'`→`'server'` inside the spawner script — authority stays a pool argument, never `data.json` metadata (shipped decision; CSS:166). **Scope honesty:** "Everyone" is offered only for walk-in and timer triggers, which the game can re-verify server-side; click-triggered spawns stay per-player (pointer state has no server-side truth, so a verified shared click-spawn is unbuildable today — CSS:174 names server-agreed spawns as an undesigned pattern). The server half (detect→ask→verify→server-acquire with idempotency) is an explicit design item inside G5, not a one-argument flip.

**Hierarchy in Play — provenance grouping** (graft 3). Runtime entities group under **"Shared — one real copy"** vs **"Your screen's copy"** (and "Player 2's copy"), driven by NetworkEntity presence over the existing hierarchy-provenance machinery. The axis is deliberately *ownership*, not visibility — seeded rocks are identical on every screen yet each screen owns its own; calling them "only you see" would read as a bug. This is the structural answer to the #1 wound on every platform — silent divergence — surfaced live, before a confused friend discovers it a week after publish.

**Play mode.** The ▶ Play button grows a chevron (D2's menu as the M4 spec):

```
▶ Play ▾
  ├ Play                                  ⌘P
  ├ Play with a second player             — split view; Player 2 joins as a guest
  ├ Player 2 joins late                   — Player 2 gets a "Join now" button mid-round
  └ ☐ Start like a real visit             — the game takes ~15 s to wake, like it will for
                                            your first real visitor   (persisted per project)
```

Second player = second embedded engine iframe with a guest wallet (bevy headless already asserts guest wallets, CSS:176) — never two windows on one identity. The cold-start toggle exists because preview boot is instant and production is ~15 s (CSS:21) — cold-start bugs escape otherwise. Plus: the **Game strip** in the Play HUD rendering the `serverLife` ladder — all five states (`● Game running / ◔ Game lagging / ◐ Waking… 12s / ○ Asleep / ✕ Can't reach the game server — Logs` — "server" is honest exactly here, where the creator is visibly *in* the game while the shared copy is unreachable); `game.send` queues while waking, so the first cold start is a spinner, not a mystery timeout. A crashed green handler surfaces here too, as a `[game]` error card with the script name and line — distinct from "asleep". And the **role-prefixed console** — every runtime line tagged `[game]` (green) / `[you]` / `[player 2]` (blue) via the play-hud relay, making trap 1's doubling self-explanatory in one glance.

**Storage/env UI** — see §5. LogsDrawer segments become **Build | Game | Saved data | Secrets**.

**Cut, per less-is-more:** trust badges; per-param sync chips; any "authority" column or panel; the planned `PrefabData.authority?` metadata (already overruled); `requiresSdk` gating copy remnants and non-auth badge branches (every scene is an auth scene since P0 — dead surfaces shrink, not grow); any network debugger.

---

## 4. Guardrails

Principle: **construction beats lints; lints beat warnings; warnings beat docs.** Most traps die by being unreachable through `game`; lints (in the existing pure-lint scene-check registry, gating Play with the standing "Play anyway", blockers wired to the AI "Fix these" prefill) exist as backstops for hand-rolled code. Every top trap has exactly one owner:

| # | Trap (from the friction table) | Owner |
|---|---|---|
| 1 | Code runs twice | **Construction**: consequential logic exists only in green handlers, which install server-side only. Backstop: `[game]`/`[you]` console tags. |
| 2 | Spawner copies are per-player | **Spawner enum** "Who sees the copies?" + consequence line; scene check when a seeded target carries score/outcome scripts. |
| 3 | Zones never fire in the game (CSS:23) | **`game.onEnterZone`** — detect→ask→verify is the only shape expressible. Lint: zone registration inside green code = dead code. |
| 4 | `MessageBus` kills the game (CSS:15) | **Lint blocker** `new MessageBus` → "use game.send". |
| 5 | `isServer()` false at load (CSS:13) | **Construction**: creators never call it; module forks lazily. Lint backstop on top-level calls. |
| 6 | Engine seals after load (CSS:14) | **Construction**: one envelope at module scope; handlers name-keyed, registrable anytime. Lint backstop: `registerMessages`/`defineComponent` in function bodies, dynamic `import()`. |
| 7 | Events vs state (CSS:137) | **API teaching**: green-side `send` JSDoc opens with *"A moment every screen shows once, then it's gone — late joiners never see it; if someone joining later must see it, it's game.state."* Lint heuristic on green-sent names `state/phase/seed`. |
| 8 | Late joiners / readiness lies (CSS:58) | **Construction**: state/round ride the snapshot; gating on `serverLife`, never `isStateSyncronized()`. Plus the "Player 2 joins late" one-click test. |
| 9 | Silent send drops (CSS:135-136) | **Construction**: rpc retry + seq ledger with gap repair. Dev-Play warns near 12 KB / rate budget. |
| 10 | Seed divergence (CSS:102) | **Construction**: `layout(rng, round)` cannot see players or clock. Lint: `Math.random()`/`Date.now()` inside layout/plan callbacks. |
| 11 | Preview works, production breaks (CSS:21) | **"Start like a real visit"** toggle + Saved-data reset (§5). Publish checklist line: *"Your first visitor wakes the game (~15 s). Test with 'Start like a real visit' first."* |
| 12 | Check-then-act races (CSS:59) | **Construction**: spawn `key` claimed before first await; per-name FIFO handler queue (+ self-deadlock throw). |
| 13 | Orphans & restart hygiene (CSS:60-61) | **Construction**: `for: player` auto-despawn; `onPlayerLeave` pre-wired; module re-adopts singletons/pools on boot. Dev-Play warns on synced entities outliving their creator. |
| 14 | Storage silent-false / 40-cap (CSS:154) | **Construction**: `saved`/`playerData` are checkpoint-flushed write-behind. Lint: raw `Storage` import in creator scripts. |
| 15/16 | `syncEntity` id misuse / unguarded sync (CSS:54-55) | **Construction**: unreachable — auto ids for dynamics, pinned ids only for module singletons, validators always fused. Lint: bare `syncEntity`. |
| 17 | Payload identity trust (CSS:134) | **Construction**: handler signature `(data, player)`; `player` = `context.from`, lowercased. Lint on `body.player/address/wallet`. |
| 18 | Server position blindness (CSS:23,152) | **Construction**: `onEnterZone` bakes in slack + grace; `positionOf` JSDoc states the 10 Hz/feet contract. |
| 19 | Schema/BigInt traps (CSS:104,139) | **Construction**: JSON-over-envelope; `game.now()` returns `Number`. No `Schemas` surface exists. |
| 20 | Duplicate authority (CSS §7) | **Editor check**: append-only namespace/claims registry; existing duplicate-single-instance + `mixed-pool-authority` checks extended. |
| 21 | "When spawned" strips the game half | **Existing scene check** `spawned-only-server-half`, extended to layout-pool prefabs, copy upgraded: *"This behavior needs the game, but this object only exists after someone spawns it — move the script to a placed object."* |
| 22 | Per-frame sync cost (CSS:147-158) | **Construction**: no per-frame sync verb exists; state writes per-key coalesced + size-guarded; swarms are `layout`'s job. Dev-Play traffic meter backstop. |
| 23 | "Cheat-proof" claims (CSS:118) | **Prompt copy rule**: "the game tracks results, players report actions" — never "cheat-proof" — so bespoke scripts inherit it. |
| 24 | No client→client (CSS:130-131) | **Construction**: a screen's `send` reaches only the game; the game's `send(…, {to})` *is* the relay. Lint: `{to:` in blue code. |
| 25 | Cross-color closure trap — green and blue share one `start()` but not variables | **Taught sentence** in the template + everywhere the pair appears: *"different rooms — variables don't cross; share through game.state, the payload, or params."* Lint (G2b): blue-mutated local read inside a green handler. |
| 26 | Silent name typos / handlers on layout clones | **Construction**: unknown or wrong-direction name = immediate typed error + error card; green handlers only install from placed entities (trap 21 extended to layout pools). G2b static check on unmatched names. |

Lint pack: ~9 blockers + ~5 warnings, all AST/text over `src/scripts/` only (prefab `scripts/` are trusted expert code), FP-measured against the four-game corpora before any blocker ships. **Legacy policy:** blockers apply only to scripts that import `game`; in scripts that don't (including every scene predating the module), the same rules run as warnings — a pre-`game` scene with *correct* hand-rolled auth code must never be blocked from Play for being older than the API. Legacy patterns get the **"Modernize this script"** AI prefill on the script row menu — offered, never forced.

**Preview parity:** local preview runs hammurabi-server@next, so the 40-cap and isolate limits apply locally; a future bevy-headless harness enforces no cap — the harness milestone (G1) must assert the budget numbers itself so scenes validated headless can't flood Storage and die in production.

---

## 5. Storage & EnvVar

Creators never see the words Storage or EnvVar. They see three memories with honest lifetimes plus one secret drawer:

| Surface | Creator copy (lifetime) | Backing |
|---|---|---|
| `game.state` | "until the game goes to sleep — a few minutes after the last player leaves — or you re-publish" | per-key SharedFact protectedSync |
| `game.saved` | "forever — survives restarts and re-publishing" | `serverState` → scene Storage, checkpointed |
| `game.playerData(p)` | "forever, per player" | `playerStore` → `Storage.player`, write-behind |
| `game.secret(name)` | "only the game can read it — it never reaches players' machines" | `EnvVar` |

The canonical teaching example (in `game.md` and the prompt): *scores accumulate in `game.playerData`; at round end the top ten are copied into `game.state.leaderboard` so every screen shows them* — one sentence that teaches the private/shared boundary.

**Saved data tab** (LogsDrawer): a ValueManager over the local `server-storage.json`, sub-sections World / Per-player, per-key reset, two-step "Clear all saved data." Header: *"Test data — lives on this computer. Your published world keeps its own; manage it from the world's Storage tab after publishing."* The editor **owns the file's survival**: it mirrors `node_modules/@dcl/sdk-commands/.runtime-data/server-storage.json` to `.editor/server-storage.json` and restores after a reinstall wipes node_modules — editor-side only, no toolchain change. This tab is also the trap-11 debugging tool (stale saved state resurrecting old runs). The deployed-world `StorageTab` is the production twin, relabeled with the same three group names so the model transfers.

**One-file gotcha:** runtime env values live *inside* `server-storage.json` (`runtime-env.js:128`) — the Saved-data ValueManager must exclude env keys, and "Clear all saved data" must never wipe secrets, or the masked-values promise dies from the adjacent tab.

**Secrets** (graft 8): surfaced where they matter — the **Publish flow gains a "Secret keys" step**, shown only when a script calls `game.secret()`, listing needed key names each with a provenance line derived from the call site (*"used by weather-board.ts to fetch forecasts"* — an AI-invented key with no explanation is un-fillable), and the consequence line *"Stored on the game server only. You can replace a key later, but never read it back."* — the production write-only asymmetry taught up front, so the readable-locally mental model never forms. Locally, keys are entered in that same panel and written via the preview storage endpoint (the editor never reads `.env` — standing rule); the Secrets drawer tab shows **names only, values masked**. Known limitation documented in `docs/`, never in creator UI: local preview serves `/env/:key` unauthenticated; we don't patch sdk-commands.

---

## 6. Prefab & AI integration

### The kit, completed on `game` (graft 7)

Un-shelve the four (delete `hidden: true` after rework — scenes that placed them were never broken) plus thin new facade consumers. Target: 90% of game ideas ship with zero custom code; the AI fills gaps *between* prefabs, never *inside* them.

| Prefab | Status | Creator copy |
|---|---|---|
| **Game Flow** (ex Round Loop) | rework, un-shelve | "Lobby, countdown, rounds, winners — the heartbeat of a game." Largely *is* `game.round`. |
| **Health & Respawn** (ex Player Rig) | rework, un-shelve | "Players can take damage and respawn." |
| **Waves** (ex Wave Director) | rework, un-shelve | "Waves of enemies that march set paths — everyone fights the same wave." (planned pool + outcomes inside; **paths, not chase** — player positions can't influence layout motion by construction, CSS:102, and a late joiner's chasing enemies would be unreconstructible. Chasing AI waits on the G1 waypoint spike.) |
| **Level Slots** | rework, un-shelve | "Round-scoped layout picks." |
| **Pickup** | new | "One item, first player to grab it wins it." The canonical `game.spawn`; fits the single-entity v1 limit (CSS:62). |
| **Collectible** | new | "Each player can pick this up once — gives points." One **playerData** flag + one message ("once" must survive the game's sleep — a state flag would reset, per the §5 lifetime table). The coin-collect archetype — without it the first-timer's first game falls through the kit into bespoke code. |
| **Door & Switch** | new, tiny | "A door whose open/closed everyone agrees on." One state key + one message. |
| **Points** | new (extracted from leaderboard) | "Give and track points per player." Optional "keep between visits." |
| **Teams** | new | "Split players into teams that stay balanced." |
| **Save Point** | new, tiny | "Remember each player's progress between visits." |
| **Announcer** | new, tiny | "Show a message on every player's screen." |
| **Leaderboard / Zone / Zone Authority / Server Clock / Spawner** | shipped | Leaderboard rewritten on `game` as the flagship example; server-clock dissolves into `game.now()` (volume stays placeable); Spawner stays deliberately local, + the §3 enum. |

Coverage: hangout (Door, Announcer) · race/parkour (Game Flow + Zones + Points + Leaderboard + Save Point) · wave survival (Waves + Health + Points) · coin collect (Collectible + Points) · tower defense (Waves' paths + Points — layout's ideal fit) · treasure hunt (Pickup + Points). **Struck deliberately** (2026-08-07 review round — the coverage line is a promise to creators): tag/PvP needs a server-arbitrated player-contact verb we chose not to build for v1; quiz needs a shared question/vote surface (Announcer is a toast, not a quiz board). Both can be earned back later. Guarantee chips stay **derived, never declared**: the scanner learns `game.*` — `spawn` → green "Everyone sees it"; `layout` → blue "Each player's screen builds its own — same layout for all"; `saved` → "Remembered for everyone"; `playerData` → "Remembered per player" (matching the Saved-data tab's group names).

### AI contract

- **`game.md`** (graft 6): vendored beside the generated module, mirroring the ai.md discipline — byte-capped, claims-tested, listed in the guide index. Carries the verb reference, the bang-vs-health decision example, the "what does a mid-round joiner see?" checklist, and the four §2.3 recipes **verbatim**, so generated code converges on identical shapes.
- **System prompt** (`ai-prompt.ts`) gains one ~35-line section, O(1) regardless of scene: every scene has one shared game plus a screen per player; custom multiplayer behavior uses only `game` — read `game.md` first; never `syncEntity`/`registerMessages`/`MessageBus`/`room.*`/`Storage.*`/`EnvVar.*`/`isServer()` in `src/scripts/` (lints will block the diff); the three-question decision rule (fact → `state`/`spawn`; a player asking → `send`/`onMessage`; visual-only or many copies → local entities / `layout`); identity comes from the connection, never the payload; the honesty ceiling wording; no player-to-player messaging — relay through the game.
- **Diff review** (M5, unchanged): hunks containing green calls (`onMessage`/`setState`/`spawn`/`saved`/`onEnterZone`…) get the green stripe + *"runs in the game, for everyone"*, excluded from Accept All; lint blockers disable Accept with the "Fix these" prefill.
- **Per-prefab `ai.md`s** stay the prefab-knowledge mechanism; reworked kits rewrite their consumer-facing sections in `game` vocabulary, keeping expert internals (plans, outcomes, zone re-verification) explicitly off-limits.

---

## 7. Milestones

Extends the existing roadmap (M0 done; M1/M3a done minus harness + Storage tab; M2 shipped on v1; Spawner 0.3.0 shipped). Each is independently shippable with a prove-it demo. Sequencing per the verdict: runtime + guardrails first, visibility second, kit third, split-view last — everything ships value without the step after it.

| # | Milestone | Contents | Prove it |
|---|---|---|---|
| **G1** | **Headless harness** (closes the M1 gap; gates G2's ship) | restart / spam / duplicate scenarios per stateful module; budget assertions (40-cap, 13 KB, rates) so bevy-headless parity gaps can't hide (CSS:177). **Two spikes ride along:** (a) the **waypoint verb prototype** — server writes ~1 Hz waypoint tuples keyed to `game.now()`, clients interpolate — to answer cheaply whether chasing AI can ever be shared (decision: paths-only v1, chase deferred until this spike says yes); (b) **verify synced `AvatarAttach`** (absent from the denylist, CSS:56) — if it syncs, `spawn(…, { attachTo: player })` unlocks carryables (flags, pets) later. **Known blind spot:** bevy-headless has no AvatarBase and foreign transforms sit at origin (CSS:179) — `onPlayerJoin/Leave`, `positionOf`, and zone verification are covered only by `probe-game` against hammurabi preview until that engine work lands | Kit modules pass all three scenarios; a deliberately raced double-spawn is caught by the harness, not by eyeballs; the two spikes return yes/no answers |
| **G2** | **The `game` module** | `game.ts` + `pure/gameCore.ts` with all critique + review fixes (per-key sharded state, restart wipe + `onStart`, FIFO + try/catch dispatch, **symmetric send/onMessage** with per-name direction + one-handler rule + typed unknown-name errors, forked `{to}` path + moment horizon, serverLife-gated send queue, `PlayerIdentityData`-based join/leave, awaited playerData restore, `onClick` + `instanceOf` helpers, **§11 hardening: per-player per-name rate limits, payload size/depth caps, per-player playerData cap, seed-in-serverState**); round-loop machinery ported from the shelved prefab into the module; `probe-game.mjs` (state round-trip, idempotent spawn, zone verify, late-join fast-forward, crashed-handler recovery, prefab-placed-twice). This is the largest single milestone — the composed modules it orchestrates are ~4,300 lines | The four §2.3 recipes run verbatim in a scratch scene; a recipe prefab placed twice works; `probe-game` + harness green |
| **G2b** | **AI contract + lint pack** | `game.md`; prompt section; the §4 lint pack with the legacy policy (blockers only where `game` is imported), FP-benchmarked against the four-game corpora; the review additions: unmatched send/onMessage name check, cross-color closure lint, layout-clone handler check | AI, prompted with each journey sentence, emits the recipe shape; zero blockers on the pre-`game` corpora |
| **G3** | **See the model** | Inspector runs-on line (scanner extension); `[game]`/`[you]` console prefixes; Play HUD Game strip (serverLife verbatim); Spawner "Who sees the copies?" enum; "Modernize this script" prefill | The trap-1 demo: attach a legacy both-sides script, press Play, the doubled log is self-explanatory in one glance; flipping the Spawner enum makes a crate appear for a second (manually joined) client |
| **G4** | **Memory you can touch** | Saved data drawer tab + `.editor/` mirror/restore; Secrets publish step + masked drawer tab; publish checklist cold-start line | Reproduce trap 11 (stale saved state), fix it with one per-key reset; a `game.secret`-using scene publishes with the key entered in the flow and the value never displayed again |
| **G5** | **The kit returns** (aligns with M6) | Four un-shelved reworks + seven new prefabs on `game`; leaderboard rewritten as the flagship; guarantee scanner learns `game.*`; ai.md rewrites; **the server-agreed spawn design** (the Spawner "Everyone" server half, CSS:174) | Each coverage-table game type assembled from prefabs alone, zero custom code, verified with two clients (second = external bevy client on a second wallet, pre-G6); `probe-zombie-arena` green on the reworked kit |
| **G6** | **Two people in Play** (is M4) | "Start like a real visit" toggle first (small: servers.ts delay flag — may ship with G3); then guest split view, "Player 2 joins late", Play-hierarchy "Shared — one real copy / Your screen's copy" grouping. **Risk & fallback:** two WebGPU/wasm-threads engines in one Electron window is unmeasured, and the client-side guest-wallet mechanism is unbuilt (CSS:176 only proves the headless-server test path) — fallback is the old M4 shape: a labs-flagged copy-URL second window | The silent-divergence demo: a seeded Spawner copy appears under "Only you see" on one tile while a `game.spawn` chest sits under "Everyone sees" on both; a late-joining Player 2 lands mid-round fast-forwarded |
| **G7** | **Arena + the sitting** (is M7/M8) | Arena template rebuilt on the G5 kit, complete-but-with-one-obvious-hole; rehearsed one-sitting demo | New project → prefabs → one AI prompt → linted diff → two-player Play with cold start → publish → live-tune, under 45 min, zero terminal; re-run quarterly as regression |

Standing rules carried forward: `npm run validate` is the gate, probes are the user's step, never auto-run; scene checks gate Play, never Deploy; blank scenes ship zero runtime code (modules generate on first import).

---

## 8. Explicit non-goals

We refuse to build, with the constraint or evidence that closes the door:

1. **Any authority toggle, per-entity sync checkbox, or client-authoritative mode.** Roblox's FilteringEnabled arc is the controlling precedent: an authority setting is not a creative choice, it's a way to ship an insecure or divergent world. Server authority is physics here, not configuration.
2. **Declarative Actions/Triggers, node graphs, or event-wiring UIs.** Rejected forever by product decision; behavior = TypeScript scripts with inspector params + AI prompts. The `ActionCallback`/`{self:asset-packs::Actions}` plumbing exists only for Hub round-trip fidelity; nothing new builds on it.
3. **A second, rawer messaging/state API beside `game`.** The whole bet is one object, two colors, three verbs; a visible escape hatch re-opens all 24 traps. Expert machinery (outcomes, planned pools, zone verification) stays inside prefab internals.
4. **Contract v1.1/v2 lifecycle methods (`serverStart` etc.).** They buy structural honesty at the price of migrating the runner, the parser, and every script-carrying builtin prefab (~10) before any value ships; `game` gets the same trap coverage with the v1 contract untouched. The runs-on line and diff stripes carry the teaching instead.
5. **A per-frame transform-sync verb or any "sync this entity" affordance.** Scene CRDT resends whole components over two hops with no delta/unreliable path (CSS:147-152); moving swarms belong to seed + local reconstruction. The API simply has no such verb.
6. **Upstream changes to @dcl/sdk, sdk-commands, or js-sdk-toolchain.** Standing rule; everything here is editor-side or runtime-modules. The unauthenticated local `/env` endpoint and the `delete`-on-missing drift are documented, not patched.
7. **"Cheat-proof" claims or hit-verification promises.** With planned pools there is no canonical position — validation is impossible in principle (CSS:118). The honest ceiling ("the game tracks results, players report actions") is enforced wording, not a roadmap gap.
8. **A network debugger panel, latency simulators beyond cold start, or prediction knobs.** UEFN proves the 80% case needs no networking surface at all; our leak points get honest vocabulary (the Game strip, the traffic warning) rather than instrumentation panels. Less is more: if a surface doesn't change what a creator does, it goes.
9. **Re-showing the loading screen or self-reloading on server reconnect.** One-way rule stands; `serverLife` transitions re-attach in place.
10. **Two Play windows on one identity.** Second player waits for the guest-wallet mechanism (G6) rather than shipping a lying approximation.
---

## 9. Entity references — how scripts point at other entities

Designed in its own research round (4 alternatives, adversarially reviewed against the composite/param pipeline and the engine's id semantics). This replaces every future use of the fragile name-as-id idiom; it is **not** Actions/Triggers wiring — a reference is a script *parameter*, set in the inspector like any other.

### The two mechanisms

**Singular refs (trigger→door, button→elevator): a first-class `entity` param with a pick gesture.** A script declares `public door: Entity` with a doc comment; the behavior card shows **Door — none · [Pick]** with the hint *"This zone won't open anything until you pick a door."* Pick mode: click the target in the viewport or hierarchy; hovering the filled row flashes the target. Persists the **composite entity id** — baked at build time (`EMM_DIRECT_MAPPING`), byte-identical on the game, every screen, and late joiners, so the same reference resolves everywhere with zero sync and rename is structurally free (nothing stores a name). An `Entity[]` chip-list variant covers multi-target (parser work symmetric with the shipped `PrefabRef[]` handling, `parser.ts:90-102`). The `entity` param type, prefab local-id capture/remap, and merge safety already exist in shipped code (`parser.ts:112-115`, `format.ts:518-631`) — the delta is editor UX and hygiene, not identity infrastructure.

**Collections a behavior owns (spawner→spawn points): structure, not params.** "Spawn points are my children" — drag entities under the spawner (or use its right-click **Add spawn point** verb); the card shows a live **Spawn points: 4 (its children)** count and a teaching empty state. A ~10-line `childrenOf` helper (id-sorted — deterministic on the game and every screen, per the level-slots precedent) formalizes what level-slots and sit-spot already do and retires the `"Spawn Spot"` name-prefix hack. Duplicating the parent copies the whole assembly wired correctly, for free. Caveat the helper documents: id order is *creation* order — stable across peers but not author-reorderable; ordered collections (elevator floors) use an explicit `Entity[]` param instead.

**Names stay channels, not references.** zoneBus zone names keep working unchanged (a zone id genuinely is a cross-prefab channel and reaches dynamic entities), but no new reference surface builds on names: rename-refactoring can never reach hand-written or AI-written string literals, so name refs keep today's fragility forever. Tags/marks rejected too — a new concept surface whose collection story loses to children and whose singular story is ambiguous by construction. Dynamic (runtime-spawned) targets are deliberately out of scope for params — they have no stable ids; they stay on the existing `(prefab, instanceId)`/ledger idioms.

### Hygiene requirements (all confirmed against the codebase; the last three are hard requirements from the review)

- **Delete guard:** deleting a referenced entity warns — *"2 behaviors point at this door (Trigger Zone, Wall Button). Delete anyway? They'll do nothing until you point them somewhere else."* Requires a new reverse-referrer walk (the existing `references.ts` computes forward name-sets only) and must also cover **ungroup/dissolve** paths (⇧⌘G deletes the folder entity). Afterwards the param renders a tombstone chip — **Door — ⚠ was "Lobby Door" — gone · [Pick new]** — replacing the current raw `#517 · unnamed` fallback (jargon, out).
- **Missing at runtime:** soft reference — the script no-ops and logs one sentence, never crashes, never retargets.
- **Duplicate remap:** refs between members of a duplicated selection remap to the copies; refs to outside entities keep the originals, confirmed quietly (*"Still points at the original Lobby Door."*). Must cover copy/paste `EntityClip`s (pasting after the source died currently dangles).
- **Undo heals by remap, not by id restore.** The engine cannot resurrect an entity id (generation-bump is how CRDT deletion works — `crdt_context.rs:96-138`; `history.ts:9-13` documents it). The restore path already rewrites children's `Transform.parent` via its `idAlias` map — Script-layout entity params join that same pass.
- **Load-time stale-ref sweep.** The generation table is per-session and the composite has no tombstone ledger, so delete → save → reopen can hand the same id number to a *new* entity — the one path to a silent retarget. On scene open, any entity param whose id is absent from the composite is tombstoned. Non-negotiable; without it the mechanism ships its own forbidden failure mode.
- **`label` capture needs a `mergeLayout` fix** — today the merge rebuilds params from the fresh parse and drops extra fields (`parser.ts:400-404`), so the tombstone's "was 'Lobby Door'" text would die on the first re-parse. Either carry a designated advisory field through the merge, or store labels outside the layout.
- **Pool clones can't hold authored refs yet:** captured prefab layouts cleared external refs at capture, and internal `{entity:localId}` markers currently flow verbatim into constructors. Until the runtime cloner learns the remap, spawnables codegen lints entity params the way it already lints action params (`codegen.ts:365-371`).

### AI authoring

The assistant refers to entities by name in its plan; the request executor resolves name → composite id **at write time** and stores the id. This **reverses a shipped decision** (`params.ts:73-74` currently refuses entity params as inspector-only) — reversed knowingly. Ambiguous names are **refused with the reason** (the `resolvePrefabRef` precedent), never first-matched as `resolveEntityRef` does today; the creator resolves in the inspector. Prompt docs steer generated scripts to `Entity` params over name literals.

### Build order (slots alongside the G-track; steps 1–2 can precede G2)

1. `childrenOf` formalization + empty states + **Add spawn point** verbs + spawner de-hacked (days).
2. Hygiene on the existing dropdown: delete guard (reverse-ref walk incl. ungroup), tombstone chip, load-time sweep, unset teaching copy, scene-health line (week).
3. Pick gesture: viewport pick mode (reuses selection raycast), hierarchy pick, hover-flash (week).
4. `entityList`: parser + chip list + merge + prefab-capture list markers (days).
5. Duplicate copied-set remap + undo ref-healing + regression tests (week).
6. AI executor: name→id resolution with refuse-on-ambiguity + prompt steering (days).

Runner, SDK, and wire formats: untouched.

---

## 10. Decisions log — 2026-08-07 creator-experience review round

A seven-agent review built two games on paper with the §2 API, audited it as a public SDK surface, ran a 20-genre coverage matrix, and audited the vocabulary. Verified findings live in `docs/MULTIPLAYER-DX-REVIEW.md`. Product decisions taken with the owner:

1. **Chase AI: paths now, waypoint spike in G1.** Waves v1 is path-based (honest, deterministic, late-join safe; tower defense becomes a claimed win). The ~1 Hz server-waypoint verb is prototyped in the G1 harness before any commitment to shared chasing enemies.
2. **Screens learn through the same pair — symmetric `send`/`onMessage`.** No `announce/onAnnounce`, no `onOutcome`, no `myData`: the game's side of `send` tells screens (broadcast or `{to}`), blue `onMessage` hears the game. One pair, both directions, per-name direction, one handler per name. The HUD pattern: green sends `score` to the player on change and on join.
3. **No player-vs-player verb in v1.** Tag/hide-and-seek/murder-mystery are struck from the coverage claims rather than half-served; revisit after G5.
4. **Naming stays `send`/`onMessage`.** Familiarity and googleability win; the §1 vocabulary table drops its ban on "message" for the API surface (copy still says "ask the game" for the blue→green direction).

Applied in the same round: recipes rewritten to be safe-to-place-twice (entity in payload, derived keys); `instanceOf` added so laid-out copies are addressable; typo'd names fail loudly; the closure trap (25) and layout-clone handler trap (26) added with owners; sleep named in every state-lifetime line; the hierarchy axis recast as ownership ("Shared — one real copy" vs "Your screen's copy"); the bang mantra replaced with a translatable sentence.

---

## 11. Security model & anti-cheat

Three layers, from strongest to weakest. The doctrine: **make cheating structurally impossible where the engine allows it, validate where it doesn't, and say honestly where validation ends.** No surface may ever claim "cheat-proof" (non-goal 7).

### 11.1 Robust by construction (a hacked client has no verb)

- **Identity is the transport's, never the payload's.** `player` in every green handler is the wallet from the comms envelope (`context.from`, lowercased, CSS:134) — LiveKit tokens are minted by comms-gatekeeper, and clients drop any non-player packet not from the literal `authoritative-server` identity (CSS:17). Impersonating another player or the game is blocked below the SDK.
- **Shared state has exactly one writer.** Every synced entity the module creates carries a refuse-all or clamping validator (`protectedSync`, fused at creation — no unguarded frame); client CRDT writes are dry-run server-side and force-corrected on rejection (`CRDT_AUTHORITATIVE`, CSS:17). `setState`/`spawn`/`saved`/`playerData` exist only in green code. A modified client can *ask* anything and *change* nothing.
- **No peer channel.** A screen's `send` reaches only the game (SFU-routed, CSS:130-131); screens never hear screens — no client-side poisoning, no gossip cheats.
- **Targeted messages can't be snooped.** `{to}` is `destination_identities` — SFU-enforced on LiveKit; non-targets never receive the packet (CSS:132).
- **Races aren't exploits.** FIFO awaited handlers + idempotency keys claimed before the first await (CSS:59) mean double-click/double-join dupes are structurally dead.
- **Secrets never ship.** `game.secret` reads EnvVar server-side; `serverState` throws on any client (CSS:118). The Secrets UI is write-only by design.

### 11.2 Validation duties the module owns (added to G2)

- **Per-player, per-name rate limits** inside the module: default N msgs/s per name per player, dropped-with-error-card beyond, tunable per handler. Hammurabi's transport cap (300/s/peer, CSS:21) is a backstop, and bevy-headless has **no** per-peer inbound limit (CSS:179) — the module must own its own budget. This also protects the FIFO queue: a spammer must not be able to wedge a name's queue for everyone (per-player queue cap, oldest-dropped).
- **Payload hygiene before dispatch:** JSON only, size-capped (~4 KB) and depth-capped; non-conforming payloads never reach a handler. A crash from malformed input is already contained (try/catch dispatch), but validation keeps it from being a tool.
- **Payloads are claims, not facts.** The recipes carry entity ids in payloads (`data.chest`); the teaching rule ships beside them: *validate every claim against server truth* — is `data.chest` a real placed chest, is `data.instance` alive in this round's plan, is the amount within the phase-pinned config clamp (the `wave-director` precedent, CSS:116). `game.md` carries a validator checklist.
- **Position claims get the zone treatment.** All position-dependent decisions run through `onEnterZone`/`positionOf` server-side re-verification (1 m slack, 4 Hz, grace — CSS:31). Nothing in the API lets a creator accept a client-reported position as truth.
- **Seed secrecy:** the *next* round's seed is drawn into `serverState` and published only at phase start (the CSS:118 pattern) — otherwise any client precomputes the layout and "finds" every chest instantly.
- **Per-player storage caps:** `playerData` writes are size-capped (~8 KB/player) and checkpointed — one player must not be able to bloat the 256 MB isolate or the Storage budget (CSS:154).

### 11.3 The honest ceiling (structural — say it, don't paper over it)

- **All logic is public.** The same bundle ships to every client; green code is readable by anyone who downloads the scene. Security lives in server-held *values* (secrets, seeds, ledgers), never in obscure *code*.
- **Movement is client-authoritative.** Avatars broadcast their own positions (~10 Hz, CSS:152); the platform has no server-side physics for players. Teleport/speed cheating can only be *bounded* (plausibility checks in zone-authority — max-speed flagging is a G5 option), never prevented. Editor-side we change nothing: this is a platform property.
- **Client-simulated entities have no canonical truth.** For layout/planned pools there is no server position, so hit validation is impossible *in principle* (CSS:118). The ceiling is rate + clamp + server-tracked results. Copy rule everywhere: *"the game tracks results, players report actions."*
- **Alt accounts and collusion are out of scope.** Wallets are free; nothing at scene level prevents a player bringing friends or second identities.

### 11.4 Platform-level items (tracked, not ours to fix editor-side)

From bevy-explorer's isolation audit (`HEADLESS_SECURITY_ISOLATION.md`) — relevant only if/when we self-host bevy-headless for Worlds; production hammurabi has its own hardening: S1 `op_read_file` SSRF (High), S3 shared-process blast radius (High), S4 room `access_token` readable by scene JS — a scene could exfiltrate its own server token and reconnect as `authoritative-server` from anywhere (Med; the fix is engine-side redaction), S2 permission defaults, S5 shared guest wallet. The G1 harness runs against this stack — its budget assertions double as regression checks for the caps this section depends on. No upstream PRs (standing rule); we track and re-verify at each bevy sync.

---

## 12. Decisions from the worked-game round — 2026-08-07 (flagtag + towerofmadness)

Two real shipped games (flagtag: 26,988 LOC; towerofmadness: ~7,765 hand-written LOC) were rebuilt on paper as Studio creator sessions (`docs/MULTIPLAYER-GAME-WALKTHROUGHS.md`), then verified against this plan. Result: ~70% of flagtag and ~95% of towerofmadness's player-visible game assemble from the kit plus ~135/~190 lines of creator code. The exercise surfaced six API/kit gaps the reviews missed, resolved as follows:

1. **`game.onRoundStart` is green.** Both games needed it on both sides (state reset vs camera fly-up); the rule "the fork is which callback you write" cannot survive a dual-sided callback. Green owns it; screens react to round changes via `game.onStateChange` (the round tuple rides state) or a told message. The docs and recipes say so explicitly.
2. **`game.round.number` exists** — a monotonic counter in the round tuple. Real games key per-round validity on it ("was this attempt from this round?"); making creators derive it from `seed` invites bugs. One field, pinned in §2.2.
3. **Game Flow gains a script-ended-round mode (G5 scope).** Any game whose round ends on a condition (score cap, accelerating clock, last-standing) fights the fixed timer. The mode: round length becomes a ceiling; a script calling `game.newRound()` owns the end; Game Flow owns podium/countdown UI and double-fire prevention either way.
4. **The aggregate-board idiom is documented, and board prefabs get a source key.** `playerData` is deliberately non-enumerable, so all-time/season boards exist only via incremental aggregation: fold results into a `game.saved` top-N at round end, copy to a `game.state` key (the towerofmadness `boards.ts` shape, ~14 pure lines — it goes in `game.md` verbatim). Leaderboard (and Game Flow's podium) read a configurable state key. Known sub-gap, documented honestly: no green-side display-name resolution for offline wallets — boards render addresses for players not connected.
5. **Multi-variant `layout` goes on the v1.1 list.** One plan spanning several prefabs (the tower's ten chunk kinds) forces hand-rolling a PRNG outside the per-pool rng streams — safe but unassisted, at the edge of trap 10. `layout(['a','b',…], planFn)` or a documented cross-pool derived-stream idiom.
6. **Zone→damage routing is explicit G5 scope.** The Trigger-Zone-hurts-you archetype (flagtag's moat) needs specified wiring between Trigger Zone and Health & Respawn (damage-on-enter config over the zone-name channel) — it was in neither prefab's scope, and "drowning: zero code" depends on it.

The strains the walkthroughs declare honestly — no proximity steal (PvP verb struck), no chasing ghost (waypoint spike pending), no dodgeable projectiles (expert outcomes machinery), no server-side avatar-appearance podium (no profile ask headless), camera work untouched by `game.*` — are the intended v1 shape, each priced with its unlock (B2 spikes, post-G5 verbs, platform profile ask).

---

## 13. Simplified shipping plan — 2026-08-07 (supersedes §7's G-numbering for execution)

Owner directive after the worked-game round: minimal new code, maintainable, shipped in small PRs. A usage audit of the two walkthroughs against the full §2.2 surface produced the split (full detail: `docs/MULTIPLAYER-SHIPPING-PLAN.md`):

**The key fact:** the runtime-modules kit (~4,300 lines) is already shipped and tested. The NEW code for all of v1 is **~6,400 lines across 14 PRs (~⅓ tests/harness), none over ~600 lines**, in three phases:

- **Phase 1 — the facade (PRs 1–9):** harness → `game` skeleton + `now` → send/onMessage with FIFO/rate-limits/plain broadcast → state sharding → boot/saved/playerData → players/zones/positions/every/onClick → rounds + layout → template flip + recipes (closes G2) → lints + `game.md` + AI prompt + diff stripe. PRs 2–7 are opt-in-by-import — nothing creator-visible until PR 8 flips the template, so any of them reverts without breaking a scene.
- **Phase 2 — see the model (PRs 10–12):** runs-on line; ref hygiene + `childrenOf` (delete guard, tombstone, non-negotiable load-time stale sweep); console tags + Game strip + "Start like a real visit".
- **Phase 3 — memory (PRs 13–14):** Saved-data tab + `.editor/` mirror; `game.secret` + Secrets publish step + masked tab. **Closes Tranche 1: both walkthrough games assemble end-to-end, zero terminal.**

**v1 does NOT contain** (reviewers reject on sight; each deferral's reopened trap has a named cheap guard in the shipping plan): `spawn/despawn/ownedBy` (only the Pickup prefab wanted it), `report/onReport/instanceOf` (neither game used them — hit-shaped asks ride `onMessage` with clamp-in-handler, which is exactly what both games did), the **sequenced ledger** for green→screens (v1 broadcast is plain; moments fade, facts ride state; the codec-per-name seam makes the ledger a drop-in upgrade), `every` deadline persistence (both games' schedules are stateless samplers; durable deadlines are deadline-as-state), the Spawner enum, the Pick gesture/`entityList`/AI name→id (dropdown EntityPicker suffices; PR 11 ships the hygiene), split view (external second client is the fallback), and the B2 spikes (they answer questions only Tranche-2 surface asks).

**Tranche 2** (uncommitted, ordered): spikes + spawn family → report/outcomes + server-agreed spawn + Spawner enum → kit prefabs on `game` (several PRs) → ledger upgrade → pick gesture → split view → Arena sitting.

The acceptance test is unchanged and now sharper: **PR 8 must run both games' custom-code halves verbatim; PR 14 must publish them end-to-end.**

---

## 14. The three-tier creator model — 2026-08-08 (code AND no-code; kit moves into Tranche 1)

Owner question: "you need to code everything — how does Roblox solve this? We need both; maybe prefabs are the answer." Verdict after platform research + a no-code audit of every coverage game (full doc: `docs/MULTIPLAYER-TIERS.md`): **the owner is right, with one correction — the calendar.** Roblox's no-code tier is toolbox models (someone else's Luau inside, Attributes as knobs) + templates; its ceiling is that any *game rule* forces code. Our prefab kit is the same shape with a higher ceiling (rounds, scoring, persistence, server-authoritative damage are first-party Tier-0 config). What was wrong: the §13 order shipped code-only for the whole v1 period. Changes:

**The tiers (creator vocabulary, into §1):** **Tier 0 — Place it** (kit prefabs + inspector config + Pick + names). **Tier 1 — Ask for it** (AI prompt → reviewed diff; the sanctioned answer wherever config ends — never a wiring UI). **Tier 2 — Script it** (the `game` API). No format cliff: a prefab IS a Tier-2 script with params; a diff IS a script you didn't type — graduating means opening a file that already existed (vs UEFN's rewrite-in-Verse and Horizon's migrate-off-CodeBlocks cliffs).

**The composition doctrine (into §6, reviewer-enforced): the one-intrinsic-verb rule.** A prefab card configures exactly one intrinsic verb — magnitudes, enums of standard occasions, one-way pointers at channels (zone names) or keys (board keys), entity Picks. Never event→action rows, never a dropdown of verbs targeting other entities. Rulings: Leaderboard source key = config (pure reader — made real by **Points auto-publishing a saved top-N to a well-known board key**, resolving §12 #4); Collectible "gives points" = config (intrinsic occasion + magnitude over the kit's Points channel); **zone damage moves from Trigger Zone to Health & Respawn** ("Hazard zones: Moat (100)") — damage is Health's intrinsic verb, detection is the zone's, amending §12 #6; "zone entered → give points" as Points config = rejected (trigger-slot accretion) — its honest replacement is the **new Finish Line prefab** (verified once-per-round entry; enum: record best time / award N points), which alone closes race and tower-lite at Tier 0.

**§13 amendments:** (a) **Core kit interleaves into Tranche 1** — K1 Door&Switch (floor PR 4), K2 Leaderboard+source key (PR 4/5), K3 Points+auto board key (PR 5), K4 Collectible playerData-backed + resets-each-round (PR 5/6), K5 Announcer+`when` enum (PR 3/6/7), K6 Health&Respawn+hazard zones+die-below-height (PR 6), K7 Finish Line (PR 6/7), K8 Game Flow (PR 7) — ~8 small PRs via `add-builtin-prefab` starting after PR 7. Stays Tranche 2 honestly: Pickup (needs `spawn`), Waves, Level Slots, Teams, Save Point, Spawner enum. (b) **New acceptance row:** hangout, coin collect, and race assemble from prefabs alone — zero scripts, zero prompts, second client verified. (c) **Starter templates ship with Tranche 1 for free:** the acceptance artifacts ("Coin Rush", "Race Day") become new-project starter games, complete-but-with-one-obvious-hole; Arena stays T2-f. (d) Library cards gain a hand-authored "Works with" family line; teaching empty states at prefab seams; every doctrine wall carries its sanctioned copyable prompt sentence; the §6 coverage table labels each row's tier; **strike the tower-defense row** until Waves' paths exist (same honesty rule as tag/quiz).

**Refused, restated:** no event-wiring UI (UEFN is the cautionary tale, and the audit found only two mechanics across eight builds that genuinely want wiring — both belong to Tiers 1–2); no open toolbox of strangers' scripted models (curated first-party family instead); no visual-scripting mid-tier (prompt-to-code is the mid-tier); no fake physics tier.

**The creator story:** you never have to code — and you never hit a wall where your work stops counting. Place pieces and set options; ask the assistant when the pieces run out; and if you ever open the code, your whole game is already there in one small API — because the pieces and the assistant were using it all along.

---

## 15. Final copy pack + UX cuts — 2026-08-08 (authoritative wording)

A UX/copy review audited every designed string against the editor's shipped voice and walked five creator journeys for dead ends. **`docs/MULTIPLAYER-COPY-PACK.md` is now the authoritative source for all creator-facing strings** — where it conflicts with copy earlier in this plan, the copy pack wins. Highlights: "tell the screens" → "the game tells every player"; the only sanctioned server noun is **Multiplayer Server**; shelf names simplify to "Shared — one copy for everyone" / "Your own copy"; tier names are **Place it / Ask the assistant / Script it**; the `◔ Game lagging` strip state is cut (no creator verb exists); the template card keeps one sentence; every guard/empty state/strip state must follow the house pattern — *rule + exact next gesture, one sentence each* — and anything that can't name a next gesture is a cut candidate. A migration list covers the eight shipped strings that now break vocabulary (rides PR 12 + K-track sweeps). Part 3 of the copy pack is the implementation kickoff: PR 1 harness day-by-day, the childrenOf parallel quick win, serial order for PRs 1–5 with a parallel UI track, and the first demo checkpoint (after PR 3: two clients, one 5-line script, both consoles print the same message with matching game.now() timestamps).
