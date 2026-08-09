> Status: decision document, 2026-08-08. Produced by a 13-agent review (4 fact lenses, competing designs, a 3-lens judge panel, synthesis) after two owner corrections that reframed the problem: `isServer()` is reliable wherever creators write code, and `update()` runs on the Multiplayer Server too. Vocabulary normalised to **client** (never "screen") per the owner's rule that the industry/SDK word wins. Nothing here is implemented.

# Sides in Decentraland Studio — Owner's Decision

## 1. The finding that reframes everything

`isServer()` is not unreliable and never was: it is seeded `false` at module load and swapped by an engine query that settles before the first tick, so inside a constructor, `start()`, `update()` or any callback it is truthful on the Multiplayer Server and on every player's client alike (`@dcl/sdk/network/index.js:8-15`; the comment at `runtime-modules/game.ts:52` is true only of module bodies, and our own `outcomes.ts:111` already says so). At the same time `update()` — and `start()`, and the constructor — run on the Multiplayer Server too, at up to ~41 Hz (`@dcl/sdk-commands/dist/logic/runtime-script.js:115-199` has no side branch anywhere; `hammurabi-server/dist/lib/common-runtime/game-loop.js:4`), which means every script we ship already has a server half that nobody declared and nobody can see — our own reference fixture asserts the opposite in a header comment (`validate/fixtures/tower-of-madness/scripts/madness-race.ts:4`) and survives only because the server's phantom avatar happens to sit below the summit threshold.

Put together: the current model is not protecting creators from an unreliable check, it is hiding a reliable one behind a lookup table of verb names (`packages/ui/src/script/runs-on.ts:35-55`) and a dynamic counter that the code itself admits is not airtight (`pure/gameCore.ts:309-318`). And the third fact, which neither the facade nor either candidate design got right: **there is a middle**. `game.onEnterArea` must be registered on *both* sides — the client that owns the avatar is the only thing that can notice a crossing (`game.ts:559`, `fork()`'s client branch: `for (const zone of d.core.zoneNames()) watchZone(d, zone)`; `gameCore.ts:846` — *"Every zone key a script registered for — what the client side must watch"*), while only the server runs the callback. A side model with exactly two homes cannot express that, and any design that files Trigger Areas under "server" silently kills every Trigger Area in the kit.

---

## 2. Recommendation — **Say the side**: one shape, said twice, plus a named middle

Ship design A (the official `isServer()` branch), with five grafts and one deletion from A as proposed. Concretely:

| # | Graft | Why |
|---|---|---|
| G1 | **One shape, said twice.** The scaffold never writes `if (isServer()) return`. It always writes `if (isServer()) { …server… return }` in *both* `start()` and `update()`. | A's own scaffold taught two opposite meanings of the same three tokens eight lines apart — the judges' single likeliest first-day error. |
| G2 | **The middle is named.** Code outside any branch runs on both sides. `game.onEnterArea` / `game.onExitArea` belong there, and a new check flags them *inside* a branch. | Without it, Trigger Areas are dead on arrival (§1). |
| G3 | **The guard tells the truth during `start()`.** Add `CorePorts.isServerNow()` reading the SDK's `isServer()`; delete `greenSpans` entirely. | `setRole` runs from `fork()` at priority 100000 (`game.ts:521-524`), while `start()` runs from the `Infinity` startup system on the same tick (`bundle.js:84`, `@dcl/ecs/engine/index.js:20`). Today `GameCore.isServer()` is **false for every `start()` on the real server** — so A's headline story ("put it inside the branch and it clears") would not have worked. `gameCore.ts` is SDK-free by design, so this must be a port, not an import. |
| G4 | **Nothing new throws in `start()`.** The ten registration guards report a scene-error card through the existing `[game]` / `[you]` channel and return. The eight data guards keep today's throw with corrected text. | `runtime-script.js:172` re-throws a `start()` failure and `bundle.js:68-77` catches it around the *whole* of `_initializeScripts()` **plus** `main()` — one throw silently aborts every remaining script and skips `main()`. Converting ten silent no-ops into that is unacceptable. |
| G5 | **B's cross-side field check**, on the AST `parser.ts:280` already builds. | It is what finally retires the prose comments at `madness-race.ts:39,41` — the exact defect that opened this review. Strictly better than A's `this.server.*` / `this.client.*` naming convention, which A itself admits is unenforceable. |
| G6 | **B's cut: no runs-on line for client-only scripts.** | 36 of 48 kit scripts would otherwise carry a blue chip repeating what the creator already assumes. |

And the deletion: **we do not re-export a throwing `isServer()` from `./runtime/game`.** Creators import `isServer` from `@dcl/sdk/network`, the official path, exactly as `docs.decentraland.org` teaches and exactly as 8 kit scripts already do at 23 call sites (verified). A lookalike with a second contract would be defeated the moment anyone copies the official import — which is the whole point of choosing the official API. The module-scope trap is caught by a static check instead.

### The first scaffold a creator sees

```ts
import { Entity } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { game } from './runtime/game'

export class Greeter {
  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start() {
    if (isServer()) {
      // The server. One copy, shared by everyone — decisions that count go here.
      game.onMessage('greeter', (data, player) => {
      })
      return
    }
    // The client — this player's own copy. What they see, click and hear.
  }

  update(dt: number) {
    if (isServer()) {
      // The server, every frame. Usually nothing goes here.
      return
    }
    // The client, every frame.
  }
}
```

Four things are deliberate. The shape `if (isServer()) { … return }` is identical in both methods, so the three tokens mean one thing and never invert. `update()`'s server half ships pre-written and pre-commented because "update() runs on the server too" is the single most surprising fact in the model and our own fixture got it wrong. The message name is still derived from the filename, because one name still has one handler across the scene (`gameCore.ts:397`). And anything a creator adds *above* the `if` runs on both sides — which is where Trigger Areas go, and where the Trigger Area reaction template scaffolds them.

### `madness-race.ts`, rewritten

```ts
// Attempts, finish validation, and the madness: every finisher makes the round
// clock drain faster for everyone still climbing.
//
// One file, two sides, and a middle. isServer() is the same call the
// Decentraland docs teach; by the time start() or update() runs, the platform
// has answered it — on the server and on every client alike.
import { Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { game, type Player } from './runtime/game'
import { asClock, remainingNow } from './pure/clock'
import { asRuns } from './pure/boards'
import { BASE_Y, topFor } from './pure/tower'
import { showVerdict, type Verdict } from './race-ui'

const FINISH = 'finish'
const ANNOUNCE = 'announce'
const START_ZONE = 'Start'
const CLOCK_KEY = 'clock'
const FINISHERS_KEY = 'finishers'
const FLOW_KEY = 'flow'
// Positions reach the server as feet at about 10 Hz, so the summit check is
// generous by half a chunk — an honest climber standing on the cap must pass.
const SUMMIT_SLACK_M = 3
// This client asks once it is essentially there, and re-arms back at the base.
const ASK_WITHIN_M = 1
const REARM_ABOVE_BASE_M = 4

// Round 1 is the round every game boots into, and Game Flow keeps it as the
// lobby. Nothing closes a round there, so a finish taken then would be recorded
// and never paid — refuse it instead of banking a run that goes nowhere.
// Reads synced state, so it is the same answer on both sides.
function inRound(): boolean {
  const fact = game.state[FLOW_KEY]
  if (typeof fact !== 'object' || fact === null) return false
  return (fact as Record<string, unknown>).phase === 'round'
}

export class MadnessRace {
  /** The server's: when each player last walked through the start gate. */
  private attempt: Record<Player, { atMs: number; round: number }> = {}
  /** The client, per player: whether its ask is already out. */
  private asked = false

  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start(): void {
    // Both sides register the Trigger Area. The client that owns the avatar is
    // the only thing that can notice a crossing; the server re-checks it and
    // runs this callback. Registering it on one side only means it never fires.
    game.onEnterArea(START_ZONE, (player) => {
      this.attempt[player] = { atMs: game.now(), round: game.round.number }
    })

    if (isServer()) {
      // The server. One copy, shared by everyone.
      game.onMessage(FINISH, (_data: unknown, player: Player) => this.finish(player))
      return
    }
    // The client: nothing to arm — the climb is watched in update().
  }

  update(): void {
    if (isServer()) {
      // The server has no avatar of its own to watch, and a send() from here
      // would broadcast to every client instead of asking.
      return
    }
    const round = game.round
    if (round.number <= 0) return
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (me === null) return
    if (me.position.y < BASE_Y + REARM_ABOVE_BASE_M) this.asked = false
    if (this.asked || me.position.y < topFor(round.seed) - ASK_WITHIN_M) return
    this.asked = true
    // the reply IS the verdict — no broadcast to filter, no timeout to hand-roll
    void game.send<Verdict>(FINISH, {}).then(showVerdict, (error: unknown) =>
      showVerdict({ ok: false, why: error instanceof Error ? error.message : String(error) })
    )
  }

  /** The payload is empty on purpose: everything that decides this — who asked,
   * where they are, when they started — is the server's own. */
  private finish(player: Player): Verdict {
    const round = game.round
    if (!inRound()) return { ok: false, why: 'the round has not started yet — wait for the clock' }
    // "already finished" first: a run clears its own attempt, so asking the
    // other way round tells a finisher to start again instead of the truth
    const done = asRuns(game.state[FINISHERS_KEY])
    if (done.some((run) => run.p === player)) return { ok: false, why: 'already finished this round' }
    const attempt = this.attempt[player]
    if (attempt === undefined || attempt.round !== round.number) {
      return { ok: false, why: 'start again from the gate' }
    }
    const feet = game.positionOf(player)
    if (feet === null || feet.y < topFor(round.seed) - SUMMIT_SLACK_M) {
      return { ok: false, why: 'not at the summit' }
    }
    delete this.attempt[player]
    const now = game.now()
    const time = (now - attempt.atMs) / 1000
    const finishers = [...done, { p: player, time }]
    const speed = finishers.length + 1
    const clock = asClock(game.state[CLOCK_KEY])
    game.setState({
      [FINISHERS_KEY]: finishers,
      ...(clock === null ? {} : { [CLOCK_KEY]: { at: now, left: remainingNow(clock, now), speed } })
    })
    void game.send(ANNOUNCE, { text: `A climber made it — the clock now drains x${speed}` })
    console.log(`[game] finish accepted — ${time.toFixed(2)}s, the clock now drains x${speed}`)
    return { ok: true, time }
  }
}
```

Both prose annotations are gone (`/** In the game only: */`, `/** On this client only: */`), the false header comment is gone, and `update()`'s server bail is now a statement instead of an accident that depended on where hammurabi parks its phantom avatar. The fields keep their plain names; their side is enforced by the cross-side field check (G5), not by a naming ceremony.

---

## 3. Why the runners-up lose

**Design B (`serverStart()` / `serverUpdate()` lifecycle methods).** B reads better in a text editor and it is the only design that could have contained the `start()` throw, and I take both of those lessons. It loses on three verified facts. First, it cannot express the middle: with `start()` = client and `serverStart()` = server there is nowhere to put `game.onEnterArea`, and B's own rewritten fixture files it under `serverStart()` — where `zoneNames()` on the client is empty, no claim is ever sent, `this.attempt` is never populated, and every finish is rejected with "start again from the gate", silently. A model that cannot say "both" is not simpler than a boolean; it is wrong. Second, its headline cost claim is false against the tree: **4 of 36** script-bearing prefabs vendor `scripts/runtime/game.ts` (announcer, game-flow, health-respawn, leaderboard — verified). `extends Script` means vendoring a 17–28 file runtime tree into 32 folders whose scripts import nothing but `@dcl/sdk` today, and the 8 prefabs that already branch on `isServer()` at 23 sites go from *zero edits* to *hand-migrated plus newly vendored*. Third, `serverStart` / `serverUpdate` / `extends Script` appear in no SDK export, no docs page, and not in `@dcl/inspector`'s own class template — which `template.ts:61` names as the shape we follow. Under our own rule that official Decentraland vocabulary wins, B invents a second dialect while claiming to remove one.

**Design A exactly as proposed.** It loses to A′ on four specifics the judges nailed. Its scaffold teaches `if (isServer())` as "server code goes here" in `start()` and as "server code stops here" in `update()`, eight lines apart, and the mistake it invites throws nothing. Its central creator story — put `game.setState` inside the branch and it clears — **does not work**, because `greenGuard`'s `isServer()` is `this.server`, set by `fork()` one system after `start()`. Its ten new registration throws land in `start()`, where the runner re-throws and `bundle.js:72` aborts the rest of scene construction, so a wrong-side `game.layout` goes from a silent no-op to a partly-missing scene. And its shadowed throwing `isServer()` export gives one name two contracts while the docs push creators at the other one. All four are fixed by G1–G4; none of them touch A's actual thesis.

**Doing nothing.** The current model is not merely unintuitive, it is wrong in the messages it prints: on the Multiplayer Server, inside `update()`, `greenGuard` tells a creator *"Only the server can change game.state"* while they are on the server (`gameCore.ts:492-494`), and all eight guards end with *"Move this inside game.onMessage"* — wrong advice for `onStart`, `onRoundStart`, `every` and `onEnterArea`, which are equally valid places to write. Meanwhile the kit ships two incompatible side stories and `ai-prompt.ts:81` tells the assistant *"there is no isServer()"* while 8 kit scripts and 5 kit `ai.md` guides teach it. That contradiction is shipping today.

---

## 4. What happens to every existing surface

**The runs-on chip survives, re-sourced, and shrinks.** Same component, same `Chip` tones (`server` green / `client` blue — the one colour language `Chip.tsx:8-17` already defines), same `·`-joined labels. The colour now comes from the `isServer()` regions the creator wrote, not from a verb table: `runs-on.ts` keeps `gameBindings`, `stringConstants`, `firstLiteral`, `functionBodies`, `matchingBracket` and the transitive region walk, and re-anchors the walk from verb call spans to `isServer()` consequents — including the inverted forms the kit actually uses (`if (!isServer()) return` at `zone-authority.ts:57`, `server-clock.ts:34,44`, `level-slots.ts:212`) and the dispatcher form (`if (isServer()) this.startServer()` at `level-slots.ts:148`). `gameBindings` widens to recognise `isServer` imported from `@dcl/sdk/network`, which is why the 8 kit scripts light up with **zero edits**. Deleted: `GREEN` (8 verbs), `BLUE` (2), `BLUE_FREE` (1) at `runs-on.ts:35-55`, and the comment block at `:6-11` conceding that `onMessage`'s client direction is folded into green. Per G6, `RunsOnLine` renders nothing for a script with no server region — 36 of 48 kit scripts. Note for the implementer: `gameUse()` shares `scan.green` at `runs-on.ts:299` to decide whether a `send` is a broadcast, so it is *not* unaffected by the re-anchor.

**The guard errors.** `greenSpans` is deleted — the field, the wrappers, the two increment pairs, and the caveat at `:309-318` admitting it is non-deterministic when a server `update()` ticks inside an awaited span. The condition becomes `!isServerNow()`. Nothing breaks: `flushState()` already runs every server tick, so a `setState` from a plain server `update()` publishes one tick later (~24 ms) instead of being refused. The messages become, verbatim:

| Verb | Side | Today | After |
|---|---|---|---|
| `setState`, `newRound`, `saved.get/set`, `playerData.get/set`, `positionOf` | server | throws, *"Move this inside game.onMessage."* | throws, *"game.setState only runs on the server. Put this line inside if (isServer())."* |
| `onStart`, `onRoundStart`, `onPlayerJoin`, `onPlayerLeave`, `every` | server | **silent no-op** | scene-error card, *"game.every only runs on the server. Put this line inside if (isServer())."* — no throw |
| `onStateChange`, `layout`, `onClick` | the client | **silent no-op** | card, *"game.layout only runs on the client. Move this line out of the if (isServer()) branch."* |
| `onEnterArea`, `onExitArea` | **both** | silently server-only | card if inside a branch: *"A Trigger Area is noticed on the player's client and checked by the server. Move this line out of the if (isServer()) branch."* |
| `onMessage`, `send`, `state`, `now`, `round`, `trace`, `childrenOf` | either | — | unchanged |

`serverState.ts:83` gets the same sentence shape. `GameNameError`, `GameDirectionError`, one-handler-per-name, the 8/s token bucket, the 4096-byte and depth-8 caps, the reserved `state.round` key and the `playerData` cap are untouched — none of them depend on how the side is spelled.

**The template.** Rewritten to the scaffold above. Deleted: the single prose comment about `game.onMessage`, and the dangling reference at `template.ts:66` to a "cross-color check" that does not exist anywhere in the repo — because with G5 it finally does. The Trigger Area reaction template scaffolds `game.onEnterArea` *above* the branch with the one-line explanation, which is the case the old template got wrong.

**The AI prompt.** `ai-prompt.ts:81`'s sentence *"there is no isServer()"* is deleted — it is false, it constrains only the assistant, and it contradicts 8 of our own kit scripts and 5 of our own `ai.md` guides. It is replaced by: *"Every script runs on both sides. Branch with isServer() from '@dcl/sdk/network' inside start() or update(), never at the top of a file. Code outside the branch runs on both sides — that is where a Trigger Area is registered."* The `room.send` / `room.onMessage` bridge line stays; it is the only place we speak the official vocabulary at all.

**The kit scripts.** Zero renames — all 98 `game.*` call sites keep their spelling. 8 scripts (level-slots, server-clock, gun-hitscan, player-rig, round-loop, spawner, zone-authority, wave-director; 23 `isServer()` sites) need **no edits** and gain a chip they have never had. Both non-tower validate fixtures already write this exact shape (`zombie-arena/arena-probe.ts:164,172`) — we are formalising the incumbent idiom of this repo, not importing one. Real edits: the 4 facade prefabs (game-flow 21 sites, health-respawn 18, leaderboard 4, health 3) and the 5 tower scripts (round-results 26, madness-race 15, tower-probe 5, clock-board 3, tower-builder 3), each ~3 inserted lines plus re-indentation. 36 of 48 kit scripts are untouched. The kit stops shipping two side models.

**The walkthrough and copy.** `docs/MULTIPLAYER-GAME-WALKTHROUGHS.md` carries **seven** worked runs-on lines (`:92, :136, :168, :200, :391, :446, :534`), not one — budget accordingly. `docs/MULTIPLAYER-COPY-PACK.md:20,55` has already drifted (*"in the game, for everyone"*) from the shipped constant (`runs-on.ts:308`, *"on the server, for everyone"*); converge on the shipped string — official vocabulary wins. The other six `MULTIPLAYER-*.md` files need a live-vs-archived triage that is owed regardless and is not part of this work.

---

## 5. Entity protection — **ship the property, cut the pill**

Ship it, because it is not a label: an authored entity with no sync is purely local, and `syncEntity` + `validateBeforeChange` is what turns a static prop into a server-driven object. A door the server opens is not expressible today without hand-writing a script with an invented sync id inside an `isServer()` gate — and sync-id collisions are a documented production-only bug class (`agent/skills/authoritative-server/SKILL.md:43`, ~50% collision by ~370 addresses). The editor is the only actor with a whole-project view, so it is the only correct allocator. That is a capability, and it earns its surface.

**The declaration.** `inspector::ServerOwned { components: string[] }`, editor-only, never travelling with a prefab (the `inspector::Inert` precedent, `packages/scene/src/inert.ts`). It carries a component list because protection is a property of an (entity, component) **pair** — `level-slots.ts:175` guards `SlotState` and leaves the same entity's `Transform` and `GltfContainer` wide open. Default on toggle-on: `['Transform']`, the smallest true thing and the component the official docs sync in their example.

**The enforcement, which already has a home.** `generate.ts:351` + `ensureAttached()` install `src/scripts/spawnables.ts` as a Script row on entity 0 at priority `-100` (`codegen.ts:29`) — *"One Script row on entity 0 installs the registry — no src/index.ts edit, ever."* Codegen emits a table and one call into that file's `start()`, inside `if (isServer())`, calling `protectedSync({ entity, syncId, components, validate: () => false })`. Priority `-100` arms the validators ahead of every creator script (default 0, `script-view.tsx:163`) and ahead of the first heartbeat, which is the window `sealProtectedRegistration()` exists to close. No upstream SDK change, no new boot module. Sync ids come from a reserved editor band (`0x5000`–`0x5FFF`), allocated deterministically per entity, with a codegen lint that fails if a hand-written kit constant lands in the band — that reservation is a one-way door, so audit `SLOT_SYNC_ID` and friends out of it up front.

**What the creator sees.** A `Toggle` labelled **Server-owned** in the properties panel, and a `<Chip size="xs" tone="server">server-owned</Chip>` on the header of each covered component — so green appears on Transform and not on GltfContainer, which is the truth. A checkable **Server-owned** `MenuItem` in the entity right-click menu beside the Placement items, cascading over a folder's Transform subtree the way `spawned-only.ts:32-40` does, in one `pushHistory` batch. **No hierarchy-row chip** — cut it: the tree row already carries `UI` and `outside` badges, and a one-word summary of a per-component fact is exactly the surface that does not change what a creator does next. **Nothing new during Play** — no observed-authority pill; a green dot confirming what the declaration already said is noise, and the only version worth building later is an *absence warning* ("Door is Server-owned, but the server never claimed it").

**The tip is `guarantees.ts:88-98` verbatim, because it is already the honest sentence:** *"The server rejects what a player's own client writes to it — the server's value wins."* Never *"only the server can change this"* — every client writes its local copy first and is corrected afterwards by `sendCorrectionToSender`. Never *"a player can't remove this"* — the SDK does not validate `DELETE_ENTITY` at all (`@dcl/sdk/network/server/index.js:62-89`, a bare TODO falling through to `return true`). Gate the whole property on `sdkCapability(projectDir)` (`sdk-capability.ts:20`): a scene without the Multiplayer Server toolchain has no server, so the property would be true in local Play and false in production.

**Two things must land with it, not after.** A scene check `server-owned-also-in-code` (*"Door is Server-owned, and door.ts claims it too. The script wins."*), and a `kind:"replaced"` flag in `ProtectedLedger.record` (`pure/protectedFields.ts:26`) — because `validateCallbacks.set(entity, cb)` **replaces** silently and the registry arms at `-100` while creator scripts arm at ≥0, so a creator's `protectedSync` always wins the clobber and nothing notices. And one thing must be verified first: that the Multiplayer Server instantiates the composite with the same entity numbering the editor and clients use. If it renumbers, the fix is `NetworkEntity.networkId`, not a patch. One `console.log` in a server-side `start()` during a local Play settles it.

---

## 6. Migration plan

| # | Commit | Size / numbers |
|---|---|---|
| 0 | **Lock the zone fact.** A runtime test that a `game.onEnterArea` registered only under `isServer()` never fires, and that an unbranched one does. | 1 test file. This is the finding the whole design turns on; it must be a regression test before anything else moves. |
| 1 | **Truthful guards.** Add `CorePorts.isServerNow()`; delete `greenSpans` (field, 2 span pairs at `gameCore.ts:472,773`, 8 call sites, the `:309-318` caveat); rewrite the 8 guard strings; give `serverState.ts:83` the same sentence. | `pure/gameCore.ts` + `game.ts` port wiring, ~2 files. |
| 2 | **Report, don't throw.** 10 registration guards emit scene-error cards through `emitError`'s existing `[game]` / `[you]` channel and return. Error strings carry class and method: `[you] MadnessRace.start(): …`. | ~10 constants + 1 report path. No new UI — `log-roles.ts` already colours both tags. |
| 3 | **Re-anchor the scanner.** Delete 3 tables (11 entries, `:35-55`) and the `:6-11` concession; re-anchor the region walk to `isServer()` consequents incl. `if (!isServer()) return` and the dispatcher form; widen `gameBindings` to `@dcl/sdk/network`; `RunsOnLine` gains the both-sides state and returns null for client-only. | `runs-on.ts` 311 lines, net ≈ −15; `runs-on.test.ts` 192 lines rewritten; `runs-on-line.tsx` ~50 lines. |
| 4 | **Templates and prompt.** Both templates rewritten; `ai-prompt.ts:81-86` rewritten. | 2 files, ~30 lines. |
| 5 | **Kit and fixture.** 4 facade prefabs (46 sites) + 5 tower scripts (52 sites) branch; 8 `isServer()` prefabs (23 sites) untouched; 36 of 48 kit scripts untouched. | ~30 inserted lines, ~120 re-indented, one reviewable diff. |
| 6 | **Static checks.** `trigger-area-in-branch`, `isserver-at-module-scope`, `wrong-side-call`, cross-side field (G5), all on the AST `parser.ts:280` already builds. | 4 checks, no new parser. Ship these *before* Play is the primary surface; the runtime card is the backstop. |
| 7 | **Docs.** 7 worked runs-on lines in the walkthrough; COPY-PACK `:20,55`; the 7 kit `ai.md` files that don't already teach `isServer()` (the other 5 become correct for free). | ~12 files, prose only. |
| 8 | **Server-owned property**, per §5 — after 0–7, never alongside. | Marker + codegen + panel chip + menu item + 1 scene check + ledger flag. |

**Not worth doing.** The `this.server.*` / `this.client.*` field bags — ceremony on every field to catch a mistake on the few that have one; the lint does it better. A re-exported `isServer()` from `./runtime/game` — one name, two contracts, defeated by the official import. Any hierarchy pill for sides — sides are a property of code, and one entity can carry three scripts with three different splits. The observed-authority pill from the `[SERVER] protected-sync` log stream — the dev-gate comments contradict each other (`protectedSync.ts:205-211` vs `game-life.ts:6-10`), and a confirmation dot is noise even once they agree. Migrating creator scripts outside this repo — nothing here removes an API, and the new cards only fire where code was already silently doing nothing. Triaging the other six `MULTIPLAYER-*.md` design records now.

**Two open items to settle inside commit 0–1, not later.** Whether `protectedSync`'s log payload should carry `componentName` instead of `componentIds` (`protectedSync.ts:148` already has it) — a one-line change now, a re-vendor across every prefab copy later. And what a bilateral `update()` at ~41 Hz with N scripts actually costs on a headless server; we are about to stop it happening by accident, which is the moment to measure what it was costing.

---

## 7. The strongest argument against this, stated fairly

The creator judge is right, and I will not soften it: **`if (isServer())` guards a region, and regions are what non-coders get wrong.** A method name is a lexical answer — scroll up, read the nearest name, done — and it stays cheap in a 200-line file. A boolean asks the creator to trace control flow: find the guard, work out which branch they are in, check whether a `return` already closed it. The leaks are ordinary, not exotic: a private helper called from both branches, a line after an `await`, a callback registered in the client half that closes over a server field, a `setTimeout` body with no branch at all. And this design deletes `greenSpans`, the only dynamic backstop we had, so the promise now rests entirely on the creator's control flow being what they think it is, with a text-scan static check as the enforcement. Design B makes those failures structurally impossible where this one makes them merely detectable, and B alone could have contained the `start()` throw at the entry point.

I still recommend it, for four reasons that outweigh that. The middle is not optional — Trigger Areas require a registration that runs on both sides, and a two-home model has nowhere to put it; a simpler mental model that cannot express the kit's own most-used feature is not simpler. The cost is real and asymmetric: 4 of 36 script prefabs vendor `runtime/game.ts`, so `extends Script` means pushing a 17–28 file runtime tree into 32 folders that today import only `@dcl/sdk`, while this design ships with 8 kit scripts and 2 fixtures already correct and 98 call sites unrenamed. The vocabulary rule the owner set decides the tie: `isServer()` is the official SDK API, it is what every docs page and every AI generation produces, and `serverStart` / `extends Script` exist nowhere in Decentraland — inventing them adds a second divergence while claiming to remove one. And the containment win is not actually B's: we get it by *not adding throws in `start()`* (G4), which is available on any path and is the right call regardless.

The honest summary is that we are trading a structural guarantee we cannot afford for a legible convention we can enforce most of the way — and buying, with the same move, the deletion of a verb table, a non-deterministic counter, a false sentence in the AI prompt, and a second side model in our own kit.