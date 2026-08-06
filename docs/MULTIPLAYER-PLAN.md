# docs/MULTIPLAYER-PLAN.md — Server-Authoritative Games in the Creator Hub

**Status:** committed execution plan. Grounds: round-1 catalog (`synthesis.md`), round-2 contract (`synthesis2.md`), round-3 shipped-game evidence (`plan.md`), adversarial review (`critique.md` — all 15 fixes are load-bearing here and may not be reverted). Repo touchpoints re-verified 2026-08-01.

---

## 1. North Star

We are turning the Creator Hub into the place where a creator builds, tests, and operates a server-authoritative multiplayer game without ever leaving the editor — prefabs and a vendored `_runtime` standard library supply the netcode nobody should write twice, and the embedded assistant writes the bespoke rest. Every server guarantee is visible (badges, HUD heartbeat, marked diffs) and every protection is automatic (created-protected sync, linted generations), because three shipped games proved discipline doesn't survive contact with creators or AIs. **Done** is the one-sitting demo: new project → place kit prefabs → tune GameConfig and a data table → one AI prompt for a novel server-validated mechanic → accept the linted diff → two-client Play with a simulated mid-session cold start → publish → live-tune the production World — executed cold, under 45 minutes, zero terminal.

## 2. Principles

1. **Insertion is installation** — a dropped prefab is a working multiplayer feature; the first Play proves it, no wiring step exists.
2. **Protection is automatic, not discipline** — `protectedSync`, namespacing, checked Storage writes are the only path `_runtime` offers; Tower proved humans forget.
3. **Invisible for creators, explicit for the AI** — creators never choose where code runs (UEFN); the assistant sees `isServer()` branches marked and linted (Roblox inverted).
4. **State snapshots, not events** — deadlines-as-state, drift-free countdowns, settle-expired-on-restore; anything event-shaped dies with server sleep.
5. **Templates are finished games** — New Project opens something winnable; the first act is editing, and the template is the AI's canonical corpus.
6. **The corpus trains the AI** — every `_runtime` module, prefab script, and template file is an exemplary Contract v2 specimen, because the assistant will imitate whatever we ship.

---

## 3. The Phases

Milestone IDs (M0–M8) are kept for tracking; phases are the unit of commitment. Critical path **P0 → P1 → P2 → P3 → P4**.

**Pacing:** the unit of work is a **prompt-batch** — one focused AI session that ends with its acceptance test green. Phase sizes below are prompt-batch counts, not calendar time; calendar time is however many batches run per day, and independent batches run as parallel sessions. The acceptance tests are the contract: a batch isn't done because the diff looks right, it's done when its probe/harness test passes.

*One naming skew resolved: the journey draft's "M6a/M6b/M7" = this plan's M6 (kit) / M7 (template) / M8 (story).*

### P0 — Alignment *(M0, ~3–5 prompt-batches)*

**Goal:** new scenes get what existing auth scenes already have, and CI can prove it.

**Already working — do not rebuild:** opening an existing auth scene (e.g. towerofmadness) and pressing Play runs the full loop today — the scene's own `sdk-commands` boots the local Multiplayer Server, the embedded bevy engine joins its transport, the server clock runs. The editor even reaps "the auth-server it spawns" on scene close (`servers.ts:507`). There is no engine spike; the gap is only that **new** scenes are created on the `protocol-squad` pin and therefore get no server.

- **Batch 1 — template pins:** exact **per-commit** SDK builds from the `auth-server` channel in `packages/desktop/templates/{blank,starter}/package.json` (never the moving dist-tag; `7.25.1-30310486734.commit-5ffe873` is the current channel head), all **five** packages in lockstep — `@dcl/sdk`, `@dcl/js-runtime`, `@dcl/react-ecs`, `@dcl/sdk-commands`, `@dcl/ecs` (the full set `packages/scene`'s `upgrade-sdk` script pins); verify `authoritativeMultiplayer: true` lands via the auto-write, `supportsNoClient` (`servers.ts:211`) and process-group kill still behave on this channel, and the asset-packs stub coexists.
- **Batch 2 — the probe:** `packages/desktop/validate/probe-auth-server.mjs` in `validate:e2e` — create from template → scene.json has the flag → Play → a template script does an `isServer()` `registerMessages` ping/pong and writes a marker entity the probe asserts. Pins advance only behind a green probe from here on. **Superseded 2026-08-04:** the template script was removed — no creator's scene should carry the editor's test code — and with it the round-trip assertion. The auth probe now checks the flag, the pin lockstep and that the scene installs, builds and opens; the pin itself is trusted. `probe-server-clock.mjs` is the remaining real round-trip.
- ~~Batch 3 — deploy smoke~~ **Deferred to P4 by decision (2026-08-01):** the deploy smoke (publish a minimal auth scene to a test World, hosted server boots, ping round-trips in production) runs at the end of the plan alongside the Arena template's deployed-world test, not in P0. Local authoring/testing is the focus until then. The risk it guarded (deploy pipeline dropping auth scenes) is accepted as late-detected.
- **Open question that moves to P3/M4 (not a blocker here):** two Play windows currently share one wallet = one player address to the server; the second-client identity mechanism (guest address per window) is resolved when M4 builds it.

**Demo beat:** File → New (not an old game — a fresh template) → Play → the server log prints "I am the server", ping round-trips; then the same round-trip works on the deployed test World.

**Exit criteria:** `packages/desktop/validate/probe-auth-server.mjs` green (template → scene.json flag → Play → `isServer()` round-trip marker). ✅ **Met 2026-08-01 — first run all-pass.** (Deploy smoke deferred to P4.)

**Parallelizes:** nothing — everything waits on this.

### P1 — Standard Library *(M1 + M3a, ~10–14 prompt-batches; two parallel session tracks)*

**Goal:** the three games' best ~2,000 lines become `import from './_runtime'` in every new scene, proven by a headless harness — plus the GameConfig panel, which needs only M0.

**AMENDED (2026-08-01, Gonzalo's decision):** `_runtime` is **not** template-vendored and must never become an asset-packs-shaped monolith. Master modules live in `packages/desktop/runtime-modules/` (small standalone files, **no barrel** — a barrel drags unused modules and their module-scope side effects into every bundle). **Prefabs carry the specific modules their scripts import** into the scene at instantiation (the seat prefabs' `ui-owner.ts` pattern), so a blank scene ships zero runtime code and a bug's blast radius is "scenes using a prefab that carries the module", never "every scene". Services are lazily self-initializing (first caller triggers init) so no prefab ever depends on the creator placing an infrastructure prefab. The P1 "starter showcase" becomes the first Game Kit prefab instead (**Server Clock**, visible consumer of timeSync). Drift control: a unit test asserts prefab-embedded copies are byte-identical to the masters. Original module list below still applies — only the distribution model changed:

**Engineering (M1 — runtime modules, `packages/desktop/runtime-modules/`, ~10 modules)**
- `timeSync` (Tower near-verbatim), `playerStore` (schema-version + normalize-on-read + cache/dirty/debounced-flush + **checked `Storage.set`**), `rpc` (requestId correlation, auto `{to:[context.from]}`, timeout/retry), `serverLife` (heartbeat + `useServerAlive()` + retrying first-contact handshake + connection-state enum — kills the cold-start wedge by construction), `protectedSync` (create + syncEntity + validateBeforeChange in one guarded call; pooled `src=''` variant), `lifecycle`, `ledger`, `schedule` (deadline-as-state, settle-expired-on-restore, awaited-restore boot ordering), `httpServer` (signedFetch + Tower's ethers transport — kept deliberately; Tower burned an iteration discovering this boundary), Int64-by-default schema helpers.
- **Per-instance namespacing baked in (critique #11):** `rpc`/`playerStore` take an instance key; `claimSingleton` reserved for genuinely global things.
- **VERSION stamp + editor-driven "update runtime" (critique #12):** semver + content hash, stale-copy detection on project open, scene-health warning on local modification; prefab capture treats `_runtime` as shared, never duplicated.
- **Headless server harness** (Node, no GPU; see §Testing): restart / spam / duplicate scenarios per stateful module. sdk-commands scene test runner wired into `npm run validate` as docs/TESTING.md tier 1.5.
- **Visible showcase (critique #15):** starter template gains a heartbeat indicator + drift-free synced countdown visible in Play — the `serverLife`/`timeSync` integration test that also demos.
- The `serverLife` client half ships the **player-facing waking panel** (UX Surface 4's in-world default): react-ecs singleton, "Waking the game server… Xs", avatars keep control, no fake progress bar, auto-dismiss on first heartbeat.

**Engineering + UX (M3a — GameConfig, parallel after M0)**
- `GameConfig` component on the scene root, exactly the admin-tools triple (`views/admin-tools.ts` normalize module + bespoke view + `views/registry.tsx` line) — undo/autosave/capture free via `inspector.ts`. Sections: Match (min/max players, round/intermission, win-condition enum with per-choice fields), Player, one section per data table. Validation in the normalize module (range clamps, dangling row refs → inline error rows + header count chip; never blocks typing). Typed accessor generated at `src/scripts/game-config.ts`.
- **UX: Script param inspector v2 MVP** (`views/script-view.tsx` + `script/parser.ts`): **enum** (string-literal union → `Select`, `@option` labels), **Vector3** (triple `NumberField` row), **`@advanced`** disclosure. Needed before P2's prefabs ship.

**Demo beat:** kill the server live — indicator flips to "reconnecting", server restarts, the countdown resumes *at the right value*. One slide: "three games each rebuilt these 2,000 lines with the same bugs; now they're in every new scene."

**Exit criteria:** `npm run validate` green incl. `_runtime` unit tests + harness **restart** (entry written → SIGKILL → reboot → entry present, settle-expired ran, heartbeat within N ticks), **spam** (flood, malformed, 13KB boundary, ledgers hold, `{to}`-targeted), **duplicate** (two `playerStore` instances, distinct keys, no cross-talk). Showcase fixture asserted by the probe. GameConfig normalize unit tests green; CDP probe: edit round duration → Play → new value live, no code edit.

**Parallelizes:** M3a fully; M5 prompt-writing starts once the `_runtime` module APIs are sketched (first M1 batch).

**Status 2026-08-04 (wave 1 of the spawnable prefab kit):** M1 now carries
`timeSync`, `playerStore`, `rpc`, `serverLife` (five-state ladder + readiness
gating), `protectedSync`, `serverState`, `schedule` (deadline-as-state phases),
`rng`, `spawner` and `outcomes`; `RUNTIME_VERSION` is `0.2.0`. M3a landed as
`editor::GameConfig` + the normalize/view/registry triple and the generated
`src/scripts/game-config.ts`. The headless server harness and the storage tab
are **not** built — the standing runtime gate is
`packages/desktop/validate/probe-script-runner.mjs`, which fingerprints the
SDK's script runner and diffs the placed and cloned dispatch paths field for
field. Script param inspector v2's `PrefabRef` / `PrefabRef[]` gap is **closed**:
the parser types them as `prefab` / `prefabList` and the inspector renders a
prefab dropdown and a multi-select, so wiring a Wave Director to its zombie is a
pick, not a pasted UUID.

### P2 — First Playable *(M2 + dev-loop core UX, ~8–10 prompt-batches)*

**Goal:** four prefabs into a blank scene, press Play, a round-based multiplayer game runs — zero code — and the tooling to QA that claim honestly exists.

**Engineering (M2)**
- Contract v2 glue delegating to `_runtime`: defensive role resolution (query failure ⇒ client — prefabs degrade gracefully in non-auth scenes), static-import component defs, instigator = `context.from`, checkpointed storage, Enable/Disable/Reset.
- **Server Round Loop** (keystone, singleton): phases/durations, synced RoundState + drift-free countdown, phase hooks, min-players, park-when-empty, cold-start-safe rehydrate. **Leaderboard** (named board, sort, optional UTC-week rollover, `Storage.player` long tail, GLB-anchored panel; namespaced by board name). **Server-Validated Pickup** (spawn/claim/reject/expire, proximity validation, join rehydration, N-instance safe). **Trigger Zone** (named volume, onEnter/onExit, validated variant). Shipped via `add-builtin-prefab` into `packages/desktop/prefabs/`.

**UX**
- **Surface 1 — prefab browser:** `PrefabData` gains `authority?` + `guarantees?[]` (backward-compatible); authority `Chip` on cards (server=accent, synced=info, client=neutral), guarantee tooltip block, "Game Kit" `group`. Drop into a non-auth scene → one-time toast with inline "enable server" action, never a blocking modal.
- **Surface 4 core — Play HUD server badge:** `features/play/ServerBadge.tsx` over the `play-hud.ts` relay rendering the `_runtime.serverLife` enum verbatim (running/waking+elapsed/asleep/unreachable+Logs link); absent in non-auth scenes. No surface invents its own state machine.
- **Surface 5 core — dev loop tabs:** `LogsDrawer` becomes `Segmented` Build | Server | Storage (auth scenes only). Server tab = `LogsTab` hook pointed at local server stdout, server lines get the accent left border (the one "server color" used everywhere). Storage tab = `ValueManager` against local `server-storage.json` via data-layer RPC, with **per-key reset** and two-step Reset-all, plus the local-vs-deployed one-liner.

**Demo beat:** blank scene, drag four prefabs, Play — a round starts, pickups claimed, scores land. Restart the server: leaderboard persists. Drop a *second* leaderboard — both work. Zero code written on camera.

**Exit criteria (all automated):** harness scenario — rounds cycle → scripted client claims in-zone (accepted) and from 50m (rejected) → score persists across SIGKILL restart → round restarts cleanly. **Duplicate scenario (critique #11):** two Pickups + two Leaderboards, claims route correctly, no message-id/Storage-key collision. CDP probe places prefabs through the real UI and enters Play; probe asserts log-pane fixture lines and seeds/resets/asserts a storage key.

**Parallelizes:** M5 (AI) and M4-remainder design; M6 prefab specs.

**Status 2026-08-04 (wave 1 of the spawnable prefab kit):** the M2 prefabs
shipped as Round Loop, Level Slots, Wave Director, Player Rig and Leaderboard
(`packages/desktop/prefabs/`, `group: "Multiplayer Server"`), built on the
**v1** script contract — `constructor(src, entity, …params)` + `start()` /
`update(dt)` + `isServer()` — not Contract v2 lifecycle methods, which this repo
does not implement. Server-Validated Pickup is not among them; the validated
path it stood for is `outcomes`, which every kit prefab uses. Authority is
**not** a `data.json` field: the sync mode is an argument at pool-open, so the
card's guarantee chips are derived from the consumer (Surface 1 and the Play HUD
badge land in wave 2). Thumbnails are placeholders pending an art pass.

### P3 — The Experience *(M4 + M5 + M3b + M6, ~15–20 prompt-batches across four parallel session tracks)*

**Goal:** the full authoring experience — be two players, simulate the cold start, ask the AI for server code and trust the review, rebalance production without redeploying, and complete the kit the Arena needs.

> **Status (2026-08-05):** the built-in **Spawner** prefab landed ahead of M6 (see `docs/PREFABS.md`) — the generic "make a copy appear while the game runs" primitive the deferred NPC/Mob base and Score/XP prefabs would each have re-invented. Server-decided spawns over a new `spawnBus` rpc namespace with nonce-deduped server-minted ids, `serverState` persistence + `fastForward()` across restarts, per-spot cap, lifetime and deterministic scatter; three scene checks (`mixed-pool-authority`, `spawner-unknown-zone`, `spawner-nested-spawn`) and a validate probe (`probe-spawner.mjs`; server claims run against a deployed world). It is also the first prefab with a **right-click gesture that configures it for you** and the first beginner-facing `Entity` param — which is why a parser fix (`TSAsExpression`) and the nested-instance exclusion in `instanceDrift` rode along. Two-client Play verification stays in M4: the local harness has one client and no Multiplayer Server, so every server-decided claim is SKIP until it runs against a deployed world.

**Engineering + UX, four parallel tracks:**

**M4 — multiplayer dev loop** (after M1+M2, own minimal fixture — critique #7)
- **Second client:** one-click "+ Second player" with a **distinct guest address** (bevy-explorer's guest-wallet pattern is the prior; resolve the mechanism in this milestone's first batch). Until then the button ships behind a labs flag with a `CopyField` join-URL fallback and an honest disabled tooltip — **never two windows on one identity** (the server sees one address and every per-player feature silently lies).
- **Cold-start simulator:** `servers.ts` spawn-path toggle (~15s delayed boot / stale CRDT snapshot), surfaced as a Play-controls menu checkbox with a wrench sub-icon while active, persisted per-project.
- **Exit (automated, critique #8):** CDP probe on the minimal fixture — enable sim → restart Play → HUD asserts `waking` then `alive`; kill process → `dead`; restart → `alive`. Two-client same-round check stays a scripted demo step (rides into P4 rehearsal).

**M5 — AI-first** (after M1)
- Rewrite `DCL_SYSTEM_PROMPT` (`ai.ts:86`) to the two-sided model: `isServer()`, `_runtime` surface, Contract v2 shape, the authority-spectrum rule (synced components only for shared low-cardinality state; per-player = RPC + `Storage.player`). Compact `_runtime` reference into vendored skills (`.agents/skills/authoritative-server/`) — no game repo ever needs a `dclcontext/` payload again.
- **Auth-server lint as TS-AST rules only (critique #13):** client-side `syncEntity` in auth scenes, synced custom components without `validateBeforeChange`, unguarded module-scope validators, `Schemas.Number` `*Ms/*At/*Time` fields, unchecked `Storage.set`, `setTimeout` in server paths, un-`{to}`'d responses. Rules needing flow analysis get cut, not shipped flaky.
- **UX Surface 7:** server-branch diff highlighting (accent stripe + gutter "S", detected by the same AST layer), blast-radius sentence above Accept, "Accept server change" label when server lines dominate. Lint findings as scene-health-style cards: **blockers** (AST-provable only) disable Accept with a "Fix these" prefill turn — the assistant self-heals, the human never hand-edits under freeze; **warnings** never block. Context chip row ("Multiplayer Server rules ✓ · _runtime API ✓"). Lint-infra outage → dim "checks unavailable" note, never silent skip, never block.
- **Exit:** deterministic CI only (critique #9) — fixture suite seeded with the actual three-game defects all flagged, `_runtime` equivalents clean, **measured FP ≈ 0 across the full three-game corpora** (the corpora are the benchmark; no card may disable Accept before this holds). The generative check ("server-validated coins with a daily limit") runs as an **out-of-band N-sample scorecard** with a pass-rate threshold per release, never gating CI.

**M3b — live config** (after M1 + P0 deploy smoke — critique #6)
- Server-side `config:*` watcher (a `schedule`-based `_runtime` module); GameConfig fields marked live-tunable publish as `config:*` keys and show a "LIVE" chip. `StorageTab` grows the `config:*`/EnvVar manager (`sdk-commands storage env set` underneath); local preview reads/writes `server-storage.json` via data-layer RPC.
- **UX Surface 6 — Live-ops panel** in `WorldDetail`: **Live settings** (manifest published at deploy renders `config:*` keys with the *same field renderers as GameConfig*, ConfirmButton sentences, drift chips with revert; unmanifested keys fall back to raw rows), **Secrets** (EnvManager, write-only copy), **Storage** demoted below. No optimistic writes; no admin-action buttons in v1 (in-world admin-tools owns that — revisit post-P4).
- **Exit (automated, critique #10):** test writes a `config:*` key via data-layer RPC → asserts the running local server's watcher picks it up within N ticks via a synced marker. The deployed-World flip is a P4 scripted demo, not a gate.

**M6 — kit completion, cut list only (critique #5)**
- **Lobby/Match** (the ~1,200-LOC Dead Surge state machine as a prefab — hardest, lands first), **NPC/Mob base** (client-simulated movement, server HP authority, optional position mirror), **Score/XP**, **Podium**. Trust badges on all kit prefabs. **Deferred to post-launch backlog:** Wave Director, Mailbox/Inbox, Quest step machine, anti-cheat movement validator — none blocks a finished Arena. *(Material disagreement resolved: the journey draft's "full kit" M6a loses to the engineering cut list; journey moments C3/B6 that referenced deferred prefabs are re-pointed at Trigger Zone + badges.)*
- **UX fast-follows landing this phase:** entity-ref **eyedropper** (arm pick mode over the editor channel, Esc cancels, topbar hint — the killer affordance; we own the renderer), asset-ref/color params, guarantee strip in the script inspector (needs the prefab-id provenance stamp from `prefabs/instantiate`), **`TableEditor`** ds primitive for GameConfig data-table grids (typed cells, row ops, `Pager`, showcase entry per CONVENTIONS).
- **Exit:** every prefab passes restart + spam + duplicate harness scenarios; Lobby handles join-during-countdown, leave-mid-round, cold-start-mid-match in automated scenarios.

**Demo beats:** (M4) two windows, contested pickup — one wins, one reverts; cold-start sim resolving cleanly — *the two flagship gifs*. (M5) prompt → marked server diff → lint card catching the pasted real Dead Surge bug. (M6) full match start-to-podium, two clients, badges visible.

### P4 — The Story *(M7 + M8, ~10–12 prompt-batches; the art pass and demo rehearsal are human time)*

**Goal:** a finished game in the New Project picker, a named audience that can play it, and the rehearsed one-sitting narrative.

**Engineering (M7)**
- **Multiplayer Arena template** (`packages/desktop/templates/arena/`): finished round-based game — lobby, rounds, pickups, score, leaderboard, podium, GameConfig tuning, cold-start-proof UX — assembled from kit prefabs + data tables + a handful of exemplary Contract v2 scripts (the AI's canonical few-shot corpus). Art/audio pass sized as its own work item.
- **Client compatibility matrix (critique #14):** `docs/CLIENT-MATRIX.md`, per SDK pin, drafted at the P0 pin selection and maintained in the pin-bump checklist. **Launch blocker check by design:** the deployed Arena must be played end-to-end on at least one official non-bevy client named in the matrix; if red at this point, scope narrows to bevy/desktop with an explicit upstream escalation — decided here, not post-launch.

**UX (Surface 8)**
- **Template picker narrative** in `NewSceneModal`: card row with thumbnail + one-liner + chips (`Multiplayer Server`, `Finished game`); server-ness is a readable property of the template, never a checkbox ("Creates a scene with its own game server — free, sleeps when empty"). Lands with the Arena — a narrative picker with only Blank is worse than none.
- **First-run tour** (multiplayer templates only): four anchored coach marks (prefab badges, GameConfig, Play + heartbeat, assistant), one sentence each, skippable, <30s total; new `ds/CoachMark.tsx` + `tourStore`. Play-button single-pulse nudge on first open. Template cards state where the published game is playable, per the matrix.

**Engineering + everyone (M8)**
- The rehearsed demo: new project → kit prefabs (a *different* game than the Arena — e.g. king-of-the-hill deathmatch) → GameConfig + data table → one AI prompt → linted diff accepted → two-client Play with mid-session simulated cold start → publish → live-tune production while a second presenter plays. Deliberate slack reserved for integration burn-down, not features. Demo gifs are captured *at each phase demo*, never reconstructed — they are the launch-post and docs asset pipeline (the four that must exist: four-drag Play, two-window contested pickup, waking-state resolve, live-tune closing beat).

**Demo beat:** the finale *is* the phase.

**Exit criteria:** template green in `validate` + full harness suites; deploy smoke publishes it; played on an official client per the matrix. **The M8 demo executed cold by someone who didn't build the features, from the script, under 45 minutes, no terminal, no external editor** — re-run quarterly as a regression test on the story itself. CDP spine probe green in `validate:e2e`.

---

## 4. Workstream View

| Track | P0 | P1 | P2 | P3 | P4 |
|---|---|---|---|---|---|
| **Engine/SDK** | per-commit template pins, `supportsNoClient` revalidation, probe, deploy smoke | stdout relay hardening | — | cold-start simulator (`servers.ts` spawn path), second-client identity plumbing | pin-bump + matrix maintenance |
| **Editor UX** | surface specs finalized | GameConfig view + normalize module; param inspector v2 (enum/Vector3/advanced) | prefab authority badges + toast; ServerBadge HUD; tabbed LogsDrawer (Server/Storage, per-key reset) | AI diff stripes + lint cards + prefill; Live-ops panel; eyedropper/asset/color params; `TableEditor`; guarantee strip | template picker cards; CoachMark tour; Play pulse |
| **Prefabs / `_runtime`** | — | the 10 modules, namespacing, VERSION + update path, waking panel, showcase fixture | Contract v2 glue; Round Loop, Leaderboard, Pickup, Trigger Zone | Lobby/Match, NPC base, Score/XP, Podium, trust badges; `config:*` watcher | Arena assembly support |
| **AI** | — | prompt drafting once `_runtime` APIs freeze | few-shot capture from M2 prefab scripts | `DCL_SYSTEM_PROMPT` rewrite, skills reference, AST lint rules, acceptance-flow integration, scorecard pipeline | Arena scripts as canonical corpus; scorecard per release |
| **Content / Templates** | — | starter-template showcase | — | Arena design + art/audio pre-production | Arena template; Event Venue gains quiet server backing (migration story); Treasure Hunt deferred post-launch |
| **QA / Testing** | `probe-auth-server.mjs`; deploy-smoke script | headless harness (restart/spam/duplicate); scene test runner in `validate` | duplicate-prefab scenario; probe grows prefab+Play steps | HUD-transition probe; lint fixture corpus + three-game FP benchmark; watcher test | matrix checklist run; the cold-run M8 demo; quarterly re-run |

Ownership: tracks map to parallel prompt sessions, not headcount — the critical path (Engine/SDK → Prefabs/`_runtime`) runs as the primary session thread; Editor UX, AI, and QA batches run as parallel sessions whenever their dependencies are green. The human's job is reviewing diffs against the acceptance tests and making the calls in §5.

---

## 5. Risks

| # | Risk | Detection point | Mitigation |
|---|---|---|---|
| 1 | The newest `auth-server` channel build behaves differently from the ones the shipped games run (7.21/7.24-era) — templates inherit regressions the games never saw | **P0 probe** on the pin-selection batch | Pin the exact build towerofmadness-class scenes are proven on if the newest is red; advance later behind the probe |
| 2 | Deploy pipeline doesn't carry auth scenes (bundle dropped, flag stripped, hosting doesn't boot the server) | **P0 deploy smoke** (batch 3), re-run every pin bump | Test World exercised from the first phase; failures become upstream tickets immediately, not at P4 |
| 3 | `auth-server` SDK channel moves/breaks under us (historical precedent) | `probe-auth-server.mjs` red on a pin-advance PR — never in a user's project | Exact per-commit pins; editor owns the pin; advance only behind green probe + deploy smoke + matrix update |
| 4 | No official client speaks the transport at our pin — day-zero game has no audience beyond bevy | Matrix drafted at P0 pin selection (early warning); **hard check at P4** | `docs/CLIENT-MATRIX.md` per pin; P4 acceptance requires a played session on one official client; if red, scope narrows with explicit upstream escalation, decided at P4 |
| 5 | Cold-start/sleep bugs invisible in local preview ship anyway (all three games wedged this way) | P1 harness restart scenario; P3 simulator + CDP HUD probe | `serverLife` makes the retrying handshake the default (wedge impossible by construction); simulator makes the 15s path reproducible; probe keeps it tested forever |

Named near-misses: `_runtime` vendored drift (VERSION + editor update, P1); lint false positives training card-dismissal (AST-only + corpus FP benchmark, P3); M6 scope creep back toward twelve-prefabs-and-a-template (cut list + P3/P4 split).

## Decisions Still Open

1. **Second-client mechanism** (guest wallet in a second engine instance vs hosted bevy-web window) — *recommendation:* guest identity per bevy-explorer's wallet pattern; resolve in M4's first batch; ship the labs-flagged URL-copy fallback regardless.
2. **`_runtime` long-term packaging** (vendored folder vs npm package) — *recommendation:* stay vendored with VERSION + editor-driven update through launch; revisit npm only if the update path proves painful across ≥2 releases.
3. **Live-ops admin actions** (start round / reset leaderboard from the editor panel) — *recommendation:* keep the panel data-plane only; in-world wallet-gated admin-tools owns actions; revisit after P4.
4. **Third template** (Treasure Hunt / Quiz Trail) — *recommendation:* first post-launch content update; it exercises the persistence/live-ops half Arena underuses and widens the funnel beyond combat, but nothing in P0–P4 depends on it.
5. **P3 parallelism** (four session tracks compete for the human's review bandwidth) — *recommendation:* run M4 and M5 as the two primary threads; M3b and the eyedropper/TableEditor fast-follows are the first to slip to P4+ if review becomes the bottleneck — decide at the P2 review, not silently.

---

## 6. Not Building

- **Declarative trigger/action wiring or visual scripting** — behavior is TS script classes the AI writes; fixed decision, evidence-backed.
- **Asset-packs revival** — the stub stays; kit prefabs are self-contained Hub-format + `_runtime`.
- **A generic rooms/instances SDK feature** — `sendToRoom` + room-registry helper in `_runtime` and stop.
- **Server-side physics / full NPC position mirroring** — client-simulated AI with server HP authority; mirroring stays optional.
- **An external backend story** — Storage + EnvVar + signedFetch is the answer; both games that tried backends abandoned them.
- **React-ECS storybook / UI preview harness** — real pain, off the critical path; revisit post-P4.
- **Cinematic camera / podium authoring UIs** — code-level keyframes ship; viewport authoring is post-launch.
- **Storage schema-migration tooling beyond browse/reset** — `_runtime` normalize-on-read + per-key reset cover the shipped need.
- **Any timer abstraction beyond deadline-as-state** — dt-accumulators + absolute deadlines proved sufficient three times.
- **Cheat-proof claims** — badges say "server-validated", never "cheat-proof"; the deferred movement validator gets its own post-launch cycle.
- **Wave Director, Mailbox, Quest machine, anti-cheat validator at launch** — post-launch backlog; none blocks a finished Arena.
- **Shooter/combat-forward templates beyond Arena's scoped mobs** — flaky combat burns trust, and trust is the asset under construction.
---

## 7. Validation: DCL-Hazards-POC *(added 2026-08-01)*

A fourth shipped auth-server scene (`~/Documents/Decentraland/DCL-Hazards-POC`, SDK 7.20.5, last-one-standing hazard platformer, ~5.4k LOC) was checked against this plan. It **is** the P2 target built by hand — lobby with ready-gating, phase machine with countdown, lives, session scores, podium, spectators — and confirms the plan's shape while contributing patterns it lacked.

**Code to lift (with the file it comes from):**
- **Deterministic-seed round generation** (`server.ts` `beginRound` + `client/multiplayer.ts` `applyGameSeed` + `RNG.ts`): the server broadcasts one seed int; every client generates identical hazard timings from a seeded RNG with a documented draw order, and late joiners/spectators fast-forward from `seed + elapsedTime`. Bandwidth-optimal and restart-friendly. → `_runtime.rng` module (new, S) and the standard pattern for Wave Director / obstacle-course prefabs: **reconstruct from seed, never stream layout state**.
- **Solo-mode countdown** (`server.ts`): when exactly one player is ready and nobody else is live, a longer solo countdown starts a practice round; a second ready cancels into the normal flow. → Round Loop prefab gains a `soloMode` param. Also the honest answer to "the scene is empty" testing.
- **Ready Ring** (`ReadyRing.ts`): physical opt-in zone + ready press, unready by leaving, countdown reset on new joiner, live-player reconciliation kicking disconnected ready players. → Lobby/Match prefab's join surface — exactly the "opt-in join, never auto-enroll" rule as a physical object.
- **Frenzy escalation** (`phase: 'frenzy'` + client multiplier): a timed phase that speeds everything up. → Round Loop phase-modifier hook.
- **Spectator support** (`Watch` flow, server-relayed timer request/response because MessageBus has comms-range limits): working spectator sync code. → M6 Lobby/Match spectator slice, previously unsized.
- **In-scene debug harness** (`debugForceStart`, `debugAddFakeReady` — fake ready players to test caps, per-obstacle toggles, network log ring buffer): the fourth repo to hand-build one. → M4 dev loop should absorb these as editor features: **force-start round** and **add bot player** buttons next to the cold-start simulator.

**New platform knowledge (feeds `_runtime.serverLife` + the skills):** `room.isReady()` is unreliable on the client across SDK versions — the POC layers three workarounds (immediate try/catch send, onReady callback + synchronous pre-registration check for the race where the room was ready before the callback existed, and a 5 s unconditional periodic retry) plus a "first server message = connected" signal (`OfflineIndicator`). `serverLife` must implement exactly this ladder, and never trust `isReady()`/`isStateSyncronized()` alone.

**Lint corpus additions (fourth confirmation):** module-scope `new MessageBus()` in a file the server also loads; client-authoritative outcomes (`playerDied`, `playerLivesUpdate`, client-claimed podium points with only a range check); no `validateBeforeChange`/`syncEntity`/Storage/heartbeat anywhere (session scores die with the server); countdown floats decremented per tick instead of deadlines; `(data as any)` casts and JSON-in-`Schemas.String` payloads (the `rpc` envelope's job). One honest note: for client-side physics hazards, client-detected deaths are the same ceiling Dead Surge accepted — the lint should warn, the trust badge should say "score server-tracked, deaths client-reported", and the plan's position (no cheat-proof claims) stands.

**Plan impact:** no milestone changes; M2's Round Loop gains solo-mode + phase-modifier params, M4 gains force-start/bot-player buttons, M1 gains `_runtime.rng`, and the M5 lint fixtures gain this repo as corpus #4. The POC also strengthens the story: its 520-line `index.ts` wiring file is precisely what "drop four prefabs" deletes.

---

## 8. UX Conventions Adopted *(added 2026-08-01 — where these differ from surface descriptions above, this section wins)*

Grounded in a survey of what Unity, Unreal, Godot, Roblox Studio, UEFN, Firebase/Unity Remote Config, and VS Code agree on. The bar: a creator arriving from any major editor finds everything where they expect it.

**Multiplayer testing (amends M4).** The entry point is a **chevron dropdown on the existing Play button** — where Unreal (Number of Players + Net Mode), Roblox (Test tab → Clients and Servers → "N Players" + Local Server), and Unity MPPM all put it. Ours: player-count selector ("1 Player", "2 Players"…) + mode line with plain-language description. Each spawned window is titled **"Server" / "Player 1" / "Player 2"** (the identically-titled-windows complaint is documented). Roblox's network-lag simulation lives in the same menu — our cold-start simulator joins it there, replacing the separate Play-controls checkbox.

**Client/server color language (global).** Adopt Roblox's settled vocabulary: **blue = client, green = server**, used consistently across log-line origin chips, window labels, viewport border in server view, and the HUD ServerBadge. This replaces the earlier "one accent server color" note — green is the server color; blue marks client contexts wherever both appear.

**Inspector params (amends M3a/M6 param inspector).** Three table-stakes affordances: (1) **per-row modified-from-default indicator + one-click reset arrow** (Unreal's yellow arrow / Godot's revert icon; reserve the icon's space — never reflow the row, per Godot issue #3415); (2) **drag-to-scrub numeric fields** with Ctrl for fine steps; (3) property **search box** at the top of the panel. Entity-ref fields follow Unreal's compound control: value chip (click = ping the entity) + picker dropdown + **viewport eyedropper**. Advanced params: per-section inline "Advanced" expander (Unreal), not a global preferences toggle. Every param label gets a plain-language tooltip. Multi-select shows "Multi-editing N objects" explicitly.

**Log console (amends the LogsDrawer spec).** Unity Console + Roblox Output define it: severity filter toggles that double as **live count badges** ("⚠ 12"), **context filter Client/Server** with color-coded rows, Collapse-dedupe with repeat counts, Clear-on-Play as a toggle, timestamps + click-to-source, and auto-scroll that pauses on scroll-up with a "jump to latest ↓" affordance.

**Data tables (amends the TableEditor spec).** Unreal DataTables is the reference: **spreadsheet grid on top + row-detail pane below** that reuses the normal param editors — complex cells are never edited in-grid. Frozen key column; typed cell editors; edit-time red-outline + error-count badge on the tab; import-time per-row error report, never silent coercion. If a table is linked to an external CSV/sheet: show provenance ("Imported from waves.csv — Reimport | Detach") and make in-editor edits vs reimport an explicit single-source-of-truth choice — "my edits vanished on reimport" is the documented failure.

**Live-ops panel (amends M3b).** Firebase + Unity Remote Config agree on the full loop and we adopt all of it: edits accumulate as **drafts with a pending-change badge → explicit "Publish changes"** with a blast-radius confirm ("applies immediately to all connected players") → **numbered change history (who/when/what) → rollback publishes the old version as a new version**, never rewrites. Environment (local preview vs deployed world) always visible. No immediate-write live values — no major console does this.

**Play-mode state (confirms existing design).** Unity's decade of lost-work threads: the mode change must be unmistakable **by default** (Play HUD + chrome change). Roblox's client/server toggle button in play (flip one window between client view and server view, blue/green border) is the natural v2 of our ServerBadge — noted for post-launch.

**AI diff review (amends M5).** Per-hunk Accept/Reject with keyboard nav is the converged baseline (Cursor, Copilot Edits); whole-file accept-only is a documented complaint. Our addition composes two proven patterns rather than inventing one: **server-touching hunks get an inline warning annotation ("runs on the server for all players") and are excluded from Accept All — they must be individually accepted**, like CODEOWNERS-protected paths in a PR.

**Trust & capability (amends badges).** Two-tier labeling, per Roblox: an identity mark (verified creator) is separate from a content mark (reviewed/endorsed prefab); capability chips ("server-side code", "networked", "external HTTP") answer a documented unmet need. VS Code's Workspace Trust history is the execution-safety lesson: **ask the trust question up front and modally** when importing third-party prefabs with server code, and keep the restricted state **persistently badged** with a "what's disabled and why" surface — passive notifications measurably fail.

**Onboarding (confirms M7, adds one refinement).** Template grid with thumbnail + one-liner is universal (Unreal categories, Roblox templates, Core frameworks). Roblox's Story Game adds the strongest pattern: ship the template **complete-but-with-one-obvious-hole**, and the tour's final step is filling it ("change the win condition, press Play") — first Play always succeeds. Coach marks: max 5, progress dots, Skip always visible, animate the feature (Figma); contextual just-in-time tips beat up-front tutorials (NN/g).
