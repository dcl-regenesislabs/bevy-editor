# Multiplayer shipping plan — simplified after the worked-game round

> Supersedes the §7 G-track numbering for execution (traceability kept per PR). Produced 2026-08-07 from the flagtag/towerofmadness usage audit. Companion: docs/MULTIPLAYER-DX-PLAN.md (§13 summary), docs/MULTIPLAYER-GAME-WALKTHROUGHS.md.

# Usage audit & cut list — `game.*` × the two real games

Sources: MULTIPLAYER-DX-PLAN.md §2–§7/§10/§12, MULTIPLAYER-GAME-WALKTHROUGHS.md (W1 = flagtag, W2 = towerofmadness), MULTIPLAYER-BUILD-BOOK.md (mapping table + B1–B26).

## 1. Evidence table — every verb and surface

Effort = estimated NEW facade/editor code only (shipped runtime-modules are free). S ≤1d, M 2–4d, L 1–2wk.

| Verb / surface | W1 flagtag | W2 tower | Shipped backing | NEW code | Verdict |
|---|---|---|---|---|---|
| `send`/`onMessage` blue→green | `takeFlag` | `finish` | rpc.ts (134) + serverLife (306) | **L→M** (B4 minus ledger) | **CORE** |
| `send` green→screens (broadcast) | `announce`, `flagTaken`, `flagDropped`, `lightningWarning`, `struck` | `announce`, `roundOver` | outcomes ledger (373+156) *proposed* | L as ledger, **S as plain broadcast** | **CORE, simplified** (see §3) |
| `send {to}` targeted | — | `warned {to:p}` | rpc replies already targeted | S (plain targeted path) | CORE |
| Rate limits, FIFO, payload caps (B5) | invisible, both | invisible, both | — (bevy-headless has no inbound cap) | S | **CORE — never defer** |
| `state`/`setState`/`onStateChange` | `flag`, `leaderboard` | `clock`, `finishers`, 2 boards | protectedSync (228) | M (B6 sharding) | **CORE** |
| `onStart` + boot wipe | reset | init state/boards | serverLife + protectedSync seal | M (B7) | **CORE** (restart honesty is safety) |
| serverLife send-queue gate (B8) | cold-start test | cold-start test | serverLife (shipped) | S | **CORE** |
| `saved` | needed for all-time board (W1 correction #1) | `bestTimes`, `season` | serverState (106) | S | **CORE** |
| `playerData` | hold totals, points | points, best | playerStore (244) | M (sync facade + await restore) | **CORE** |
| `now` | pervasive | pervasive (clock math) | timeSync (130) | ~0 (re-export) | **CORE** |
| `every(n)` (plain) | 2× `every(1)` | `every(1)`, 2× `every(0.5)` | schedule.interval (103) | S | **CORE** |
| `every` deadline **persistence** | never (all samplers stateless) | never (clock is deadline-as-state in `game.state`, by design) | serverState | S | **CUT/FOLD** |
| `onEnterZone` | Moat | Start gate | zoneBus (127) + zone-authority prefab | M (absorb dance) | **CORE** |
| `onExitZone` | — | — | same | ~free with above | keep (symmetric, no extra mechanism) |
| `positionOf` (server path) | steal check, drop point | finish height, both AI prompts | playerPositions client-only → new path | M | **CORE** |
| `onPlayerJoin/Leave` | leave → flag drop | prompt-1 diff (join+leave) | none (new PlayerIdentityData watcher) | M | **CORE** (leave also feeds playerData flush) |
| `newRound`/`round`/`round.number`/`onRoundStart` | onRoundStart (green reset) | newRound, round.number, round tuple, fly-up | shelved Round Loop + schedule + rng | M (port) | **CORE** (both games are round games; §12 #1–#3) |
| `layout` | — | **the showcase** — 11 pools | spawner (908) + rng (49) | M (facade; map no-outcomes layout to `'seeded'`) | **CORE** |
| `onClick` | flag click | — | — | S | CORE (cheap, in recipe A/C) |
| `childrenOf` | via Health prefab | clock faces | — | S (B18) | CORE-adjacent (ships anytime) |
| `spawn`/`despawn`/`ownedBy` | **only via Pickup prefab** — zero custom-code use | never | spawner `'server'` mode (shipped) | M (key claim + ownedBy wiring) | **DEFER** to kit phase |
| `instanceOf` | never | never | `spawnedFrom` (shipped) | S | **DEFER** (pairs with report) |
| `report`/`onReport` | never (lightning = `every`+send; steal = onMessage) | never (finish = onMessage) | outcomes — verbatim | S rename | **DEFER** (Waves-only consumer) |
| `secret` | prompt 2 only (Discord) | never | raw EnvVar | S wrapper + **M+M UI** (B21/B22 halves) | **DEFER** to memory phase |
| Multi-variant layout | — | wished, hand-rolled around | — | M | already v1.1 (§12 #5) — stays deferred |

Editor surfaces (§3):

| Surface | W1 | W2 | Step | Verdict |
|---|---|---|---|---|
| Console `[game]`/`[you]` tags + Game strip | §2.5 | step 9 | B16 M | **Phase 2** — the minimum visibility both sessions leaned on |
| "Start like a real visit" | §2.5 | step 9 | B24 S | **Phase 2** (trap 11) |
| Runs-on line | every script | every script | B15 M | **Phase 2** (teaching, not safety) |
| Saved data tab + mirror | — | step 10 (clear test boards) | B21 M | Phase 3 |
| Secrets publish step + masked tab | prompt 2 | — | B22 M | Phase 3 (with `secret`) |
| Spawner "Who sees the copies?" | **struck — no Spawner placed** | no Spawner | B17 S | **DEFER** to kit phase (needs the server-agreed-spawn design anyway) |
| Pick gesture, `entityList`, AI name→id | uses [Pick] | uses [Pick] | B20 L | **DEFER** — the existing dropdown EntityPicker covers phases 1–3; B19 hygiene (delete guard, tombstone, stale sweep) stays, it's the "never ship without" list |
| Split view / late-join / Play-hierarchy grouping | verification only | verification only | B25 L | Last phase — external second client is the shipped fallback (B23's own verify uses it) |
| AI diff green stripe | both prompts | both prompts | rides B13 | with lints, Phase 1 |

## 2. Deferrals — trap reopened + cheap interim guard

| Deferral | Trap(s) reopened | Interim guard (cheap) |
|---|---|---|
| **Green→screens seq ledger → plain broadcast** | Trap 9, *broadcast half only* — a dropped moment is a missed toast/popup, never wrong game state | Every fact in both games rides `state` (CRDT is reliable + snapshot); blue→green keeps full rpc retry. Guards: trap-7 lint heuristic (state-shaped names in sends), dev-Play 13 KB/rate warn, "moments fade" JSDoc. §2.1's codec-per-name commitment already makes the ledger a drop-in upgrade — no API change |
| `spawn`/`despawn`/`ownedBy` | Traps 2/12/13 — only if creators hand-roll | Verb absent ⇒ unmisusable; `bare syncEntity` + `new MessageBus` lints (text-level, ship in Phase 1) block the hand-roll; Spawner stays deliberately local. Recipe A moves to the kit phase's `game.md` rev |
| `report`/`onReport` + `instanceOf` | None new — outcomes stays shipped code inside future Waves internals | Hit-shaped asks ride `onMessage` with clamp-in-handler (exactly what both games did); `game.md` validator checklist carries the discipline; layout-clone-handler lint (trap 26) still ships |
| `every` deadline persistence | Trap 13 partial (schedule dies on restart) | Both games' schedules are stateless samplers; the one durable deadline (W2 clock) is deadline-as-state in `game.state` — document that idiom in `game.md`, JSDoc: "runs while the game is awake" |
| `secret` + B22 | None — no verb, nothing leaks | `raw EnvVar import` lint (warning) ships Phase 1; W1's Discord prompt is the only consumer across both games |
| Spawner enum (B17) | Trap 2 discoverability | Existing seeded-target-carries-score scene check; consequence line already on the card |
| B20 (pick UX, entityList, AI resolution) | §9 fragility partial | B19's delete guard + tombstone + load-time stale sweep ship early (the plan calls the sweep non-negotiable); dropdown picker remains functional |
| B2 spikes | none — they answer questions only deferred surface asks (chase AI, carryables) | run them in the phase that builds Waves/Pickup |

**Never defer** (core-unsafe without): B5 rate limits + FIFO + payload caps; protectedSync refuse-all fusion; identity-from-connection; B7 boot wipe/re-adopt; serverLife send gating; seed-in-serverState; lint pack blockers (B13) — they're the backstop for every verb the facade doesn't have yet.

## 3. B-steps serving deferred surface → later phases

- **B2** (spikes) → Phase 4 · **B11** shrinks to layout+onClick, its spawn/report/instanceOf half → Phase 4 · **B17** → Phase 4 · **B20** → Phase 4 · **B22** → Phase 3 · **B25/B26** → Phase 5 · B4's ledger/moment-horizon/`{to}`-fork internals → Phase 4 (upgrade behind the codec seam).
- Everything else (B1, B3–B10, B11-lite, B12, B13, B14, B15, B16, B18, B19, B21, B23-subset, B24) stays as phased below.

## 4. Proposed phase boundaries

| Phase | Ships | Contents (B-steps) | Standalone value proven by |
|---|---|---|---|
| **P1 — The facade** | `game` core: send/onMessage (plain broadcast + targeted), state, onStart+boot, saved/playerData, join/leave, zones, positionOf, every (non-persistent), now, rounds, layout, onClick; generation + template; lint pack + `game.md` + AI prompt + diff stripe | B1 (core scenarios), B3, B4-lite, **B5**, B6, B7, B8, B9 (minus secret), B10, B11-lite, B12, B13, B14 | Both walkthroughs' custom scripts (~135 + ~190 lines) run verbatim minus the Discord prompt; probe-game + harness green |
| **P2 — See the model** | `[game]`/`[you]` console, Game strip, runs-on line, cold-start toggle; §9 hygiene | B15, B16, B24, B18, B19 | Trap-1 doubled-log demo; cold-start send-queue demo |
| **P3 — Memory + core kit** | Saved data tab + mirror; `game.secret` + Secrets step; the kit subset both games placed: Game Flow (+ script-ended-round mode), Points, Leaderboard (+ source key), Door & Switch, Collectible (playerData-backed), Announcer, Health & Respawn (+ zone damage routing) | B21, secret+B22, B23-subset | Both walkthroughs assemble end-to-end incl. publish with a secret; race/coin-collect/hangout coverage rows |
| **P4 — The rest of the surface** | `spawn`/`despawn`/`ownedBy` + Pickup; `report`/`onReport`/`instanceOf` + Waves + Level Slots; Teams, Save Point; seq-ledger upgrade for green→screens; Spawner enum + server-agreed-spawn design; pick gesture/entityList/AI refs; spikes | B2, B11-rest, B17, B20, B23-rest | Treasure-hunt/wave-survival/tower-defense coverage rows; recipe A & D run verbatim |
| **P5 — Two people in Play** | Guest split view, late join, Play-hierarchy ownership grouping; Arena + the sitting | B25, B26 | Silent-divergence demo; the 45-min rehearsed sitting |

Net effect: Phase 1 drops one L (ledger) to S, one L (B11) to M, and pushes ~5 M/L steps (B2, B17, B20, B22, B25) out of the critical path, while every safety mechanism (B5, B7, refuse-all sync, lints) stays in P1. The two real games are the acceptance test for P1–P3; nothing either game touched lands later than P3.
---

# Multiplayer DX — PR-by-PR shipping plan (Tranche 1: P1–P3, 14 PRs)

**Standing notes (apply to every PR, stated once):**

- **Carried-module sync.** Every PR that touches `packages/desktop/runtime-modules/game.ts` (PRs 2–7, 14) must run `node scripts/sync-runtime-modules.mjs` and commit the byte-identical per-prefab copies; `scripts/sync-runtime-modules.test.mjs` fails the build otherwise. Not repeated below.
- **One module.** All facade code lands in `packages/desktop/runtime-modules/game.ts` + `packages/desktop/runtime-modules/pure/gameCore.ts` (pure, SDK-free, unit-tested from `packages/desktop/src/runtime-pure.test.ts`). No PR may add a third runtime file; reviewers reject any new `runtime-modules/*.ts`.
- **Exposure model = revert safety.** PRs 2–7 are opt-in-by-import: nothing in the editor scaffolds, mentions, or lints `game` until PR 8 flips the script template. Reverting any of PRs 2–7 breaks zero shipped scenes. PR 8 is the single "creators see it" switch.
- **probe-game.mjs grows incrementally.** Created in PR 3 at `packages/desktop/validate/probe-game.mjs`; each later runtime PR adds its legs to the same file. `npm run validate` is the gate; probes are the user's manual step (never auto-run).

---

## Phase 1 — the facade

### PR 1 — Harness scenario runner *(B1)*
- **Intent:** headless multi-isolate test rig so every facade PR can carry a test leg.
- **Files:** `packages/desktop/validate/harness/run.mjs` (new), `packages/desktop/validate/harness/scenarios/{restart,spam,duplicate,singleton}.mjs` (new), `packages/desktop/validate/fixtures/harness-scene/` (new fixture).
- **New lines:** ~550 (runner ~200, budget tracker ~80, 4 scenarios ~180, fixture ~90).
- **Reuses:** the bevy-headless boot path already exercised by `probe-auth-server.mjs`; adds N-client isolates, scripted ticks, `restartServer()`, and harness-owned budget assertions (40 Storage calls, 13 KB msg, 300/s/peer — bevy-headless enforces none).
- **Verify:** self-verifying — a fixture script with a deliberate check-then-act double-spawn fails `duplicate.mjs`; fixing it with a key turns it green. Each scenario declares which stack it trusts (bevy vs hammurabi) so join/leave/position runs can't lie.
- **Creator payoff:** none — **infrastructure, justified:** it is the merge gate for every PR below and the only pure-infra PR in the tranche.
- **Revert:** dev-only; ships nothing.

### PR 2 — `game` skeleton, singleton, generation path, `game.now()` *(B3 + the generation slice of B12)*
- **Intent:** the one module exists, generates into scenes on import, and ships its first (free) verb.
- **Files:** `packages/desktop/runtime-modules/game.ts` (new), `packages/desktop/runtime-modules/pure/gameCore.ts` (new), `packages/ui/src/gameconfig/codegen.ts` (carry-set + generate `src/scripts/runtime/game.ts` on first import), `scripts/sync-runtime-modules.mjs` (list entry), `packages/desktop/src/runtime-pure.test.ts` (gameCore tests).
- **New lines:** ~370.
- **Reuses:** `createRpc('game')` registered once at module scope, `timeSync.getServerTime` (`now()` is a `Number()`-coerced re-export), the `globalThis.__dclGame_v1` shape-probed singleton convention from `zoneBus`/`serverState`. Adds: the lazy role fork on first tick (`outcomes.ts:37-42` idiom), the single exported `game` surface.
- **Verify:** gameCore unit tests; harness `singleton.mjs` — two prefab copies + creator copy resolve to one instance (logged identity).
- **Creator payoff:** a script can `import { game }` and use `game.now()` — one shared clock on every screen without touching runtime-modules.
- **Revert:** opt-in-by-import; no editor surface references it.

### PR 3 — `send`/`onMessage` dispatcher + §11 hardening *(B4-lite + B5)*
- **Intent:** the whole ask/tell mechanism — per-name direction registry, one-handler rule, per-name awaited FIFO, typed unknown-name errors, **plain** broadcast + plain targeted `{to}` (no ledger — see deferred list), rate limits and payload caps.
- **Files:** `pure/gameCore.ts` (dispatch tables, FIFO queues, token bucket, size/depth caps), `game.ts` (envelope wiring both directions), `harness/scenarios/spam.mjs` (extend), `packages/desktop/validate/probe-game.mjs` (new, first legs).
- **New lines:** ~600 — at the cap; if review grows it, B5's limiter splits out cleanly as its own ~150-line PR. B5 never ships later than B4: bevy-headless has no inbound cap, so spam scenarios can wedge the FIFO until it lands.
- **Reuses:** rpc correlation/retry/targeted-reply verbatim; the identity-from-`context.from` doctrine. Adds: FIFO-awaited try/catch dispatch replacing rpc's detached async; per-player per-name token bucket checked before dispatch.
- **Verify:** `spam.mjs` — handler throwing on entry 3/10 still processes 4–10 in order; 50 msg/s client throttled while a second client's same-name messages land; typo'd `game.send('opnChest')` rejects naming the nearest real name.
- **Creator payoff:** ask-the-game works — a clicked entity can `await game.send('takeFlag')` and one green handler decides for everyone (flagtag's core verb).
- **Revert:** opt-in-by-import.

### PR 4 — `game.state` / `setState` / `onStateChange` *(B6)*
- **Intent:** shared facts as per-key `SharedFact` sharded entities, refuse-all guarded, late-joiners free.
- **Files:** `game.ts` (fact creation via `protectSynced`, client mirror + change events), `pure/gameCore.ts` (dirty-map coalescing, ≤1 write/key/tick, 4 KB dev warn, green-context teaching guard), harness scenario additions.
- **New lines:** ~360.
- **Reuses:** `protectedSync.protectSynced` fused refuse-all, auto sync ids, CRDT snapshot for late join. Adds: `runtime::SharedFact {key,json,rev}` component + sharding + mirror.
- **Verify:** harness — two keys in one handler = two component writes; late joiner reads both with zero messages; hacked-client write force-corrected (`CRDT_AUTHORITATIVE`); `setState` in blue code throws the teaching error verbatim.
- **Creator payoff:** `game.state.flag` — facts every screen and every late joiner agrees on (flag carrier, tower clock, all four leaderboards in the walkthroughs).
- **Revert:** opt-in-by-import.

### PR 5 — Boot sequence, send-queue gating, `saved` + `playerData` *(B7 + B8 + B9 minus `secret`)*
- **Intent:** honest restarts (state resets, saved survives), cold-start-safe sends, durable memory verbs.
- **Files:** `game.ts` (bootServer pipeline: re-adopt stale facts → defer-a-tick delete → republish → await playerStore restores → `onStart` → `markServerReady('game')` → drain send queue; serverLife-gated retry timer; `saved`/`playerData` facades), `harness/scenarios/restart.mjs` (extend), probe-game legs.
- **New lines:** ~460.
- **Reuses:** `serverLife` readiness AND-gate + ladder, `serverState` (persist:true, dirty-retry flush), `playerStore` (write-behind, `saveAndEvict`, normalize-on-read). Adds: the boot pipeline, sync-shaped `playerData` (restore awaited before a player's first green handler), checkpoint wiring.
- **Verify:** `restart.mjs` — set state, kill server, reboot: clients converge on fresh `onStart` state, no zombie facts; `playerData` written pre-kill reads back; delayed-boot scenario — a send at t=0 resolves after the ~15 s wake instead of timing out at 12 s.
- **Creator payoff:** all-time leaderboards and per-player totals that survive sleep (`saved`/`playerData` — W1 correction #1, W2's bestTimes), and a first visitor whose clicks queue during wake instead of dying.
- **Revert:** opt-in-by-import.

### PR 6 — Players, zones, positions, `every`, `onClick` *(B10 minus rounds, + `onClick` from B11)*
- **Intent:** the presence verbs — join/leave, name-bound zones with the verify dance absorbed, server-side positions, plain intervals, clicks.
- **Files:** `game.ts` (`onPlayerJoin/Leave` watching synced `PlayerIdentityData`; leave pre-wired to `playerStore.saveAndEvict`; `onEnterZone/onExitZone` absorbing zoneBus + `trigger-zone-server`'s zone-authority detect→ask→re-verify; `positionOf` server path; `every(n)` over `schedule.interval` — **no** deadline persistence; `onClick` wrapping `pointerEventsSystem`), probe-game zone leg.
- **New lines:** ~480.
- **Reuses:** `zoneBus` occupancy, `zone-authority.ts` (1 m slack, 4 Hz, late-join grace), `playerPositions` frame math, `schedule.interval`. Adds: server-side `PlayerIdentityData` watcher (SDK `onEnterScene` never fires headless), server `positionOf` path, the zone-dance absorption.
- **Verify:** probe-game zone leg **against hammurabi preview** (harness is blind here, declared per B1): a client teleported outside the zone whose enter-ask arrives is refused; leave flushes playerData (harness).
- **Creator payoff:** the Moat and the Start gate — zone-gated green logic and lightning-strike distance checks (`positionOf`) with the broken client-only version unwritable.
- **Revert:** opt-in-by-import.

### PR 7 — Rounds + `layout` *(rounds slice of B10 + B11-lite)*
- **Intent:** the round machine in the module and the seeded-layout showcase verb.
- **Files:** `game.ts` + `pure/gameCore.ts` (`newRound`/`round`/`onRoundStart` porting the shelved `packages/desktop/prefabs/round-loop` phase machinery in; next-round seed drawn into `serverState`, published only at phase start; `game.layout(prefab, (rng, round) => …)` over `spawner.plan` mapped to seeded no-outcomes mode, callback signature `(rng, round)`-only by construction), harness + probe legs.
- **New lines:** ~550.
- **Reuses:** round-loop tuple `{seed, phase, phaseStartMs, configVersion}` + `schedule.onPhaseBoundary` + `PhaseWatcher` fast-forward; `spawner.plan`/`PlanQueue.suppress`; `rng` draw-order contract; forced `timeSync` init. Adds: the port, seed secrecy wiring, the layout facade.
- **Verify:** harness — late joiner lands fast-forwarded by arithmetic, not replay; two clients produce byte-identical layout plans from one seed; a divergent draw (player-count-dependent) is unwritable — the callback has no such input.
- **Creator payoff:** towerofmadness's showcase — 11 seeded obstacle pools regenerating per round, identical on every screen, zero wire traffic; both walkthroughs are round games.
- **Revert:** opt-in-by-import. **This PR completes the runtime surface of v1.**

### PR 8 — Template flip + recipes + G2 close-out *(B12 remainder)*
- **Intent:** creators are told about `game` — template rescaffold, recipes run verbatim, probe complete.
- **Files:** `packages/ui/src/script/template.ts` (the §2.4 two-sentence template), `packages/ui/src/gameconfig/codegen.ts` (polish: generated-file header), `packages/desktop/validate/probe-game.mjs` (final legs: state round-trip, zone verify, crashed-handler recovery, prefab-placed-twice/derived keys).
- **New lines:** ~300.
- **Reuses:** everything above. Adds: nothing runtime — this is the exposure flip.
- **Verify:** the flagtag (~135-line) and towerofmadness (~190-line) walkthrough scripts run **verbatim** minus the Discord prompt; the three v1 recipes (B/C/D shapes — recipe A needs `spawn`, deferred) pasted into a scratch scene run; probe-game + full harness green. **Closes G2.**
- **Creator payoff:** a new script scaffolds into the `game` model by default; both real games are buildable end-to-end in Studio custom code.
- **Revert:** revert the template file alone reverts exposure; runtime unaffected.

### PR 9 — Lint pack + `game.md` + AI prompt + diff stripe *(B13 + B14)*
- **Intent:** the AI/lint contract layer, decoupled from runtime.
- **Files:** `packages/ui/src/features/editor/scene-check-rules.ts` (+`scene-check-rules.test.ts`): ~9 blockers/~5 warnings (`new MessageBus`, bare `syncEntity`, raw `Storage`/`EnvVar` imports, `Math.random()`/`Date.now()` in layout callbacks, `body.player` identity reads, `{to:` in blue code, unmatched send/onMessage names, cross-color closure reads, state-shaped names in sends — the trap-7 heuristic covering the ledger cut); `game.md` vendored beside the generated module (byte-capped, claims-tested); `packages/desktop/src/ai-prompt.ts` (~35-line O(1) section); `packages/ui/src/script/code-editor.tsx` (green-hunk stripe + `Accept all (N need review)`).
- **New lines:** ~600 (lints ~400, stripe ~90, prompt ~35, tests/caps the rest; `game.md` is prose). At cap — the stripe splits out if it grows.
- **Reuses:** existing pure-lint scene-check registry, `.eui-studio-review` banner, standing "Fix these" prefill. Adds: rules + doc + prompt section.
- **Verify:** zero blockers on dead-surge/towerofmadness/cozy-farm corpora (FP benchmark **before** any blocker ships); each recipe deliberately broken one way trips exactly one named check; `game.md` byte-cap test; blockers fire only where `game` is imported — pre-`game` scenes never blocked.
- **Creator payoff:** the AI writes correct multiplayer glue (three-question rule, banned APIs) and hand-rolled footguns are caught before Play — this is the backstop for every deferred verb.
- **Revert:** lints are data in a registry; prompt section is additive; no runtime coupling.

---

## Phase 2 — see the model

### PR 10 — Runs-on line *(B15)*
- **Intent:** every behavior card derives its green/blue line — where this code runs, never declared.
- **Files:** `packages/ui/src/prefabs/guarantees.ts` (+test) learns `game.*` call sites; `packages/ui/src/panels/views/script-view.tsx` renders the line in the card `packages/ui/src/panels/auto-expand.ts` already opens.
- **New lines:** ~250.
- **Reuses:** the masked-source scanner discipline, `--success`/`--client-blue` tokens, `data-tip`. Adds: the `GAME_CALLS` pattern table + one derived text line.
- **Verify:** recipe C's script shows `● in the game, for everyone: pray` with exact hover copy; a `game`-free script shows no line (regression on existing cards).
- **Creator payoff:** a creator sees *where their code runs* on every script card — the fork made visible without opening the file.
- **Revert:** pure derived read-only UI; plain revert.

### PR 11 — Ref hygiene + `childrenOf` *(B18 + B19)*
- **Intent:** entity references stop rotting — delete guard, tombstone, load-time stale sweep — plus the assembly helper.
- **Files:** `packages/ui/src/script/references.ts` (+test — extend with the reverse-referrer walk), `packages/ui/src/script/parser.ts` (the `mergeLayout` advisory-field fix at ~400-404), `packages/ui/src/panels/delete-confirm.ts` + `packages/ui/src/panels/views/script-params.tsx` (tombstone replacing the `#517 · unnamed` fallback), `packages/desktop/runtime-modules/spawnPoints.ts` or new `pure/childrenOf.ts` (~10-line id-sorted helper), right-click **Add spawn point** verb in `packages/ui/src/panels/entity-menu.ts`.
- **New lines:** ~450.
- **Reuses:** existing forward name-set computation, `Modal` + danger `Button`, ⇧⌘G cascade paths from the entity-folders work. Adds: reverse walk, tombstone chip, non-negotiable load-time sweep, the helper.
- **Verify:** delete a referenced door → exact two-script warning copy; reopen a scene whose target died last session → tombstone, never a silent retarget (regression test); duplicate a spawner with three child spots → wired with zero param edits.
- **Creator payoff:** deleting or duplicating entities can no longer silently break behaviors, and spawn-point assemblies duplicate intact.
- **Revert:** editor-only; plain revert (sweep is load-time-additive, writes nothing destructive).

### PR 12 — Console tags + Game strip + "Start like a real visit" *(B16 + B24)*
- **Intent:** the minimum runtime visibility both walkthrough sessions leaned on, plus the cold-start rehearsal.
- **Files:** `packages/desktop/staging/editor-scene/src/play-hud.ts` + `packages/ui/src/features/play/` (Game strip pill rendering the serverLife ladder verbatim; `[game]`/`[you]`/`[player 2]` prefixes; `[game]` crashed-handler error cards with script+line, distinct from asleep), `packages/ui/src/features/editor/LogsDrawer.tsx` (`Scene console` → `Game` tab with role prefixes), `packages/desktop/src/servers.ts` (~15 s artificial-delay flag, persisted per project), Play chevron menu scaffold in `packages/ui/src/panels/Toolbar.tsx`.
- **New lines:** ~550.
- **Reuses:** the play-hud relay channel (crosshair/prompts already ride it), serverLife ladder + the B8 gate/queue from PR 5, `MenuToggleItem`, `usePersistentFlag`. Adds: strip, prefixes, toggle, chevron scaffold.
- **Verify:** the trap-1 demo — a legacy both-sides script logs once green, once blue, self-explanatory in one glance; kill the server process → strip walks the ladder **without any reload** (one-way loading-screen rule); toggle on → `◐ Waking… 15s → ● running` with a queued send resolving after wake.
- **Creator payoff:** a creator can *see* which copy said what, whether the game is awake, and rehearse exactly what their first real visitor experiences.
- **Revert:** HUD/drawer additive; the delay flag defaults off.

---

## Phase 3 — memory you can touch

### PR 13 — Saved data tab + `.editor/` mirror *(B21)*
- **Intent:** local saved state becomes inspectable and resettable; survives reinstalls.
- **Files:** `packages/ui/src/features/editor/LogsDrawer.tsx` (tab row grows: `Build · Game · Saved data`), Saved-data tab re-hosting the `ValueManager` from `packages/ui/src/features/worlds/StorageTab.tsx` (World | Per-player `Segmented`, per-key reset, two-step Clear-all), `packages/desktop/src/main.ts`-side mirror `node_modules/@dcl/sdk-commands/.runtime-data/server-storage.json` ↔ `.editor/server-storage.json` (editor-side only — no toolchain change, per the no-upstream rule).
- **New lines:** ~400.
- **Reuses:** the full Worlds ValueManager (rows, Pager, value Modal, ConfirmButton) — re-hosted, not rewritten. Adds: mirror + the hard exclusion — **env keys live in the same file; this view excludes them and Clear-all never touches secrets** (the gotcha owned here, ahead of PR 14).
- **Verify:** reproduce trap 11 (stale saved state resurrecting an old run), fix with one per-key reset; `rm -rf node_modules && npm i`, reopen → saved data intact.
- **Creator payoff:** W2 step 10 — clear test-run leaderboards without touching a terminal or losing anything else.
- **Revert:** additive drawer tab + mirror; plain revert.

### PR 14 — `game.secret` + Secrets publish step + masked tab *(B9's secret slice + B22)*
- **Intent:** the last v1 verb and its whole write-only UX.
- **Files:** `packages/desktop/runtime-modules/game.ts` (thin green-only `EnvVar` wrapper, `assertServer` idiom — the one runtime touch, re-sync applies), `packages/ui/src/features/publish/PublishModal.tsx` + `publish-flow.ts` ("Secret keys" step shown **only** when the scanner finds `game.secret()` calls; call-site provenance lines; verbatim consequence copy; write via the preview storage endpoint — the editor never reads `.env`, standing rule), `LogsDrawer.tsx` Secrets tab (names only, masked, no unmask state anywhere), probe leg asserting `secret` throws on a client.
- **New lines:** ~500.
- **Reuses:** PR 13's drawer + env-key exclusion, `.eui-publish-steps` chrome, guarantees-style call-site scanner from PR 10. Adds: verb + step + tab.
- **Verify:** a `game.secret('WEATHER_API_KEY')` scene publishes with the key entered in-flow and the value never rendered again; a scene with no call never shows the step; probe: client call throws. **Closes Tranche 1** — both walkthroughs now assemble end-to-end *including* W1's Discord webhook prompt, zero terminal.
- **Creator payoff:** publish a scene that talks to the outside world (Discord announcements) without a key ever appearing on screen or in git.
- **Revert:** verb opt-in; step conditional on call sites; tab additive.

---

## What the v1 facade does NOT contain — reviewers reject these on sight

1. **`game.spawn` / `despawn` / `ownedBy`** — neither game used them outside the Pickup prefab. Guard: verb absent = unmisusable; `bare syncEntity` + `new MessageBus` lints (PR 9) block the hand-roll. → Tranche 2.
2. **`game.report` / `onReport` / `instanceOf`** — never used; hit-shaped asks ride `onMessage` with clamp-in-handler, exactly as both games did. `outcomes.ts` stays shipped, unexposed. → Tranche 2 (Waves).
3. **Sequenced ledger for green→screens** — v1 broadcast is **plain** (moments fade, ~JSDoc'd); every fact in both games rides `state` (reliable + snapshot). The codec-per-name seam makes the ledger a drop-in upgrade with no API change. Guards: trap-7 lint, 13 KB/rate dev warn.
4. **`every` deadline persistence** — both games' schedules are stateless samplers; the one durable deadline (W2 clock) is deadline-as-state in `game.state`, documented as the idiom in `game.md`.
5. **`{to}` beyond the plain targeted path** — no ledger fork.
6. **Multi-variant `layout`** — v1.1 per §12 #5.
7. **Spawner "Who sees the copies?" enum (B17)** — needs the server-agreed-spawn design; consequence line already on the card.
8. **Pick gesture / `entityList` / AI name→id (B20)** — the dropdown EntityPicker covers P1–P3; PR 11 ships the never-ship-without hygiene.
9. **Guest split view / late-join button / Play-hierarchy ownership grouping (B25)** — external second bevy client on a second wallet is the shipped fallback.
10. **B2 spikes** (waypoint verb, synced AvatarAttach) — they answer questions only Tranche-2 surface asks.

## Tranche 2 preview (P4–P5 — not committed; boundaries depend on the B2 spike answers and the server-agreed-spawn design, so pre-numbering them now would be fiction)

Sketched split, in order: **T2-a** B2 spikes + `spawn/despawn/ownedBy` + `instanceOf` (B11-rest); **T2-b** `report/onReport` + Spawner enum + server-agreed-spawn (B17); **T2-c** kit prefabs on `game` — Pickup, Collectible, Door & Switch, Points, Teams, Save Point, Announcer, Game Flow, Health & Respawn, Waves, Level Slots, leaderboard rewrite (B23, several PRs via `add-builtin-prefab`); **T2-d** seq-ledger upgrade behind the codec seam (B4-rest); **T2-e** B20 pick gesture/`entityList`/AI refs; **T2-f** B25 split view (timeboxed spike, named fallback) then B26 Arena + the 45-minute sitting.

## Traceability + totals

| PR | B-steps | Est. new lines | Phase |
|---|---|---|---|
| 1 | B1 | ~550 | P1 |
| 2 | B3 + B12(gen) | ~370 | P1 |
| 3 | B4-lite + B5 | ~600 | P1 |
| 4 | B6 | ~360 | P1 |
| 5 | B7 + B8 + B9(-secret) | ~460 | P1 |
| 6 | B10(-rounds) + B11(onClick) | ~480 | P1 |
| 7 | B10(rounds) + B11-lite(layout) | ~550 | P1 |
| 8 | B12(close) | ~300 | P1 |
| 9 | B13 + B14 | ~600 | P1/G2b |
| 10 | B15 | ~250 | P2 |
| 11 | B18 + B19 | ~450 | P2 |
| 12 | B16 + B24 | ~550 | P2 |
| 13 | B21 | ~400 | P3 |
| 14 | B9(secret) + B22 | ~500 | P3 |

Total ~6,400 new lines (incl. tests/probes/harness — roughly a third of that is test code) across 14 PRs, none over the ~600 cap; PRs 3, 7, 9, 12 sit at/near it with their pre-declared split lines (B5 out of PR 3; rounds out of PR 7; stripe out of PR 9; toggle out of PR 12). The two real games are the acceptance test: PR 8 proves the custom-code halves verbatim, PR 14 proves both end-to-end with publish. Deferred B-steps: B2, B11-rest, B17, B20, B23, B25, B26 → Tranche 2; B4's ledger internals upgrade behind the codec seam whenever Waves demands it.