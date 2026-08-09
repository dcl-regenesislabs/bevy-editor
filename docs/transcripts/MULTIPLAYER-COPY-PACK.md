# Multiplayer DX — Final copy pack, UX changes, and implementation kickoff

> Superseded 2026-08-09.

Reconciliation rule used throughout: where the copy audit and the UX walk disagree, the shorter surface wins (owner directive: less is more). Every disagreement is flagged inline.

---

## Part 1 — The copy pack

### §1 Vocabulary table (revised, final)

**Rule zero (added 2026-08-08, owner directive):** where the official Decentraland docs (docs.decentraland.org) have a word, the docs' word wins — no synonyms, no coinage. Coined words are allowed only where the docs are silent. Official terms verified so far: **Multiplayer Server**, **Smart Items / smart item**, **items**, **Trigger Area** (never "trigger zone"), **Script** (component), **creator**, **player**, **properties panel**, "make any item smart" (the docs' phrase for adding a Script). See `MULTIPLAYER-DEVEXP-REVIEW.md` §Vocabulary for the full alignment table.

| Term | Use it for | Rule |
|---|---|---|
| **the game** | the one shared copy that runs for everyone | Sanctioned in teaching prose — but the *authoritative actor* in guard errors is **"the server"** (docs noun: "the server acts as the single source of truth"), and the 8 shipped "this player's game" strings still migrate (see migration list) |
| **ask the game** | a player requests, the game decides | Keep |
| **the game tells every player** | game → clients | Replaces "tell the screens". The actor is always **players / everyone**, never "screens" plural |
| **on this player's screen** / **only you see it** | client-local | Both fine; prefer "only you see it" in labels |
| **Multiplayer Server** | the machine, when the machine must be named | The only sanctioned server noun. Never "game server", "backend", "host" — and never "authoritative"/"server-authoritative" in prose (owner directive 2026-08-08): say **the server**. The scene.json key `authoritativeMultiplayer` may appear only as quoted code (`StorageTab.tsx:33`, `LogsTab.tsx:176` migrate). **It exists in local Play too** — see the note under the table before writing any string that implies otherwise |
| **Green ●** "in the game, for everyone" / **Blue ●** "on this player's screen" | where code runs | UI only, always dot + words together. In code files and JSDoc say "inside `game.onMessage`" — never a color word without a rendered dot |
| **copy / copies** | instances | Never "instance" in prose |
| **script** | creator code | Never "behavior" as a noun in copy |
| **pick / picked** | target selection | Shipped verb; delete guards and tombstones use it |
| **the assistant** | AI | Never "the AI" |

**Established 2026-08-08 — local Play has a Multiplayer Server.** The editor installs `@dcl/sdk@auth-server` **and** `@dcl/sdk-commands@auth-server` into the scene on first kit placement (`sdk-capability.ts:34`), and that toolchain's `start` spawns the server on every local run, with no flag to suppress it. No string may say or imply that the server is a published-only thing, that Play is client-only, or that a game half must be tested in a world. Two strings depend on the distinction and are correct as shipped: "✕ Can't reach the Multiplayer Server —" is a real fault (a scene that *has* the SDK went silent), and the scene that never had one reads "○ This scene has no Multiplayer Server — place a Game Flow item to add one." (`game-life.ts:127`) — rule plus the exact next gesture, which the `unreachable` wording could not give.

**Vocabulary exception, permanent — the one identifier "Trigger Area" does not reach.** The trigger-zone prefab's composite entity **Name** stays the literal `"Trigger Zone"` (`prefabs/trigger-zone/composite.json:9`): an area's id *is* its Name, and renaming the default would re-point or orphan the name-keyed reactions in every scene that already has one. It is an identifier, not copy — every string a creator reads already says Trigger Area. The sweep is therefore complete for all copy **except that one identifier**, and must not be described as complete without it.

**Mantra (kept verbatim):** "the explosion effect is a message that fades; the health bar is state that stays."

**Tier names:** **Place it / Ask the assistant / Script it** (audit's fix to "Ask for it" — the shipped actor is the assistant).

**Sanctioned prompt format rule:** one imperative sentence, ≤12 words, creator's nouns. E.g. "Give players 5 points when they open the chest."

### Code and SDK strings

| Surface | Final string |
|---|---|
| `setState` guard error (the house pattern: rule + exact next gesture, one sentence each) | "Only the game can change game.state. Move this inside game.onMessage." |
| `saved` / `playerData` / `secret` guards | Same shape: "Only the game can change saved data. Move this inside game.onMessage." |
| `onStart` JSDoc | "Runs once when the game wakes up (not per player, not per round)." |
| Green `send` JSDoc | "A moment: shown once, then gone. Players who join later never see it — lasting facts go in game.state." |
| Script template comment (**one line only** — UX walk wins over audit's two-line version) | "Decisions that count for everyone go inside game.onMessage — that code runs in the game." |
| Cross-color lint message (PR 9 — receives the cut template lines verbatim) | "Variables don't cross between here and the game. Share through game.state, the payload, or params." |
| Missing secret key, `[game]` console line | "No key named WEATHER_API_KEY yet — add it in the Secrets tab." |
| Console tags | `[game]` / `[you]` / `[player 2]` |

### Editor surfaces

| Surface | Final string |
|---|---|
| Template picker card (**one sentence only** — UX walk cuts the model sentence; audit's C2 fix applied to the survivor) | "This scene gets its own Multiplayer Server — free, sleeps when empty." |
| Game strip (Lagging **cut** per UX walk; Asleep merged: audit's noun + UX walk's verb) | "● Game running" / "◐ Waking… 12s" / "○ Game asleep — wakes when a player arrives." / "✕ Can't reach the Multiplayer Server — Logs" / (added 2026-08-08, for the scene that has no server at all) "○ This scene has no Multiplayer Server — place a Game Flow item to add one." |
| Runs-on line | "● in the game, for everyone: openChest · enter Vault ● on this player's screen: goal popup" |
| Runs-on hover, green | "This part runs in the game — it keeps going even with no players near." |
| Runs-on hover, blue | "This part runs on each player's screen — only they see it." |
| Hierarchy shelves | "Shared — one copy for everyone" / "Your own copy" / "Player 2's own copy" |
| Play menu | "Play with a second player — Player 2 joins in a split view" · "Player 2 joins late — they get a 'Join now' button mid-round" · toggle: "Start like a real visit — the game wakes in ~15 s, like it does for your first visitor" |
| Publish checklist | "Your first visitor wakes the game (~15 s). Test with 'Start like a real visit' first." |
| Publish success (new line, UX walk J1) | "Send the link to a friend — you'll both be in the same game." |
| Drawer tabs | "Build \| Game \| Saved data \| Secrets" (worlds StorageTab relabels "env keys" → "Secret keys") |
| Saved data header | "Test data — only on this computer. Your published world keeps its own, in its Storage tab." |
| Clear-all action | "Delete all saved data" + shipped confirm "Delete for real?" |
| Lifetime: `game.state` | "until the game sleeps (a few minutes after the last player leaves) or you re-publish" |
| Lifetime: `game.secret` | "only the game can read it — it never reaches players" |
| Secrets publish step (audit's C2 fix + UX walk's "where" merged) | "Stored on the Multiplayer Server only. You can replace it later from this window, but never read it back." + provenance line "used by weather-board.ts to fetch forecasts" + "Skip for now" with "The script fails until you add it — add it later from this same window." |
| Spawner enum | Header "Who sees the copies?" · A: "Only the player who set it off" — "Each player gets their own copies. Nothing is shared, nothing is saved." · B: "One copy, everyone sees the same one. Good for one thing at a time, not many." |
| Spawn-points empty state | "No spawn points yet — drag entities under this spawner, or right-click → Add spawn point." |
| Script row menu | "Update this script to game" (never "Modernize") |

### Kit / prefab cards

| Card | Final string |
|---|---|
| Game Flow | "Lobby, countdown, rounds, winners — runs your game from start to end." |
| Waves | "Waves of enemies on fixed paths — everyone fights the same wave." |
| Level Slots | "Swaps an area's layout each round — the same pick for everyone." |
| Door & Switch | "A door that is open or closed for everyone at once." |
| Pickup | "One item — the first player to take it keeps it." |
| Collectible | "Each player can pick this up once — gives points." |
| Health & Respawn | "Players can take damage and respawn." |
| Points / Teams / Save Point / Announcer | Keep as designed (already in voice) |
| Finish Line (new Works-with line, UX walk J2) | "Writes times to a board key — a Leaderboard with the same key shows them." |
| Layout guarantee chip | Chip: "Same for everyone" · tip: "Each player's screen builds its own copy — the layout is identical for all." |
| Other guarantee chips | "Everyone sees it" / "Remembered for everyone" / "Remembered per player" |
| "Works with" format | Names only, no verbs: "Works with: Points, Leaderboard." |
| Trigger Area footer (UX walk's reorder: item before prompt; "Trigger Zone"/"piece" corrected per rule zero) | "An area alone does nothing — an item pointed at its name reacts (Finish Line records times, Health & Respawn makes it hurt). For something custom, ask the assistant: 'When a player enters Finish, …'" |

### Scene checks and guards

| Surface | Final string |
|---|---|
| Trap-21 check | "This script needs the game, but this copy only exists after it spawns. Right-click it and pick 'Show from the start'." |
| Pick empty state | "This zone won't open anything until you pick a door." |
| Delete guard | "2 scripts point at this door (Trigger Zone, Wall Button). Delete anyway? They'll do nothing until you pick a new target." |
| Tombstone chip | "Door — ⚠ was 'Lobby Door' — gone · [Pick]" |
| Duplicate confirm | "Still points at the original Lobby Door." |

### Migration list (goes into G3 / PR 12 scope + K-track sweeps)

Shipped strings that now break the vocabulary: `guarantees.ts` "On this player's game" → "On this player's screen"; "Each player's game builds these copies itself" → "Each player's screen builds these copies itself"; "a player's own game writes" → "what a player's own screen writes"; spawner `data.json` "right on this player's game" → "only on this player's screen"; "while the game runs" → "while playing"; `guarantees.ts` "synced to every client / client-rendered" → player words; worlds StorageTab "env keys" → "Secret keys"; group tile "N models" → "N items". ~~library group "Multiplayer Server" → "Game pieces"~~ **struck 2026-08-08** — "Game pieces" was invented; "Multiplayer Server" is the official docs name and the group keeps it (this entry also contradicted the vocabulary table above, which sanctions that exact noun). The five prefab descriptions naming "the Multiplayer Server" as the machine **stay** — that noun is sanctioned. New sweeps per rule zero: "Trigger zone" → "Trigger Area" (`InspectorPanel.tsx:190`, `prefab-options.ts:38`, `PlayZones.tsx:12`) — **done, with the entity-Name identifier as the one permanent exception (see §1)**; guard errors "Only the game can change" → "Only the server can change" (`gameCore.ts:188-194`); runs-on 'shared facts change' → "synced state changes".

---

## Part 2 — UX changes

### Cut list

1. Picker card sentence 2 ("shared copy… it decides") — teaches the model before anything is placed; the strip and runs-on line teach it at the right moment.
2. Script template's two "different rooms" lines — teaches trap 25 pre-mistake; moved verbatim into the PR 9 cross-color lint.
3. `◔ Game lagging` strip state — no creator verb exists in v1; anxiety with no next step. (Audit kept it; UX walk's cut wins.)
4. Prompt footers on kit cards whose resting state is not the wall (Collectible, Points, Door) — the sanctioned prompt moves to their teaching empty states.
5. `trigger-zone-server` as a creator-visible library entry — expert machinery once `game.onEnterZone` absorbs it.
6. `requiresSdk` gating + `SdkGateDialog.tsx` branches — reaffirmed from §3's cut list; swept in K-track PRs.
7. "Tell the screens", "game server", "behaviors", "swarms", "heartbeat", "Modernize", "green handlers" in code text — vocabulary cuts, replacements in Part 1.

### Hint ladder (each surface's single next-step line)

| Surface | Next-step line |
|---|---|
| Coin Rush / Race Day hole | The hole is an unconfigured seam; its existing teaching empty state IS the label (e.g. Leaderboard: "Nothing to show yet — place Points, or set the board key."). No new mechanism. |
| Trigger Zone footer | Kit piece first, prompt second (final string in Part 1). |
| Finish Line card | "Writes times to a board key — a Leaderboard with the same key shows them." |
| Game strip `○ Game asleep` | "— wakes when a player arrives." |
| `[game]` crash card | "Fix with assistant" prefill — same wire scene-check blockers already use. |
| Missing secret key in Play | "No key named X yet — add it in the Secrets tab." |
| Secrets publish step | "Skip for now" + "The script fails until you add it — add it later from this same window." |
| Publish success | "Send the link to a friend — you'll both be in the same game." |
| Script template | One comment line binding "everyone" to `game.onMessage`. |

**Standing pattern (enforce in review):** every guard, empty state, and strip state = rule + exact next gesture, one sentence each — the `setState` error is the reference. Anything that cannot name a next gesture is a cut candidate. Works-with lines live in the library (pre-placement); sanctioned prompts live in teaching empty states (post-placement); never both on one card.

---

## Part 3 — Implementation kickoff (Monday)

**PR 1 — Harness (branch `feat/mp-harness`), first sitting.**
Day 1: `packages/desktop/validate/harness/run.mjs` (runner ~200 lines: N-client isolates over the bevy-headless boot path `probe-auth-server.mjs` already exercises, scripted ticks, `restartServer()`) + `packages/desktop/validate/fixtures/harness-scene/` + the simplest scenario, `scenarios/singleton.mjs`, green end-to-end.
Day 2: budget tracker (~80 lines: 40 Storage calls, 13 KB msg, 300/s/peer) + `scenarios/{spam,duplicate,restart}.mjs` + the self-verify: a fixture with a deliberate check-then-act double-spawn fails `duplicate.mjs`; keyed fix turns it green. Each scenario declares which stack it trusts (bevy vs hammurabi).

**Parallel quick win — PR 11's `childrenOf` half** (independent of the facade, UI-side): `pure/childrenOf.ts` (~10-line id-sorted helper) + right-click "Add spawn point" verb in `entity-menu.ts` + the spawn-points empty state string from Part 1. The ref-hygiene half (references.ts reverse walk, tombstone, delete guard) stays sequenced with PR 11 proper.

**First 5 PRs, order and parallelism:**
1 → 2 → 3 → 4 → 5, strictly serial on `gameCore.ts` from PR 2 on. PR 2 can be *written* in parallel with PR 1 (it's opt-in-by-import, no editor surface) but merges after — harness `singleton.mjs` is its verify. A second pair of hands takes the UI track meanwhile: childrenOf half, then the Part 1 vocabulary migration sweep (guarantees.ts, spawner data.json, StorageTab) as its own small PR — zero facade dependency.

**First demo checkpoint (earliest visible thing):** after PR 3 — two clients in the harness, a 5-line script with `game.send('openChest')` / `game.onMessage`, both consoles print the same message with matching `game.now()` timestamps. That is "one shared game, two screens" made visible. The teaching-error demo (`setState` in blue code throws the Part 1 string verbatim) lands one PR later and is the first *copy* demo.

**Standing rules (every PR):**
- `npm run validate` is the merge gate; probes (`probe-game.mjs`, born in PR 3) are the user's manual step — never auto-run.
- Any PR touching `packages/desktop/runtime-modules/game.ts` (PRs 2–7, 14) runs `node scripts/sync-runtime-modules.mjs` and commits the byte-identical per-prefab copies — `sync-runtime-modules.test.mjs` fails the build otherwise.
- ~600-line cap per PR; PRs 3, 7, 9, 12 use their pre-declared split lines.
- Every PR with creator-facing strings carries a review checkbox: sweep against the Part 1 vocabulary table.