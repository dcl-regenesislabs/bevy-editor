# Code and no-code — the three-tier creator model

> 2026-08-08 review round: 'how does Roblox solve code vs no-code — are prefabs our answer?' Platform research (Roblox/UEFN/Core/Horizon/Minecraft) + a no-code audit of all coverage games + the resulting design. Decisions summarized in MULTIPLAYER-DX-PLAN.md §14.

# The three-tier creator model for Decentraland Studio

*(answering: "how does Roblox solve code vs no-code — are prefabs our no-code tier?")*

---

## 1. The tier model

Three grips on one substrate. Named in creator terms — this exact vocabulary goes into §1's copy table:

| Tier | Creator name | The gesture | What it honestly expresses |
|---|---|---|---|
| **Tier 0** | **Place it** | Drag a ready-made piece from the library; edit its card — numbers, enums, Picks, names; drag children under it | Complete vertical features, tuned per-instance: rounds (Game Flow), scores (Points), boards that survive re-publish (Leaderboard), doors, collectibles, damage zones, finish lines, announcements — *including cross-prefab behavior wherever the kit's shared vocabulary covers it* (Collectible→Points, zone-name→Health, source-key→Leaderboard) |
| **Tier 1** | **Ask for it** | Describe the mechanic in a sentence; the assistant writes a script on `game`; you review the diff with green stripes, never the code | Bespoke causality *between* pieces and novel game rules: "finding chest 1 reveals chest 2", "first to 50 ends the round", the accelerating clock. Output is code and can be wrong — that's why the diff review, lints, and `game.md`/ai.md contracts exist |
| **Tier 2** | **Script it** | Open `src/scripts/`, write TypeScript against `game` — one object, two colors, three verbs | Everything the platform can do. The same API the prefabs and the assistant use — there is no second, rawer layer |

**The promotion path is the whole design.** A scene mixes all three tiers freely, and each tier is made of the one below it: a prefab *is* a Tier-2 script with inspector params; an assistant diff *is* a Tier-2 script you happened not to type. There is no format cliff. This is our structural advantage over both failure modes in the research: UEFN's Direct-Event-Binding webs must be *rewritten* in Verse past modest complexity, and Horizon's CodeBlocks must be *migrated* to TypeScript. In Studio, "graduating" means opening a file that already existed. A Tier-0 creator who peeks at the diff the assistant wrote is already halfway up; nothing they built is thrown away.

**Mapping to Roblox's reality.** Roblox's no-code tier is toolbox models with Luau embedded, configured via Attributes, composed as same-kit families, plus starter templates — and its ceiling is sharp: any *game rule* (scoring, rounds, saving, damage) forces Luau or a purchased kit that happens to cover it. Our Tier 0 clears that ceiling with room to spare: **rounds, scoring, persistence, and server-authoritative damage are first-party Tier-0 config in our kit**, not Luau-behind-a-kit. Where Roblox is genuinely more generous — physics contraptions via constraints/motors, free-form vehicles — we concede deliberately (non-goal 5: no synced physics verb exists, scene CRDT can't carry it; that's engine physics, not a UI gap). And Roblox's replacement for a wiring UI is exactly our Tier 1: Studio Assistant, prompt-to-code. The biggest UGC platform on earth ships zero event-wiring UI. The owner's instinct is the industry answer.

---

## 2. The composition doctrine

Goes into §6 verbatim as **"How prefabs talk to each other (the no-wiring rules)"**. Five rules, one enforceable line, one sanctioned escape.

**The one-intrinsic-verb rule (the enforceable line):** *A prefab card may carry config for exactly one intrinsic verb — the thing the prefab IS. Config values may be magnitudes, enums of standard occasions, one-way pointers at channels (zone names) or keys (state keys), or entity Picks. Never a choice of action, never a row pairing an event with an action, never a dropdown whose value space is verbs targeting other entities.* The shipped Spawner is the precedent (one action: spawn my prefab; a `when` enum of occasions; targets from structure and names). Any card that accretes a second verb is Actions/Triggers by erosion and gets rejected in review — write this in §6 so the zone card can't accrete.

**The five mechanisms, in order of preference:**

1. **Config on the actor.** Behavior config lives on the prefab that *performs* the verb, never the one that detects the occasion. Consumer-side authoring is the canonical shape.
2. **Shared channels by NAME, semantics fixed by the listener.** Zone names and state keys are the kit's vocabulary — Roblox tags, Minecraft scoreboard names. A name does nothing until a listening prefab consumes it, and *what* it does is fixed by that listener's identity, never chosen per-event. N-to-M coupling falls out free: three prefabs pointed at zone "Moat" all react, no wiring rows.
3. **Structure.** childrenOf/containment ("this behavior governs that subtree" — spawn spots, slot children, waypoint children) and entity-ref Picks (Door→lever).
4. **Kit as family.** The built-in kit is designed like a tycoon kit, not a pile of strangers' models: one shared vocabulary (the Points channel, the board-key convention, zone names), contracts written down in each ai.md. This is the gap the research identified — Roblox proves cross-kit stranger composition is unnecessary *if* the first-party family is coherent.
5. **Where a wall is fundamental, the answer is Tier 1 — an AI prompt — never a wiring UI.** Every wall gets a sanctioned prompt sentence in the prefab's copy (see §3d), so hitting the wall teaches the next tier instead of dead-ending.

**The §6/§12 flirt cases, ruled:**

- **Leaderboard/podium `source key` — config, unambiguously.** A read-only data binding: a pointer at a key, no events anywhere. The safest shape in the doctrine. *Amendment required to make it real:* resolve §12 #4 in Points' favor — **Points auto-publishes a saved top-N to a well-known state key** (`points.board` by default, key configurable). Without that, the source key points at a key nobody writes and the "config-only reader" claim is glue in disguise.
- **Collectible "gives points: N" — config.** Occasion (collected) and action (award points) are both intrinsic to what a Collectible *is*; the config is only a magnitude, published one-way over the kit's Points channel. This is the kit's flagship built-in channel — document the contract in both ai.md's.
- **Zone "damage on enter" — redesigned so it is config.** As written in §12 #6 it's the first crack: Trigger Zone's intrinsic verb is *detection*, so damage config on the zone card is a second verb — the accretion path (damage → points → teleport → an action list) ends at Actions/Triggers. **Ruling: the routing config moves to Health & Respawn** — `Hazard zones: Moat (100), Lava (999)` — because damage *is* Health & Respawn's intrinsic verb, and the config is a pointer at a name-channel plus a magnitude: canonical doctrine shape. The zone card stays pure. Amend §12 #6 accordingly.
- **"Zone X entered → give N points" as Points config — rejected.** It hands Points a trigger slot and restarts the accretion. The honest fix is the one new prefab below.
- **Announcer `when` enum (player joins / round starts / round ends) — config**, by the Spawner precedent: fixed intrinsic action (show my message), enumerated standard occasions. Without it Announcer is a sink with no no-code source — not a Tier-0 prefab at all.
- **NEW PREFAB: Finish Line** (a Checkpoint/Finish zone variant). Intrinsic occasion: verified entry, once per player per round (needs `game.round.id`). Intrinsic action, an enum: *record best time* or *award N points*; writes a board key. This single prefab closes the first wall of **both** race and towerofmadness-lite entirely inside the doctrine — the two coverage rows that currently hide wall (c). It is the kit's honest answer to "the Finish zone does nothing."
- **Pickup "on collected → spawn/open X" — rejected**, correctly Tier 1. An event→action pair between strangers is exactly the residue the assistant exists for.

---

## 3. Plan amendments

### (a) Yes, the kit moves earlier — restore the shipping plan's own P3

The smoking gun stands: `MULTIPLAYER-SHIPPING-PLAN.md` §4 defines **P3 = "Memory + core kit"** with exactly the right subset and the proof "race/coin-collect/hangout coverage rows", but the PR-by-PR expansion silently dropped the kit to T2-c. The kit didn't lose an argument; it fell out during expansion. Restore it as a **K-track inside Tranche 1**, gated only on PR 7 (everything in the subset needs at most PRs 3–7; nothing needs PR 8's template flip — prefabs carry their own modules — nor PRs 10–14, spawn, report, the ledger, or the spikes):

**Revised Tranche-1 order:** PRs 1–7 unchanged (the facade substrate, unavoidable) → then the K-track lands **in parallel with PRs 8–12** (kit PRs touch `packages/desktop/prefabs/`, not the facade — no merge contention) → PRs 13–14 close as before.

| K-PR | Prefab (+ doctrine config) | Floor |
|---|---|---|
| K1 | Door & Switch (+ `opensWhen`: switch clicked / zone entered: name) | PR 3, 4 |
| K2 | Leaderboard rewrite + source key (flagship example) | PR 4 (PR 5 for all-time) |
| K3 | Points + **built-in saved top-N → board key** (§12 #4 resolved) | PR 5 |
| K4 | Collectible (playerData-backed, + `resets each round`) | PR 5, 6 |
| K5 | Announcer + `when` enum | PR 3, 6, 7 |
| K6 | Health & Respawn (+ hazard-zones routing, + die-below-height) | PR 6 |
| K7 | **Finish Line** (new) | PR 6, 7 |
| K8 | Game Flow (fixed-timer mode; script-ended mode ships too — it's Tier-2-facing by design) | PR 7 |

Each is one small PR via `add-builtin-prefab`, ~8 PRs, consistent with "minimal, small PRs". **Stays Tranche 2, honestly:** Pickup (needs `spawn`), Waves + Level Slots (biggest reworks; wave-survival and treasure-hunt rows slip — say so), Teams (zero config-level consumers yet), Save Point (scope undefined), Spawner enum + server-agreed spawn.

**New Tranche-1 acceptance row**, alongside the existing verbatim-games test: **"Hangout, coin collect, and race assemble from prefabs alone — zero scripts, zero AI prompts, verified with a second client."** Today that row is promised by §6's coverage table and proved by nothing before T2-c — and per the audit it isn't even *true* of §6 as written without K3, K4, K5, K7's additions. The existing acceptance test validates only Tier 2; this row validates Tier 0.

### (b) Config options that push the no-code frontier, cheapest first

1. Points auto-published board key (K3) — unlocks Leaderboard *and* Game Flow's podium as pure readers.
2. Announcer `when` enum (K5) — turns a sink into the hangout tier's reactive prefab.
3. Collectible `resets each round` (K4) — closes coin-collect's first wall.
4. Health & Respawn hazard-zones + die-below-height (K6) — "drowning: zero code" becomes true, doctrine-shaped.
5. Door `opensWhen: zone entered` (K1) — proximity doors for hangouts.
6. Finish Line enum record-time/award-points (K7) — closes race and ToM-lite.
7. *Tranche 2:* Waves `points per kill` (intrinsic occasion, fixed action — safe); Game Flow podium source key.
8. **Strike the tower-defense coverage row** (or re-scope to "creeps on paths") exactly as tag/quiz were struck — there is no tower, and the coverage line is a promise to creators.

### (c) The template tier — yes, and it's nearly free

Core's game frameworks and Roblox's starter places prove templates are the most underrated no-code lever: the whole-game wiring ships pre-made and *correct*, and creators edit inside a working loop. Our plan buries this in G7/T2-f, behind everything.

**Amendment:** decouple *starter templates* from *the Arena + 45-minute sitting*. The new acceptance row in (a) produces, as its artifact, working scenes: coin collect and race assembled from kit prefabs only. **Ship those two scenes as starter games in the new-project flow at the end of Tranche 1** — "Coin Rush" and "Race Day", each complete-but-with-one-obvious-hole (the Core lesson: creators learn by filling the hole). Zero new mechanism — templates are scenes; the acceptance test and the template are the same deliverable, so the marginal cost is copy and a thumbnail. The full Arena template (Waves, spawns, the rehearsed sitting) stays T2-f unchanged — it needs T2 surface.

### (d) Editor surfaces so a no-code creator FINDS the tiers (§3/§6 additions)

All copy, no mechanism — each line must change what a creator does (less-is-more), and none of it is per-instance wiring:

1. **Library panel — "Works with" line.** Each kit prefab card carries one static, hand-authored family line derived from its channel contract: Collectible — *"Sends its points to the Points piece."* Leaderboard — *"Shows a board — Points publishes one automatically."* Health & Respawn — *"Name a Trigger Zone under Hazard zones and it hurts."* This solves the "this prefab works with X" hint problem the Roblox way — kit-family documentation, not eyedroppers.
2. **Teaching empty states at the seams** (discoverability-first, standing pattern). Leaderboard placed with no Points: *"Nothing to show yet — place Points, or ask the assistant to write scores to a board key."* Announcer with `when: manual` and no admin-tools: same shape. The seam between prefabs is where confusion lives; the empty state is where the hint belongs.
3. **The sanctioned prompt on every wall.** Where the doctrine says "Tier 1", the card's footer says so in a copyable sentence: Trigger Zone — *"Want entering this zone to do something custom? Ask the assistant: 'when a player enters Moat, …'"*. Pickup — *"Want collecting this to reveal something? Ask the assistant."* The AI entry point stops being a separate destination and appears at the exact moment of need — this is how a Tier-0 creator discovers Tier 1 without ever being told "now learn to code."
4. **Coverage-table honesty in §6:** each coverage row gains its tier — "prefabs alone" vs "prefabs + one prompt" — so the table stops silently mixing tiers (race was claiming Tier 0 while assuming Tier-1 glue).
5. **Write the one-intrinsic-verb rule into §6** as a reviewer-enforced rule, per §2 above.

---

## 4. What we refuse — and what Roblox does that we deliberately won't

**Unchanged non-goals, restated against this lens:** No Actions/Triggers, node graphs, or event-wiring UIs — UEFN is the controlling counter-example: Direct Event Binding powers a real no-code tier and pays with duplicated-device binding forks, untraceable webs, and Epic's own "graduate to Verse" talk; the one platform that bet on wiring is the cautionary tale, not the model. No authority toggles (Roblox's FilteringEnabled arc). No second rawer API beside `game`. No per-frame sync verb. No network debugger. No upstream SDK changes. The tier model *strengthens* the Actions/Triggers rejection: across all eight audited builds, only treasure-hunt sequencing and flag mechanics genuinely want wiring, and both belong to Tiers 1–2 by the doctrine.

**Roblox practices we deliberately skip:**

- **An open toolbox of strangers' scripted models.** Roblox's marketplace ships arbitrary embedded scripts — hence its own "Disable Scripts on insert" button and a devforum culture of vendored dependencies. We ship a **curated first-party kit designed as one family** plus Hub-format prefab folders the creator controls. Coherent vocabulary beats infinite inventory; the audit shows cross-kit stranger composition doesn't work on Roblox either.
- **A visual-scripting mid-tier** (Horizon CodeBlocks). Blocks are still programming — a third syntax to learn and then migrate off; Meta itself routes serious logic to TypeScript. Our mid-tier is prompt-to-code, which is where Roblox's own ecosystem (Studio Assistant, Lux, RoCode) is heading anyway — we skip the detour.
- **Physics constraints as a behavior tier** (hinges/motors/vehicles). Honest concession: the platform has no synced physics and no per-frame sync verb by design (non-goal 5). We don't fake it.
- **Free-form tags as a generic mechanism.** Our shared vocabulary is *scoped*: zone names and state keys with semantics fixed by listening prefabs. A generic tag editor is a vocabulary with no dictionary — it invites the "tag does nothing" confusion Roblox tolerates.

---

## 5. Verdict

**The owner is right, with one correction.** Prefabs *are* the no-code tier, and the architecture already in the plan is structurally identical to how Roblox — the existence proof at scale — solves this: behavior travels inside the asset, properties are the knobs, names are the shared vocabulary, kits are families, templates ship the whole loop, and the only causality layer is code, increasingly AI-written. No platform-shaped piece is missing, and the Actions/Triggers rejection survives contact with every audited build. What was wrong is only the calendar: the current PR order ships the Luau-equivalent for the entire v1 period before shipping any of the toolbox — and the shipping plan's own P3 phase table already contained the fix. Restore the core kit into Tranche 1 (K1–K8 after PR 7), add the Finish Line prefab and the four config options, ship the two acceptance-artifact starter games, and the no-code tier lands with v1 instead of a year after it.

**The story we tell creators:** *You never have to code in Decentraland Studio — and you never hit a wall where your work stops counting. Place ready-made pieces and set their options: rounds, points, doors, damage zones, leaderboards that remember every visitor — real multiplayer, running on the game, no scripts. When you want something the pieces don't do, ask the assistant in a sentence and it writes that one behavior for you — you just review what it says it will do. And if you ever open the code, you'll find your whole game already there in one small, honest API — because the pieces and the assistant were using it all along.*
---
# Appendix A — no-code audit (where each build hits its first wall)

# No-code audit of the multiplayer plan (§6 kit + §13 order)

Sources: `docs/MULTIPLAYER-DX-PLAN.md` (§6, §12, §13), `docs/MULTIPLAYER-SHIPPING-PLAN.md`, `docs/transcripts/MULTIPLAYER-GAME-WALKTHROUGHS.md`, `docs/PREFABS.md`. Ground rule applied: the no-code creator places prefabs, edits inspector fields, uses Pick/dropdown, names zones, drags children — never opens a script. AI prompts are treated as a separate semi-code tier and count as a "wall."

## 0. What no-code composition exists TODAY (pre-plan)

Genuinely config-only today: **Spawner** (parent-derived triggers — zone parent = walk-in, other parent = click; name-as-id; spawn-spot child; but client-local copies only), **Trigger Zone** (name = channel), seats, video-screen + admin-tools, server-clock. Everything multiplayer-consequential (round-loop, wave-director, player-rig, leaderboard scoring) is shelved or script-tier: leaderboard's `submitScore`/`awardScore` are script APIs, zone-authority is script infrastructure. So today the no-code tier ends at "things appear on my screen."

## 1. The eight builds — placement walk + exact first wall

### 1.1 Hangout — the one genuine zero-code win
Place: seats, video-screen + admin-tools, **Door & Switch** (Pick → lever), Spawner for décor, Announcer, Collectibles for flavor. All config.
**First wall:** the first *reactive* wish — "greet players when they arrive" or "door opens when someone approaches." Announcer as spec'd (§6) is a **sink** for `game.send('announce')` — it has no no-code *source* except admin-tools manual announcements; Door & Switch is click-only. **Class (b)** — missing config options (`Announcer.when: player joins/round start`; `Door.opensWhen: switch clicked / zone entered: <name>`). A creator who wants nothing reactive never hits a wall. Verdict: coverage-row claim honest.

### 1.2 Race / parkour — wall at the very first mechanic
Place: Game Flow (5:00), Trigger Zone "Start", Trigger Zone "Finish" (+ Zone Authority), Health & Respawn (spawn-point children; "die below height" — note W2-correction #8 says this config is *assumed, not in §6 scope*), Points, Leaderboard (source key), Save Point.
**First wall: the Finish zone does nothing.** No config anywhere turns "entered Finish" into a recorded time or awarded points — that glue is exactly W2's `madness-race.ts`. **Class (c), the purest instance** — the zone→score channel is in neither Trigger Zone's nor Points' scope, precisely parallel to the zone→damage gap the plan already caught (§12 #6). The coverage row "race = Game Flow + Zones + Points + Leaderboard + Save Point" silently assumes this channel. Times (not just points) additionally need Game Flow-aware timing → without a dedicated prefab it's (d).

### 1.3 Wave survival
Place: Game Flow, Waves (zombie = Pick prefab; waves table = Game Config), Health & Respawn, Points, Leaderboard. Waves→Health bite damage plausibly stays internal to the kit (the old wave-director/player-rig validator channel) — but §6's Health & Respawn rework never says whether the **gun** (old player-rig's hitscan) survives; if not, the wall is "players can't fight" **(b)**.
**First wall (assuming the gun ships): kills award nothing.** Waves has no `points per kill` config and Points has no kill channel. **Class (b)/(c)** — one Waves config field publishing over the Points channel closes it (intrinsic occasion, fixed action — safe, see §3).

### 1.4 Coin collect — closest to fully closed
Place: Collectible ×30 (gives points: 1), Points, Leaderboard, optional Game Flow. Works zero-code — Collectible→Points is the kit's one fully built-in inter-prefab channel.
**First wall: rounds.** Collectible is once-ever (playerData-backed, per the walkthrough correction #4); "coins come back each round" needs a `resets each round` option — **class (b)**. Right behind it: "first to 50 wins" = script-ended round → **(d)**, correctly script/AI tier.

### 1.5 Tower defense — the overclaimed row
Place: Game Flow, Waves marching a path (path authoring unspecified — presumably waypoint children; even that is an assumption), Points.
**First wall: there is no tower.** Nothing in the kit attacks enemies; the coverage row "Waves' paths + Points — layout's ideal fit" covers only the *creeps marching*. A turret prefab is **class (a)** missing prefab; the build-towers-with-earned-points economy is (a)+(d). Without them this is wave survival along a path, not TD. Recommend striking or re-scoping this coverage claim the way tag/quiz were struck — the coverage line is "a promise to creators."

### 1.6 Treasure hunt
Place: Pickup ×N hidden (points 30, respawns each round), Points, Leaderboard. Basic hunt works zero-code — *in the kit-complete world*. Note: Pickup is the canonical `game.spawn`, and spawn is Tranche-2 (T2-a), so in shipping-order reality this row slips furthest.
**First wall (kit-complete): sequencing** — "finding chest 1 reveals the clue/next chest." Chained spawn-on-collect is an event→action pair; **class (d)** and *correctly* so — this is a wall the no-code tier should have, since closing it with config would be Actions/Triggers.

### 1.7 Simplified towerofmadness (rounds + seeded tower + finish + boards)
Place: Game Flow (10 min), **Level Slots** with slot children stacked vertically and arenas = the 10 chunk prefabs (a config-only random tower — fixed height, weaker than the seed-count-varying original, but real), Health & Respawn (die-below 7, respawn pad), Zone "Start", Zone "Summit" + Zone Authority, Leaderboard ×2 (source keys), Announcer.
**First wall: summiting is silent.** No config records a finish, awards points, or writes `bestTimes` — same missing zone→score channel as race, **class (c)**; the accelerating clock is **(d)** (signature mechanic, correctly custom — needs Game Flow's script-ended-round mode, itself script-facing by definition). Sub-wall: Leaderboard's source key points at a state key *nobody writes* unless Points auto-publishes a top-N key — §12 #4 names this seam but doesn't resolve whether Points ships the built-in saved top-N. If it doesn't, even the points board is glue-code **(b)**.

### 1.8 Simplified flagtag (flag + steal + rounds + boards)
Place: Game Flow, Points, Collectible coins, Health & Respawn, Zone "Moat" + damage routing, Announcer, Leaderboard. All fine.
**First wall: the flag itself, immediately.** No carryable prefab exists — Pickup awards-and-despawns; it doesn't ride a player's back, isn't visible to others, can't be stolen. **Class (a)** missing prefab with **(d)** underneath: steal is the struck PvP verb (decision #3), carry waits on the AvatarAttach spike (G1-b), hold-time scoring is custom. The no-code creator gets castle + coins + rounds + boards; the game's identity is unreachable — and even the semi-code AI tier only delivers click-steal (W1 strain #1).

## 2. Inventory — config-only vs secretly-assumes-glue (§6 kit)

| Prefab | Verdict | The hidden assumption |
|---|---|---|
| Door & Switch | **config-only** | click-only; zone/proximity opening = missing enum |
| Collectible | **config-only** | assumes Points placed; channel contract unwritten; no per-round reset |
| Pickup | config-only *in T2* | needs `game.spawn` (Tranche 2); Points channel unwritten |
| Points | **half** | tracks fine; has no no-code *inbound* channel except Collectible/Pickup; whether it auto-publishes a board key is unresolved (§12 #4) |
| Leaderboard + source key | **config-only as a reader** | someone must write the key — glue unless Points publishes it |
| Game Flow | config-only (fixed timer) | podium reads a key (same seam); script-ended mode is script-tier by design |
| Health & Respawn | config-only **iff** G5 zone-damage routing + die-below-height ship | both were "invented capability" per the walkthrough corrections; weapon story unspecified |
| Waves | half | zombie Pick + table are config; kill→Points and path authoring unspecified |
| Level Slots | config-only | assumes slots-as-children authoring is real |
| Announcer | **secretly glue** | it's a message *sink*; no no-code trigger |
| Teams | **secretly glue** | nothing else in the kit is team-aware — a fact-provider with zero config-level consumers |
| Save Point | config-only | scope ("progress" = what?) undefined |
| Trigger Zone / Zone Authority | pure channel/infrastructure | a zone alone does nothing; its only shipped no-code consumer is the (client-local) Spawner |
| Spawner | **config-only, the house pattern** | client-local only; "appear for everyone" waits on T2-b server-agreed spawn |

## 3. Wall (c) precision — where config becomes Actions/Triggers

The line, stated so it's enforceable: **a prefab may carry config for exactly one intrinsic verb; config values may be numbers, enums of standard occasions, one-way pointers at channels (zone names) or keys (state keys), or Picks — never a choice of *action*, and never rows pairing events with actions.** The shipped Spawner is the precedent: one intrinsic action (spawn my prefab), an enum of occasions (`when`), targets derived from structure/names. The forbidden shape is any dropdown whose value space is verbs targeting other entities.

Per flirting capability:

- **Leaderboard/podium source key** — safest possible: a read-only data binding, no events at all. Right side, unambiguously.
- **Collectible "gives points: N"** — right side: occasion (collected) and action (award) are both intrinsic to the prefab's identity; the config is only a magnitude, published one-way to the Points channel.
- **Zone "Damage on enter: 100"** — right side *as one field*, but it's the first crack: the zone's intrinsic verb is *detection*, so damage config is a second verb on its card. The accretion path (damage today → points tomorrow → teleport → an action list = Actions/Triggers by erosion) is the real danger. Prefer consumer-side authoring ("Hazard zones: Moat" on Health & Respawn — the consumer's intrinsic verb is damage, so the config is a pointer at a channel, canonical shape) or an intrinsic **Hazard Zone** variant. Whichever wins, write the one-intrinsic-verb rule into the plan; today nothing stops the zone card accreting.
- **"Zone X entered → give N points" as a Points config** — expressible as one-way (Points owns 'award'; config names zone + N), but it hands Points a trigger slot and invites the same accretion. The cleaner answer is a new intrinsic prefab (next section).
- **Announcer + a `when` enum** (player joins / round starts / round ends) — acceptable by the Spawner precedent (fixed action, enumerated occasions). Without it, Announcer isn't a no-code prefab at all.
- **Pickup "on collected → spawn/open X"** — over the line (event→action pair); correctly left to the AI/script tier.

**The one new prefab this audit says the kit needs: a "Finish Line / Checkpoint" zone** — intrinsic occasion (verified entry, once per round per player) and intrinsic actions (record time vs award N points, an enum; writes a board key). It closes the first wall of *both* race and ToM-lite entirely inside the line, and it's the honest fix for the two coverage rows that currently hide wall (c).

## 4. Shipping order — yes, it's backwards, and the plan already knew

**The facts:** the 14-PR Tranche 1 contains zero prefabs; the kit is T2-c, behind T2-a (spikes + spawn family) and T2-b (report + Spawner enum) as well. For the entire v1 period the only creator story is custom code + AI, and the acceptance test (both walkthrough games verbatim) validates *only the code tier*. Every coverage-table promise ("assembled from prefabs alone, zero custom code" — G5's prove-it) sits behind all 14 PRs plus two more tranches.

**The smoking gun — an internal inconsistency in `MULTIPLAYER-SHIPPING-PLAN.md`:** its own §4 phase table defines **P3 = "Memory + core kit"** naming exactly the right subset — *Game Flow (+script-ended-round mode), Points, Leaderboard (+source key), Door & Switch, Collectible (playerData-backed), Announcer, Health & Respawn (+zone damage routing)* — with the P3 proof "race/coin-collect/hangout coverage rows." But the PR-by-PR expansion of the same document dropped the kit from Phase 3 (PRs 13–14 are only Saved-data + secret; B23-subset vanished) and moved all prefabs to T2-c, without updating the phase table or the "Closes Tranche 1" claim. The kit didn't lose an argument; it fell out during expansion.

**Nuance in the plan's defense:** kit-first is impossible — every reworked prefab is built *on* `game`, so PRs 1–7 are unavoidable substrate, and the two-real-games acceptance test is a legitimately strong spine. The mistake isn't Phase 1; it's queuing PRs 8–14 *and* T2-a/T2-b ahead of any prefab.

**Minimal no-code kit subset + its true dependencies on the 14 PRs:**

| Prefab | Needs at most |
|---|---|
| Announcer (+`when` enum) | PR 3 (send/onMessage); joins → PR 6, rounds → PR 7 |
| Door & Switch | PR 3 + PR 4 (state); Pick = existing dropdown EntityPicker |
| Leaderboard rewrite + source key | PR 4 (+ PR 5 for all-time) |
| Points (+ built-in saved top-N published to a state key — resolve §12 #4 in its favor) | PR 5 |
| Collectible (+ per-round reset option) | PR 5 + PR 6 (onClick) |
| Health & Respawn + zone damage routing | PR 6 (zones/positions/join-leave) |
| **Finish Line / Checkpoint** (new) | PR 6 + PR 7 (round validity) |
| Game Flow | PR 7 (rounds) |

Nothing in this subset needs PR 8 (template flip — prefabs carry their own modules), PRs 10–14, spawn/despawn, report/outcomes, the ledger, the spikes, or the pick gesture. **Everything is unblocked the moment PR 7 merges.** Deliberately excluded and fine to stay T2: Pickup (needs spawn), Waves + Level Slots (biggest reworks; wave-survival/treasure-hunt slip — the honest cost), Teams (no consumers yet), Save Point (nice-to-have). Tower defense should be re-scoped or struck from coverage regardless.

**Recommended reorder:** restore the P3 core kit as a Tranche-1 track — ~8 small prefab PRs via `add-builtin-prefab`, interleaved after PR 7 (they parallelize with PRs 9–12 since they touch `prefabs/`, not the facade), each landing one prefab + its config surface. Add a second acceptance row to Tranche 1: **"hangout, coin collect, and race assemble from prefabs alone — zero scripts, zero AI prompts."** That row is currently promised by the coverage table, proved by nothing before T2-c, and — per this audit — not even true of the §6 configs as written without the Finish Line prefab, the Collectible round-reset option, the Announcer `when` enum, and a resolved Points→board-key contract.

**Bottom line for the owner's Roblox question:** Roblox's "no-code tier" is not a wiring UI — it's toolbox models with scripts inside, configured via attributes, plus templates; structurally that is exactly this plan's prefab kit, so the architecture is right and the Actions/Triggers rejection survives contact with all eight builds (only treasure-hunt sequencing and flag mechanics genuinely *want* wiring, and both correctly belong to the script/AI tiers). What's wrong is only the calendar: the plan ships the Luau-equivalent for a year before shipping the toolbox, and its own phase table already contained the fix.
---
# Appendix B — platform research

## How Roblox actually layers no-code and code (and what peers do)

### 1. Roblox — the closest analog to our position, and it ships ZERO event-wiring UI

**What a creator does with zero Luau.** Drag/drop parts and terrain; the Properties panel (color, material, anchoring, transparency, collision); lighting/atmosphere; particle emitters; and — underappreciated — **physics constraints as genuine no-code behavior**: a HingeConstraint with `ActuatorType = Motor` spins a wheel toward a target AngularVelocity with configurable torque, so a driveable-ish car, doors, elevators-on-prismatics, and suspension are buildable with properties alone ([HingeConstraint docs](https://create.roblox.com/docs/reference/engine/classes/HingeConstraint), [constraints tutorial](https://devforum.roblox.com/t/how-to-implement-vehicle-mechanics-using-constraints/3575431)). DragDetectors make objects grabbable without scripts. Studio ships **starter templates** (obby, racing, village, laser tag) as whole playable games.

**How toolbox models ship behavior.** A free model is a folder of parts **with the Luau scripts embedded inside the model** — behavior travels with the asset; Studio even offers "Disable Scripts" on insert because scripts-in-models is the norm ([Toolbox docs](https://create.roblox.com/docs/projects/assets/toolbox)). The config surface is a **convention, not a platform feature**: either Attributes (typed key-values shown directly in the Properties panel) or a `Configuration` folder of ValueObjects the model's own scripts read. The devforum debates which is better ([Attributes, Configurations, or Folders?](https://devforum.roblox.com/t/attributes-configurations-or-folders/2075974)) — but both are exactly our "scripts with inspector params" pattern: the buyer flips numbers, never opens the script.

**CollectionService tags.** Studio now has a built-in Tag Editor ([announcement](https://devforum.roblox.com/t/tag-editor-plugin-for-studio/2055202)); the workflow is: builder tags instances ("Lava", "Checkpoint"), one script per tag applies behavior to everything tagged. Crucially, **a tag does nothing until a script consumes it** — tags are a shared vocabulary between the building tier and the code tier, i.e. our zone-names/state-keys mechanism, not a wiring UI.

**Where no-code ENDS on Roblox — sharply.** Any *game rule* forces Luau: scoring, rounds, saving (DataStore), damage (even a kill brick is `Touched → Humanoid.Health = 0` — that's why the toolbox "Kill Part" asset exists: it's a part *with the script inside*), custom UI logic, anything server-authoritative. Community guides agree the no-code ceiling is "obby/tycoon assembled from kits; interactive mechanics require Luau" ([nilo obby guide](https://nilo.io/articles/create-obby-without-scripting), [jetlearn](https://www.jetlearn.com/blog/can-you-make-a-roblox-game-without-coding)).

**How two toolbox models interact — the honest answer: they don't.** Roblox has no editor gesture to connect model A to model B. Interaction happens only when (a) both come from the **same kit** sharing name/tag/attribute conventions (tycoon kits are the canonical case — droppers, conveyors, buttons all read one config vocabulary), (b) one model's script looks the other up by name/tag, or (c) you write glue Luau. Model authors who need dependencies literally **vendor copies of the dependency inside each model** ([devforum dependency thread](https://devforum.roblox.com/t/dependencies-between-packages-or-free-models/2860763)). Cross-kit composition between strangers' models is effectively unsupported, and Roblox is still the biggest UGC platform on earth — evidence that arbitrary prefab-to-prefab wiring is *not* a prerequisite for a thriving no-code tier.

**AI.** The official [Studio Assistant](https://create.roblox.com/docs/assistant/guide) generates context-aware Luau in-editor; the 2025–26 ecosystem (Lux, RoCode, Obby, Nilo) is converging on "describe the mechanic, AI writes and wires the script" ([obby.fun roundup](https://www.obby.fun/blog/roblox-studio-ai)). Roblox's answer to "no-code causality" is increasingly **prompt-to-code, not a wiring UI**.

### 2. Fortnite / UEFN — the platform that DID choose event wiring

Devices are configured prefabs with two distinct surfaces, and the distinction matters for us:

- **Own properties ("User Options")** — score values, timers, team filters, activation behavior, item lists. Compatible with our rules. Many devices are meaningfully standalone (spawn pad, item granter, capture area with its own scoring, storm controller), and a lot of Creative maps are built from standalone devices + island settings only ([Getting Started with Devices](https://dev.epicgames.com/documentation/fortnite/getting-started-with-devices-in-fortnite)).
- **Cross-device communication** — this is *exactly* our rejected Actions/Triggers. Old system: numbered broadcast **channels** (transmit on channel 3 / receive on channel 3), which creators hit limits on and had to plan allocation for. Since v25.00, **Direct Event Binding**: in device A's Details panel you bind "On Triggered" to an eyedropper-picked device B and choose which of B's functions to call ([DEB docs](https://dev.epicgames.com/documentation/en-us/fortnite/direct-event-binding-in-unreal-editor-for-fortnite), [transition post](https://create.fortnite.com/news/the-transition-to-direct-event-binding-to-occur-in-fortnite-v25-00?team=personal)). It has classic wiring pathologies: duplicating a device silently forks bindings; large maps become untraceable webs — Epic's own Unreal Fest talk is titled ["Direct Event Binding versus Verse"](https://dev.epicgames.com/community/learning/talks-and-demos/4JkO/fortnite-uefn-direct-event-binding-versus-verse-unreal-fest-2023) because past modest complexity creators are told to move to Verse ([Coding Device Interactions in Verse](https://dev.epicgames.com/documentation/en-us/fortnite/coding-device-interactions-in-verse)).
- **Verse** is the code tier; every device exposes a Verse API mirroring its events/functions.

So UEFN proves event-wiring UIs *can* power a huge no-code tier — but it's a deliberate platform bet with its own scaling wall, and it's the one mechanism we've ruled out. The importable lesson from UEFN is the **richness of device own-properties**, not the bindings.

### 3. Peers, briefly

- **Core (Manticore):** "Game frameworks" — complete playable games (Team Deathmatch, Battle Royale, Dungeon Crawler) you start *inside* and reskin/extend; community content marketplace; Lua beyond that ([frameworks](https://learn.coregames.com/lessons/build-your-first-game-deathmatch/), [Unreal interview](https://www.unrealengine.com/en-US/developer-interviews/built-on-unreal-engine-core-aims-to-make-game-development-accessible-to-the-masses)). Proves the **template tier**: the game-level wiring ships pre-made; no-code users edit within it.
- **Horizon Worlds:** CodeBlocks visual scripting ("When X…" blocks) → TypeScript in the desktop editor, with an official migration path and explicit advice to move heavy logic to TS ([code blocks](https://developers.meta.com/horizon-worlds/documentation/desktop-editor/vr-creation/scripting/use-code-blocks/), [TypeScript docs](https://developers.meta.com/horizon-worlds/learn/documentation/typescript/typescript/)). Note: block scripting is still *programming* (a mid-tier), not property configuration — and Meta itself treats it as the on-ramp to real code.
- **Minecraft:** the cleanest tier ladder in the industry: redstone (in-world *physical* logic — composition by spatial adjacency, no UI wiring at all), command blocks (imperative snippets placed in the world), datapacks/behavior packs (files), mods (code). Its "no-code conventions" layer is scoreboard tags and entity names — the same shared-vocabulary trick as Roblox tags and our zone names.

### 4. The honest taxonomy: no-code composition WITHOUT event-wiring UIs

| Mechanism | Proven by | Can express | Cannot express |
|---|---|---|---|
| **(a) Self-contained behavior + config properties** | Roblox free models w/ Attributes/Configuration; UEFN device User Options; our prefabs + inspector params | Complete vertical features (door, turret, checkpoint, scoreboard) tuned per-instance without opening code | Causality *between* two features that weren't designed together |
| **(b) Shared-world conventions: names/tags/channels/state keys** | Roblox CollectionService tags + tycoon-kit config vocabularies; Minecraft scoreboard tags; our zone names + source keys | N-to-M coupling whenever both sides speak the vocabulary (anything tagged "Lava" burns; any prefab listening on zone "arena" reacts); kits composed as families | Novel interactions between two strangers' prefabs with disjoint vocabularies — someone must bridge, in code |
| **(c) Structural composition: containment/attachment/physics** | Roblox model hierarchy, welds, constraints-with-motors; our childrenOf + entity-ref Pick | Spatial/mechanical assembly, ownership, "this behavior governs that subtree", genuinely dynamic physics contraptions | Discrete game logic (scores, rounds, inventories) |
| **(d) Templates / starter games** | Core frameworks; Roblox starter places; Fortnite island templates; our Arena template | The *whole-game* wiring, shipped pre-made and correct; creators edit inside a working loop | Anything off the template's rails |
| **(e) AI prompt-to-code** | Roblox Studio Assistant + 2025–26 ecosystem; our AI assistant writing glue scripts | Exactly the residue the other four can't: bespoke cross-prefab causality and game rules, without the creator reading code | Guarantees — output is code and can be wrong; needs good contracts (ai.md) to hit reliably |

**Bottom line for the owner's question.** Roblox — the existence proof at scale — solves "code vs no-code" with tiers (a)+(b)+(c)+(d) and *no* composition UI whatsoever: models ship their own scripts, properties are the knobs, tags/names are the shared vocabulary, kits and templates cover multi-part experiences, and Luau (now increasingly AI-generated) is the only causality layer. UEFN is the one major platform that instead bet on event wiring, and it pays for it with binding spaghetti and a "graduate to Verse" cliff. Our current stack — prefabs with inspector params, zone names as channels, entity-ref Picks, childrenOf, templates, AI glue — is structurally the Roblox shape, with (e) as the modern replacement for the wiring UI. The gap to close is not a wiring mechanism; it's (b) and (d): stronger shared vocabularies across our prefab kit (kits designed as families, like tycoon kits) and a template tier where the whole-game loop ships pre-wired.

Sources: [Roblox Toolbox docs](https://create.roblox.com/docs/projects/assets/toolbox) · [Attributes vs Configurations thread](https://devforum.roblox.com/t/attributes-configurations-or-folders/2075974) · [Tag Editor announcement](https://devforum.roblox.com/t/tag-editor-plugin-for-studio/2055202) · [Free-model dependencies thread](https://devforum.roblox.com/t/dependencies-between-packages-or-free-models/2860763) · [HingeConstraint](https://create.roblox.com/docs/reference/engine/classes/HingeConstraint) · [Vehicle mechanics via constraints](https://devforum.roblox.com/t/how-to-implement-vehicle-mechanics-using-constraints/3575431) · [Studio Assistant](https://create.roblox.com/docs/assistant/guide) · [No-code obby guides](https://nilo.io/articles/create-obby-without-scripting) · [UEFN Direct Event Binding](https://dev.epicgames.com/documentation/en-us/fortnite/direct-event-binding-in-unreal-editor-for-fortnite) · [DEB transition v25.00](https://create.fortnite.com/news/the-transition-to-direct-event-binding-to-occur-in-fortnite-v25-00?team=personal) · [DEB vs Verse talk](https://dev.epicgames.com/community/learning/talks-and-demos/4JkO/fortnite-uefn-direct-event-binding-versus-verse-unreal-fest-2023) · [Verse device interactions](https://dev.epicgames.com/documentation/en-us/fortnite/coding-device-interactions-in-verse) · [Getting started with devices](https://dev.epicgames.com/documentation/fortnite/getting-started-with-devices-in-fortnite) · [Core Deathmatch framework](https://learn.coregames.com/lessons/build-your-first-game-deathmatch/) · [Core interview](https://www.unrealengine.com/en-US/developer-interviews/built-on-unreal-engine-core-aims-to-make-game-development-accessible-to-the-masses) · [Horizon code blocks](https://developers.meta.com/horizon-worlds/documentation/desktop-editor/vr-creation/scripting/use-code-blocks/) · [Horizon TypeScript](https://developers.meta.com/horizon-worlds/learn/documentation/typescript/typescript/)