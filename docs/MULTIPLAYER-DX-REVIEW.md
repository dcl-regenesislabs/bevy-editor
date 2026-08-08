# Creator-experience review of the Multiplayer DX plan

## 1. Verdict

The plan gets a creator from "place a prefab" to "players click things, the game decides, scores persist" with a genuinely small, well-doctrined surface — the green/blue split, the moment-vs-fact rule, and restart hygiene all survived adversarial review intact. It stops one step past the recipes: a validated outcome can't reach other players' screens, a laid-out entity can't be identified or touched back, and blue code can't read its own player's score — so every game stalls exactly where it should start feeling like a game. Below that sits a harder ceiling the plan never names: anything that moves in response to players (chase AI, tag, a ball) is outside the model, while the flagship Waves prefab and the §6 coverage line imply it works.

## 2. The wall

**The ceiling: shared things that move because of players, and per-player views of shared things.**

The engine facts, verified against the plan and CSS:

- `layout`'s callback receives only `(rng, round)` by construction — player positions cannot influence placement or motion (§2.2, CSS:102).
- Non-goal 5 refuses per-frame sync; laid-out pools have **no canonical position** (CSS:118) — clones are plain client-local entities the server never builds.
- Late-join fast-forward is arithmetic over the seed tuple (CSS:97) — it can replay deterministic paths, but player-dependent pursuit is unreconstructible: a mid-wave joiner's zombies snap to spawn.
- `positionOf` is green-only, ~10 Hz, feet, "generous checks only" (CSS:152) — enough for zones, not for contact.

Consequence: chase/stalk/follow is load-bearing in 6+ genres (zombies, horror, tag, pets, sports, escort), and per-player interaction with shared objects ("hide the coin I collected") has no documented path and one live trap (`removeEntity` on a pooled clone corrupts the pool, CSS:62).

**Candidate strategies** (these frame design decision #1):

1. **Path-only v1, chase explicitly deferred.** Waves become "enemies that follow set paths" — deterministic, fast-forwardable, honest. *Cost:* the flagship action prefab loses its fantasy; the coverage line shrinks. *Risk:* low — this is a copy change plus a constraint, and tower defense (path creeps, layout's ideal fit) becomes a clean claimed win.
2. **Per-screen simulation, honestly worded.** Each screen runs its own zombies; the game tracks damage, not positions. *Cost:* spectators watch hits land on empty air; damage becomes victim-reported and must be server-clamped (finding (c)#2). *Risk:* medium — the consequence line must ship everywhere ("each screen runs its own enemies") or creators will file it as a sync bug.
3. **A coarse-waypoint verb.** Server writes ~1 Hz waypoint tuples keyed to `game.now()`; clients interpolate. Fits the plan's fast/slow split (CSS:158) without per-frame sync, and fast-forward stays arithmetic. *Cost:* new API surface plus a G1-class harness question. *Risk:* highest engineering risk, but the only option that makes "enemies everyone fights together" true.

The per-player-view half of the wall is cheaper: it needs an instance handle from `layout` (gap #1) plus one documented pattern (`VisibilityComponent` on your local clone, never `removeEntity`) — legal today under non-goal 3, just unstated.

## 3. Top gaps (verified high)

**1. `layout` returns positions, not things.** Recipe D's `game.report('hit', { instance, … })` uses an `instance` that is unobtainable — no layout example exposes an entity or id, though `planInstanceId` exists internally (CSS:116). Blocks clicking, animating, or retiring any laid-out copy — the protagonist entity of three of the plan's own games. *Fix:* define the per-instance handle (entity + id, or per-copy script with an exposed id) and show recipe D obtaining it.

**2. No blue-side channel for accepted outcomes.** A validated result has nowhere to go: announce is doctrinally barred for facts, per-instance state keys are unblessed, and `send`'s return reaches only the sender. The kit already has a sequenced outcomes ledger with rejoin fast-forward (CSS:117) — the facade hides its client side. *Fix:* `game.onOutcome(kind, cb)` riding the existing ledger.

**3. Blue code can't read its own player's data.** `playerData(...).get()` is green-only, recipe C forbids the state workaround for scores/inventory, and rejoin has no read at all — so the score HUD, the plan's most basic UI, has no sanctioned live source. *Fix:* read-only blue `game.myData` + `onChange`, or bless the state-mirror pattern with an explicit recipe and size rule.

**4. `send`'s failure contract is unspecified across all four failure modes.** A typo'd name fails silently forever (the "server always responds" guarantee is the rpc layer, not name dispatch); handler-throw, never-wakes queue bounds, and veto-shape are all convention — which recipes A/C discard with `void game.send(...)`. *Fix:* total return/rejection spec; unknown-name → immediate typed error surfaced as a `[game]` card; dev-Play static check for unmatched send/report names (the `guarantees.ts` scanner already reads these call sites).

**5. Placing a recipe prefab twice silently breaks.** Duplicate `onMessage` registration semantics are undefined and recipes A/C hardcode `key: 'chest-gold'`, so the second chest no-ops regardless. §9's composite ids are byte-identical on game and screens — the fix already exists, untaught. *Fix:* spec the duplicate rule; rewrite recipes to derive key/name from `this.entity`.

**6. Green handlers on layout/spawn targets silently never install.** Layout clones are client-local; a handler registered in the clicked object's `start()` never reaches the game — every send retries into the void, indistinguishable from asleep. Trap 21 covers spawned entities only; the recipes teach the broken shape. *Fix:* extend the trap to layout-pool prefabs; state "green handlers live on **placed** entities" in `game.md` and recipe D.

**7. The cross-color closure trap has no owner.** Green and blue share one `start()` and look like they share variables; a variable mutated in blue reads always-zero in green, silently. Recipe C's capture is safe only because constructor params match on both sides — a distinction taught nowhere. *Fix:* one taught sentence wherever the pair appears ("different rooms — variables don't cross; params and `game.state` do"), plus a lint in the §4 pack.

## 4. Confusion list

Each item: the confusion → the concrete copy change.

- **"Resets when the game restarts" never names sleep.** A scoreboard survives an hour of testing, wipes overnight, nothing predicted it. → *"Resets when the game goes to sleep — a few minutes after the last player leaves — and when you publish."* `onStart` JSDoc first line: *"Runs once when the game wakes up (not per player, not per round)."*
- **"Everyone sees" claimed by two opposite mechanisms; G6 labels identical seeded rocks "Only you see".** → Recast the axis as ownership: *"Shared — one real copy"* vs *"Your screen's copy (same for all — scenery, can't be won or claimed)"* across table, Spawner enum, chips, hierarchy.
- **"✕ Can't reach the game" while the creator is visibly playing it.** → *"Can't reach the game server"* on the strip — the one place the two copies visibly diverge.
- **Announce JSDoc must carry the whole moment-vs-fact lesson** (and "anuncio" reads as *ad* in LatAm Spanish). → First line: *"A moment every screen shows once, then it's gone — late joiners never see it; if someone joining later must see it, it's game.state."* Plus two recipes: winner banner via state; secrets via ask-and-answer.
- **"Another green handler" — a color word with no color in an error string.** → *"Only the game changes game.state. Move this into game.onMessage — code there runs in the game, for everyone."*
- **The "bang" mantra is an untranslatable idiom in a load-bearing slot.** → *"The explosion effect is an announcement; the health bar is state."* Add the copy rule: error strings and JSDoc get one short sentence, no idioms.
- **One guarantee chip for two memories.** → *"Remembered for everyone"* / *"Remembered per player"*, matching the Saved-data tab's group names.
- **Secrets copy self-contradicts** ("published code never sees it" — `game.secret()` is published code). → *"Only the game can read it — it never reaches players' machines."*
- **`[you]` is missing from the vocabulary table** and bracketed prefixes read as log channels. → Add the row; one-time explainer on the first duplicate pair per session.
- **The §1 mental model never reaches the zero-code creator** (it ships only in the script template and `game.md`). → One line on the template picker card / first-run empty state; hoverable first green chip with the ask/decide sentence. Pick one metaphor — "a copy of your scene" over "brain".

## 5. Design decisions for the product owner

Ordered by how much each shapes everything downstream.

1. **Chase AI: defer, simulate per-screen, or build the waypoint verb?** (Options and costs in §2.) *Recommendation:* ship path-only v1 now with honest copy, and prototype the ~1 Hz waypoint verb in G1's harness — it's the only option that makes the Waves fantasy true, and the harness answers its feasibility cheaply.
2. **Blue-side reads: new API or blessed pattern?** `game.myData`/`game.onOutcome` (small additive surface riding existing internals) vs blessing the state-mirror workaround with recipes and size rules. *Recommendation:* the APIs — the mirror pattern re-teaches exactly what recipe C forbids, and the ledger already exists (CSS:117).
3. **Is there a player-vs-player verb at all?** A ~1 m-slack server-arbitrated `onPlayerNear` (feasible per CSS:23,152 for generous radii) unlocks slow-tag, hide-and-seek, murder-mystery — or tag leaves every claim surface. *Recommendation:* build it; without it a whole social-game genre exits, and the generous-checks doctrine already fits it.
4. **`send/onMessage` naming — decide before G2 while renaming is free.** §1 bans the word "message" while the green half is `onMessage`, the pair is asymmetric, and §2.2:96 vs trap 13 (`for:`/`ownedBy`) proves the naming pass is unfinished. *Recommendation:* `game.ask/onAsk` — it matches the taught mental model sentence and fixes the ban for free; fix trap 13 either way.
5. **Verify synced `AvatarAttach` in G1.** It's absent from the sync denylist (CSS:56); if it works, `spawn(prefab, { attachTo: player })` flips CTF from "cannot claim" to "serves" and upgrades tag/murder/horror at zero per-frame cost. *Recommendation:* verify first, decide after — one harness test gates a genre tier.
6. **The §6 coverage line: strike now or land enablers first?** Tag and quiz are currently claimed on surfaces that can't carry them (no PvP verb; Announcer is a toast). *Recommendation:* strike both today and add tower defense (a real, unclaimed win) — the coverage line is a promise to creators, and decisions 3 and a Question/Vote prefab can earn the claims back.

## 6. What the plan already gets right

Survived adversarial review intact: the moment-vs-fact doctrine and its ~10 s horizon (deliberate, coherent — the "defect" filings were misreadings); the restart-hygiene paragraph and boot re-adoption of keyed spawns (trap 13); §9's composite entity ids, stable and byte-identical on game and screens — the per-instance identity problem is a teaching gap, not a missing mechanism; per-name FIFO handlers, which make single-handler atomic trades correct by construction; the console-tag backstop for legacy both-sides scripts; and the internal architecture generally — the outcomes ledger, `planInstanceId`, and the fast/slow split mean most high-severity fixes are facade and copy work over machinery that already exists.