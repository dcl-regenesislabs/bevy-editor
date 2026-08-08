# Multiplayer DevExp review — can a creator build Tower of Madness?

Status: review only, 2026-08-08. Branch `feat/multiplayer-core` (`a4205b7..f61df5a`, 19 commits). Produced by a four-lens review (code + tower gaps, copy, discoverability, hints) plus synthesis. **Nothing here is implemented** — this is the ranked plan. Every claim is verified against the code with a `file:line`.

Revised same day after an owner correction: the first draft recommended renaming the kit group to "Game pieces" — an invented term. All copy is now re-grounded in the official Decentraland docs vocabulary (decentraland/documentation, verified page by page); see **§Vocabulary** for the rule and the full alignment table. Where this revision changes an earlier recommendation, the section says so inline.

Companion docs: `MULTIPLAYER-DX-PLAN.md` (the design), `MULTIPLAYER-COPY-PACK.md` (authoritative wording), `MULTIPLAYER-GAME-WALKTHROUGHS.md` (the tower session), `MULTIPLAYER-IMPL-REVIEW.md` (earlier runtime review).

---

## Verdict

**A creator cannot build Tower of Madness today.** Three things block it, in order of how much they hurt:

1. **There is no visible way to give an entity behavior.** A plain entity (the Tower anchor, a model, ClockSign) shows *no* script surface — the only path is the icon-only `+` "Add component", then finding "Script" in an alphabetical list of engine components. This is the owner's complaint, confirmed: the burial is real, but it is one level *above* the `+ Create script` button, not that button itself.
2. **When Play "does nothing", every surface built to explain why is silent.** The Game strip never appears, `[game]` log lines can't reach the editor, and the one "Logs" button lands on the wrong tab. A creator whose green handler throws sees nothing.
3. **Rounds end the wrong way, silently.** With the walkthrough's own numbers every round ends via Game Flow's timer instead of the script, so finishers are never paid, boards stay empty, and nobody teleports home — with no error.

Everything else is copy and polish. The good news: the runtime works (a real session played a full round), so this is a discoverability-and-feedback problem, not an architecture one.

---

## Settled this session (2026-08-08)

**Does a Multiplayer Server exist in local Play? Yes — the long-open question is closed.** The editor installs `@dcl/sdk@auth-server` **and** `@dcl/sdk-commands@auth-server` into the scene on first kit placement (`sdk-capability.ts:34`), and that build of `sdk-commands` spawns the server from its `start` command unconditionally — no flag suppresses it (verified against a real installed scene: `dist/commands/start/index.js:241` → `dist/commands/start/hammurabi-server.js`, whose own doc says every scene in the auth-server SDK is a multiplayer one). So `servers.ts:477` (the server runs inside the editor's process tree, which is why its `[game]` lines reach the Game tab) and `log-roles.ts:65` were right all along. The comment in `probe-tower.mjs` that said `sdk-commands start` boots no server was measured on a scene left on the **standard** SDK — the repo root's own `@dcl/sdk-commands` (7.22.6 commit build) has no `spawnAuthServer`, while every auth-server-channel build installed on this machine does.

Two consequences, both already in the code: the Game strip's `unreachable` rung is **honest and stays** — silence from a scene that *has* the SDK is a real fault — and the case that needed new copy is the scene *without* it, which now reads "○ This scene has no Multiplayer Server — place a Game Flow item to add one." (`game-life.ts:60-88,127`). `MULTIPLAYER-GAME-WALKTHROUGHS.md` and `validate/fixtures/tower-of-madness/README.md` both carried the false claim and no longer do.

**The vocabulary sweep is complete for every creator-visible string, with exactly one documented exception — stop calling it fully complete without naming it.** The trigger-zone prefab's composite entity **Name** stays the literal string `"Trigger Zone"` (`prefabs/trigger-zone/composite.json:9`). An area's id *is* its Name: scripts and reactions bind to that string, and the editor treats a name a script still references as taken precisely so a freed name is never silently re-bound (`instantiate.ts:89-96`, `assets.ts:94-100`, `script/references.ts`). Renaming the prefab's default would re-point or orphan the name-keyed reactions in every scene that already has one — a compatibility break for zero creator-visible gain, because everything a creator *reads* already says **Trigger Area**: the library card (`data.json` name), the properties-panel title (`InspectorPanel.tsx:201`), the reference note (`prefab-options.ts:38`), the Play chip (`PlayZones.tsx:12`). The folder name `trigger-zone/` and the slug `trigger_zone` are internal ids in the same position. What remains outside that exception is code comments only (`instantiate.ts:89`, `spawnable.ts:133`, `zone-authority.ts:1`).

---

## Blockers — before a creator can build the tower

| # | What a creator sees | Root cause (`file:line`) | Fix | Effort |
|---|---|---|---|---|
| **BL5** | Selects the Tower anchor → "No components on this entity". No way to add a script that a non-coder would find. | A scriptless entity renders no script surface; the only path is the `+` "Add component" picker (`InspectorPanel.tsx:105-113,142`). Right-click menu has no script entry (`EntityContextMenu.tsx:113-175`). | Render a **Script card on every authored entity**, always ("Script" is the official component name — docs: Script Component), with an empty state carrying the three tiers (Place a smart item / Ask the assistant / Write a script) + `New script` + `attach existing…`. Add **"Add Script"** to the right-click menu — or the docs' own phrase for this exact gesture, **"Make it smart"** (docs page: *make any item smart*); pick one, both are sanctioned. `InspectorPanel.tsx:137-141` synthesizes a `ScriptView` when the Script component is absent; `auto-expand.ts` opens it. *(Revised: the first draft said "Behavior card" / "Add behavior" — "behavior" as a noun is banned by the copy pack's own rule and is not a docs term.)* | M |
| **BL1** | Play starts, no Game strip ever shows — no signal whether the game is up. | The strip only exists once a `[studio] game-life` line appears, emitted through `previewLog` gated on `getRealm().realmInfo.isPreview === true` (`protectedSync.ts:206-222`, `game.ts:546-549`). The editor's Play never reports preview, so lines are dropped at source. | Stop deriving the strip's *existence* from a scene-printed line. Mount it whenever Play starts on a game scene (`usesGame()` over `consumerStore.scripts`), start at Waking, flip to unreachable after ~20s silence. `PlayGame.tsx:41`, `game-life.ts`. | S |
| **BL3** | The Game console tab is always empty even when the game logs. | `[game]` lines print on the auth-server *process* whose stdout goes to the Build tab; the Game tab reads only this screen's console (`LogsDrawer.tsx:27-30`, `game.ts:274,504`). The Logs button also opens the wrong tab by default (`LogsDrawer.tsx:15`). | Pipe the server process stdout through `log-roles.ts` into the Game tab tagged `[game]`; give `LogsDrawer` an `initialTab` and have the strip's Logs button pass `'scene'`. `servers.ts:261`, `Editor.tsx:213`. | M |
| **BL4** | Rounds never pay out — no points, empty boards, no teleport home, no error. | With `endsWhen: 'script'` the ceiling still ends the round via the timer path, so `round-results.close()` never runs. Walkthrough says 180s ceiling vs a 420s default clock (`game-flow.ts:103-116`, `round-results.ts:47`). | In `endsWhen === 'script'`, the ceiling routes through `game.newRound()` (or at minimum a `[game]` devWarn); fix the doc/default numbers. Hint H4 closes it at authoring time. | M |
| **BL6** | An honest finisher is told "already finished this round". | rpc resends the same request id after 4s with no seen-id set, so a dropped reply re-runs the handler (`rpc.ts:57-74,91-99`). | Bounded seen-id → reply cache in the server branch; replay the stored reply for a duplicate id. | S |
| **BL7** | "Best times survive a restart" may silently fail; retries unbounded. | Local `saved`/`playerData` writes may target production storage and fail silently (`game.ts:347-353`). | Probe the local runner's realm answer first; add a retry cap + one `[game]` card. | S (probe) |
| **BL8** | Asking the assistant for tower behavior produces wrong-shaped code. | The AI prompt has never heard of the `game` API (`ai-prompt.ts`). | Teach `game.onMessage`/`setState` and the screen-vs-game model in the prompt + a module `game.md`. | M |
| **BL9** | The walkthrough teaches gestures that don't exist ("Attach script", "second player", "Saved data tab"). | Honest-copy violation under a "transcribed from code" claim (`MULTIPLAYER-GAME-WALKTHROUGHS.md:301,670-676`). | Rewrite steps 3/9/10 to the real gestures; delete unshipped claims. | S |

---

## Discoverability — the creator's actual questions

**Is `+` acceptable for the script entry?** The button, yes — inside a card it's a visible primary. The *card's absence* is the problem. The Script card must be a standing, always-visible card on every entity; the component-picker dive is the real burial. (BL5.)

**Does the runs-on line teach, and on the right scripts?** It teaches well where it fires — but it's structurally blind to pure screen-side scripts. Verified now: present on 3 of the 4 tower scripts, **absent entirely on `clock-board.ts`** (which only reads `game.state` in `update()`), and the walkthrough promises lines the scanner can't produce. Fix: one added BLUE rule — a match on `game.state`/`game.now()` reads outside green callbacks, labeled "shows shared facts" — closes `clock-board` and `madness-race`'s blue half at once; give `layout()` a fallback label "layouts". Then align the walkthrough to what actually prints. (`runs-on.ts:31-49`.)

**What does a creator do when Play "does nothing"?** Today: nothing — no strip, no `[game]` line, wrong Logs tab. BL1/BL3 are the highest-priority Play-side work.

### Hints/tips — "understand what they're building"

All ride the **existing scene-check card** — zero new panels, no wiring surfaces, no violation of the no-Actions/Triggers rule. Signals the editor already has cheaply: which kit prefabs are placed, which `game.*` verbs the runs-on scanner already parses, zone names, whether a `layout` points at a non-Spawnable prefab, whether Play ran but the game never reported.

**Build now (all small, reuse existing machinery):**
- **H1 — game never reported.** Play ran, no `game-life` marker in ~20s → "The game hasn't started — check the Build log." (This *is* BL2's strip logic.)
- **H2 — zone name mismatch.** A script calls `game.onEnterZone('Start', …)` but no entity is named `Start` → "No area named 'Start' — name a Trigger Area that." (`runs-on.ts:33-34` + the shipped inverse in `zone-listeners.ts:48`.)
- **H3 — unanswered ask.** A script does `game.send('finish')` but no script handles `'finish'` → "Nothing in the game answers 'finish' — add game.onMessage('finish', …)." (One table entry in `runs-on.ts`.)
- **H4 — ceiling with no `newRound`.** Game Flow set to `endsWhen: script` but no script calls `game.newRound()` → "This round never ends — call game.newRound() when it should." (Params already parsed; pairs with BL4.)

**Build cheap:** H6 — Game Flow placed without a Leaderboard → one line on its Script card, "Add a Leaderboard to show the winners", not a check.

**Skip as over-building:** H5 — board-key-with-no-writer; the only hint needing a new `setState`-key parser. Revisit after the tower ships. Also refuse (as the reviews did): no insights panel, no completeness score.

### The kit's front door — corrected

**The "Game pieces" rename is struck.** "Multiplayer Server" is the feature's *official name* (docs: "The Multiplayer Server was previously called the Authoritative Server. Only the name changed") — the shipped group name was right all along, and the first draft's rename would have replaced a sanctioned term with an invented one. It also contradicted the copy pack's own vocabulary table, which declares "Multiplayer Server" the only sanctioned server noun (`MULTIPLAYER-COPY-PACK.md:17` vs the migration list at `:96` — the `:96` entry is the error and must be deleted). The only real defect on the tile is "N **models**" for items that aren't models — say "N **items**" (docs-sanctioned unit; `PrefabsPanel.tsx:466-475`).

---

## Vocabulary — talk the SDK's language

**The rule (owner directive, 2026-08-08):** where the official Decentraland docs have a word, the docs' word wins — no synonyms, no coinage. Plain English is allowed only where the docs have no term. Verified against decentraland/documentation (docs.decentraland.org, creator + SDK7 sections).

### Where our copy conflicts with an official term (must fix)

| Ours (invented) | Official term | Where ours ships (`file:line`) |
|---|---|---|
| "Trigger zone" / "trigger zone" | **Trigger Area** (docs page title; "trigger zone" never appears upstream) | **Done** in every rendered string: `InspectorPanel.tsx:201`, `prefab-options.ts:38`, `PlayZones.tsx:12`, the prefab's `data.json` name, copy-pack footer. **Exception (permanent):** the prefab's composite entity Name stays `"Trigger Zone"` — see §Settled this session; it is an identifier scripts bind to, not copy |
| `onEnterZone` / `onExitZone` | docs trigger events are **"Player Enters Area" / "Player Leaves Area"** | `game.ts` API — rename to `onEnterArea`/`onExitArea` while the branch is unshipped; cheap now, breaking later |
| "the game" as the authoritative actor in prose | **the server** ("the server acts as the single source of truth") | the seven guard errors (`gameCore.ts:188-194`: "Only the game can change…" → "Only the server can change…"), `gameCore.ts:441`, runs-on green label `runs-on.ts:134` → "on the server, for everyone" |
| "authoritative" / "server-authoritative" in prose | **the server** / **Multiplayer Server** (owner directive 2026-08-08; upstream retired "Authoritative Server" too) | `StorageTab.tsx:33`, `LogsTab.tsx:176` ("scenes running server-authoritative multiplayer" → "scenes with a Multiplayer Server"). The scene.json key `authoritativeMultiplayer` is SDK-owned — keep it, but only quoted as code, never as a prose word |
| "shared facts" | **synced state** / "the scene state" (docs: synced entities, `syncEntity`) | runs-on label `runs-on.ts:43` ('shared facts change'), error string `gameCore.ts:558`, JSDoc `game.ts:636` |
| "asks / tells" as nouns | **messages** (docs: `room.send` / `room.onMessage`, `registerMessages()`) | vendored JSDoc `gameCore.ts:385-400`, error `gameCore.ts:441` — describe both directions as messages to/from the server |
| "behavior" as a noun | **Script** (component) / **smart item**; the docs' gesture phrase is "make any item smart" | `InspectorPanel.tsx:191` zone-card title 'Behavior' → 'Script'; BL5's card + right-click entry (revised above); `chat-helpers.ts:56` is fine (verb-ish usage, "describe the behavior you want") |
| "pieces" as the kit unit | **items** / **smart items** | recommendation-only (this doc's first draft + copy pack `:73,82,117`, `MULTIPLAYER-TIERS.md:17`) — strike before it ships |
| "N models" on the group tile | **items** | `PrefabsPanel.tsx:466-475` |

### Coined terms that may stay (docs have no word for them)

`game` as the API object name (docs have no scene-code facade noun; "room" appears only incidentally and `room` is the raw SDK object the facade wraps) · **Game Flow / Round Loop** (product names for prefabs) · **round** (`game.round`, `game.newRound()`) · **layout** (`game.layout`) · **Waking / asleep** strip states (plain English) · **copies** (plain English; docs alternate "instance"/"copy") · `[game]`/`[you]`/`[player 2]` console tags · **the assistant**. Each is a coinage in a docs-silent zone, which the rule allows — but they are on notice: if upstream docs later name these concepts, the docs' word wins.

Also noted: the docs call the right-hand panel **"Properties" / "properties panel"** — the word "Inspector" never appears in the editor docs. Our internal code says `InspectorPanel`; keep the code name, but creator-facing docs and walkthroughs should say "properties panel".

### New gaps found in this pass

- **BL10 — no bridge to the documented SDK.** A creator who reads docs.decentraland.org learns `room.send`/`room.onMessage`, `syncEntity`, Smart Items with Actions/Triggers. Our editor teaches `game.send`/`game.onMessage`. Nothing anywhere maps one onto the other, so official docs actively confuse our creators and vice versa. Fix inside BL8's scope: the assistant prompt and the `game` module doc must state the mapping in one line each ("`game.send`/`game.onMessage` are the Multiplayer Server's `room.send`/`room.onMessage` with the envelope handled for you").
- **BL11 — the layout error names a gesture that doesn't exist.** `game.ts:583` tells the creator to "mark it Spawnable in the Prefabs tab", but there is no such toggle — `prefab-widgets.tsx:122` treats every prefab as spawnable and the chip was deliberately removed (`guarantees.ts:491-495`). An error whose remedy cannot be performed is worse than no error. Rewrite it around the real cause (the spawnables registry entry missing — regenerate, or the prefab name mismatch), and fix this doc's own copy-table row, which repeated the phantom gesture.

---

## Copy changes (highest frequency first)

| Where | Current → Replacement |
|---|---|
| `template.ts:84,89` | The two extra comment lines ("The game: runs once…", "Called every frame…") → **cut** (the first is wrong — it runs per message, not once — and collides with `onStart`; the pack sanctions one line only) |
| `script-view.tsx:219,222` | "+ Create script" → **"New script"**; "attach existing…" → **"Attach an existing script…"** |
| kit group tile (`PrefabsPanel.tsx:466-475`) | "N models" → **"N items"** (the `group` name "Multiplayer Server" *stays* — it's the official term; see §Vocabulary) |
| kit `data.json` descriptions | 3-sentence blocks → the pack's one-liners (overflow already lives in the hover) |
| `LogsDrawer.tsx:17,73` | "(no scene logs yet)" → **"Nothing from the game yet — press Play."**; "(waiting for sdk-commands server output…)" → **"Waiting for build output…"** |
| `game-flow.ts`, `health-respawn.ts` | `[gameFlow]`/`[healthRespawn]` tags → route through `devWarn` so they render as `[game]` with the piece name in the text |
| `gameCore.ts:446,449,458` | "Slow down the sender" → **"asked too often — send it less often"**; "payload is over 13000 bytes" → **"carries too much data"**; "flatten it" → **"use a simpler object"** |
| `game.ts:583,504` | fused layout error → a string naming the *real* remedy (see BL11 — "mark it Spawnable" is a phantom gesture); "boot failed" → **"The game couldn't start:"** |
| `gameCore.ts:188-194,441` | "Only the **game** can change…" → "Only the **server** can change…" (docs noun; see §Vocabulary) |
| `InspectorPanel.tsx:190`, `prefab-options.ts:38`, `PlayZones.tsx:12` | "Trigger zone" → **"Trigger Area"** (official docs term; the code constant already says so) — **shipped**, and the entity-Name identifier is the one permanent exception (§Settled this session) |
| `runs-on.ts:43,134` | 'shared facts change' → **"synced state changes"**; green label "in the game, for everyone" → **"on the server, for everyone"** |
| `guarantees.ts` (several) | client/game vocabulary → player/screen words per the pack's migration list |

---

## Cut list (less is more)

- **The "Server" chip on kit cards + `requiresSdk` gating + `SdkGateDialog`** — teaches install machinery before placement; changes nothing a creator does (`PrefabsPanel.tsx:576-584`, `SdkGateDialog.tsx:34`).
- **Zone Authority library entry** — pack cut #5, promised, not done (`trigger-zone-server/data.json:3-6`).
- **Template comments `:84` and `:89`** — the pack sanctions one line.
- **Kit description overflow** — trim to one sentence; the rest is already in the hover.
- **Game Flow's duplicate podium** on script-ended rounds — `announcePodium()` fires beside round-results' own podium, built from the wrong board (`game-flow.ts:86-92`); suppress it.
- **Do not cut:** the "attach existing" link, the ScriptMenu overflow, the seven guard errors, the strip states, the runs-on labels — all correct.

---

## Recommended order

**Before a creator can build the tower** (smallest first):

1. **BL1** — mount the Game strip from `usesGame()` + 20s timeout, not from a scene line. *(S)*
2. **BL3** — server stdout tagged into the Game tab; Logs button → Game tab. *(M)*
3. **BL6** — rpc seen-id cache. *(S)*
4. **BL9 / BL4-doc** — rewrite the walkthrough to real gestures + real numbers. *(S)*
5. **BL7** — storage-host probe (fix only if broken) + retry cap. *(S)*
6. **BL4** — ceiling routes to `newRound()` + devWarn. *(M)*
7. **BL5** — Script card on every entity + right-click "Add Script" + button copy. *(M)* — **the owner's headline fix.**
8. Vocabulary sweep: tile "models" → "items", "Trigger zone" → "Trigger Area" (**except** the prefab's composite entity Name, which is an identifier — §Settled this session), "Only the game" → "Only the server", 'shared facts' label, BL11 error rewrite. *(S)*
9. **BL8** — teach the assistant the `game` API, including the BL10 bridge line to `room.send`/`room.onMessage`. *(M)*

**Polish after:** hints H2/H3/H4 (one scene-check change); runs-on BLUE shared-facts rule; the copy batch; the cut batch; the guarantees vocabulary migration; the Saved data tab + H6 line; remaining runtime hardening (`send`-from-`start()` hold, pool-truncation warn, real `replanLayout` error).

---

## What already works (survived the review)

The runtime is sound — a real session played a full round end to end (`{"tag":"round"}` → `{"tag":"finish","speed":2}` → `{"tag":"board"}`). The generation path (writing `import { game }` vendors the runtime automatically), the seeded layout, the shared clock, `saved`/`playerData`, the round tuple, and the security fixes from the prior reviews all hold. The runs-on line's placement and chip language are right. This review is entirely about the last mile between "the code works" and "a creator can find and drive it."
