> Status: owner's decision, 2026-08-08. Supersedes `docs/MULTIPLAYER-SIDES-DECISION.md`. Produced from a full-branch audit (runtime, editor, kit, teaching surfaces) plus two adversarial passes. Nothing here is implemented. Every number was re-counted against `feat/multiplayer-core` at `7c84617`.

# Sides in Decentraland Studio — what we build

## 1. Does the branch survive the new idea?

**Yes. The idea holds, and the branch is already closer to it in shape than we thought and further from it in count. But the document that argued for it does not survive intact: three of its numbers are wrong, one of its four load-bearing reasons is false, and its own flagship example ships the exact defect the rule exists to prevent.**

The rule itself is right and I am not reopening it. A creator says which side their code runs on, in the code, with the official `isServer()` from `@dcl/sdk/network`. It is the incumbent idiom of this repo — eight kit scripts already do it — it is what the vendored official skill teaches (`agent/skills/authoritative-server/SKILL.md:18`), and it is what every docs page and every assistant generation already produces. The alternative we scored against it — inventing `serverStart()` / `serverUpdate()` lifecycle methods — loses on vocabulary alone, and that is the tiebreaker you set. It does *not* lose on the reasons the old document gave, and I have struck those.

**What holds.** The check is truthful wherever a creator writes code. Every script already runs on the Multiplayer Server, constructor, `start()` and `update()`, at ~41 Hz, with no side branch in the runner. The core of the game module survives untouched: `state` (32 call sites, the best-earned export in the module), `round`, `now`, `saved`, `playerData`, `positionOf`, `newRound`, `every`, `layout`, the `Player` type, and the split between the SDK-facing `game.ts` and the SDK-free `pure/gameCore.ts` — which earns itself on one number, 924, the size of the test harness that stands up one server core and N client cores in a single process, impossible against a global singleton. Every scene check that reads what a script *does* rather than which region it is in survives untouched. So does every surface whose job is to put a creator in front of their code: the always-present Script card, the auto-expand, the right-click Add Script, the Logs drawer's Game tab. If the code is the declaration, those get *more* valuable, not less.

**What has to change, and one of these is a correction to a fact we told ourselves was settled.** First: **the "middle" is removable, and we should remove it.** The old document's strongest argument — that a Trigger Area must be registered on both sides, so a two-home model is wrong — rests on a single line. The client's watch list is filtered by what the script registered (`game.ts:559` walks `d.core.zoneNames()`, which returns only registered keys, `gameCore.ts:846-849`). But the client already has an independent, complete list of every placed Trigger Area in the scene, published by the Trigger Area item itself, and `game.ts` already imports that module (`import { onZone } from './zoneBus'`, `game.ts:25`). Source the watch list from the bus instead and the registration side stops mattering: `game.onEnterArea` becomes a plain server verb with one home, guardable and branchable like everything else. That is a handful of lines, and it retires a permanent third concept from every creator's mental model — a concept currently carried by **one call site in the entire tree** (`madness-race.ts:50`), whose sibling `onExitArea` has zero. Two homes, not three. This must be locked by a test before anything else moves, because it inverts a fact we previously called established.

Second: **the guard that reads the role must read it from the SDK, everywhere, not in one place.** Today the core caches a role pushed in from `fork()`, which runs one system *after* `start()`, so the cached value is `false` for every `start()` on the real Multiplayer Server. The old plan fixed the one guard that made the headline story work and left the same stale read in four other places — `send()` at `gameCore.ts:407`, `flushState()` at `:514`, `presentPlayers()` at `:804`, `sweepZones()` at `:935`. A `game.send` from a correctly branched server `start()` today takes the client path, permanently claims that message name as something players ask for, and issues a call to nobody. Fix all five.

Third: **nothing new throws, in `start()` or in `update()`.** A throw in `start()` is re-thrown by the runner and caught around the whole of scene construction plus `main()` — one throw silently aborts every remaining script. And a throw in `update()` is caught and printed by the runner *every frame, forever* (`runtime-script.js:194`), so the five data guards that could plausibly be hit from a client `update()` — the exact shape the scaffold teaches — would bury the Game tab at ~41 lines a second. Report a card and return, once per verb per session, in both methods.

**Three numbers to stop quoting.** There are not 23 `isServer()` call sites in the kit; there are 23 *lines mentioning it*, of which eight are imports, one is a prose comment and one is a debug log. Twelve form a branch, plus one that caches the answer into a field. Four kit guides teach it, not five, and three of those four belong to items hidden from the library — so exactly **one** guide a creator can reach teaches the check today. And 12 of 36 script-bearing items already vendor runtime code, not 4, which means the vendoring cost we used to reject the alternative design was overstated threefold. The alternative still loses; it loses on vocabulary, and the document should say so and nothing more.

**The best news is not legibility.** Declaring the side buys two performance corrections and two security corrections that nobody costed. Twenty-three furniture items ship a byte-identical seat script whose `update()` walks the transform chain per sit-spot on the Multiplayer Server at ~41 Hz — roughly 800 wasted walks a second in a twenty-seat lounge, fixed by two lines in one file. The admin-tools item builds its entire interface on the Multiplayer Server on every boot; two lines. And moving client-side message handlers out of the server's half deletes inbound endpoints the Multiplayer Server should never have exposed: today `respawn`, `announce` and `roundOver` are all armed server-side, which means a client can ask the headless server to run `movePlayerTo`.

---

## 2. The things that die

**About 260 lines of shipped code, seven design documents, and one item in the library.** Almost all of it exists for one reason: to encode which side a line runs on without the creator saying it. The creator says it now.

| What goes | Lines | Why it can go |
|---|---|---|
| The client-side half of the runs-on scanner: the `BLUE` and `BLUE_FREE` tables, the synced-state read detector, and the blue row it feeds | ~44 | Nothing renders a client-only line any more (`runs-on.ts:46-61,241-253,262-273`; `runs-on-line.tsx:40-47`) |
| `greenSpans`, the dynamic counter whose own comment concedes it is not airtight | ~15 | It is the direct cause of the guards misjudging correct server code (`gameCore.ts:309-318,472,479,493,773,783`) |
| `setRole` and the cached role field | ~9 | The push existed only because the core could not read the SDK; a port removes the reason (`gameCore.ts:299,356-363`) |
| `game.onClick` — **zero call sites in the entire tree** | ~12 | A two-line pass-through to the official SDK that discards hover text, distance and button, and existed only to be a side by construction (`game.ts:807-813`) |
| `game.onExitArea` — **zero call sites, ever** | ~15 | Its semantics are already covered by the presence sweep (`game.ts:737-742`, `gameCore.ts:840-844`) |
| `game.trace` as an export — one call site, our own probe | ~9 | Its own documentation tells the creator to turn it off, and it is reachable from the console with no export at all (`game.ts:791-798`) |
| Direction inference: `claimDirection`, the directions map as a creator-facing idea, and `GameDirectionError` | ~25 | With the message verbs split (§3), there is nothing left to infer (`gameCore.ts:219-228,295,365-372,411-419`) |
| The guarantee-chip copy tables | ~105 | **Already unreachable**: the function that would render them returns an empty list (`guarantees.ts:495`), and nothing outside tests calls the chip builders |
| The Zone Authority item | 27 + 3 files | 27 lines whose whole body is a call whose branch lives five lines deep in another module — the "branch hidden behind a call" leak, shipping, in the item whose selling point is not thinking about the server |
| The false sentence in the assistant's prompt, and the green test that pins it | 2 | `ai-prompt.ts:81` says *"there is no isServer()"* while eight of our own scripts use it; `guides.test.ts:324` asserts the lie |

Also gone: `childrenOf` leaves the game module for a plain entities helper (the proof it is in the wrong place is that another item needed exactly it and wrote its own copy at `player-rig.ts:330` rather than pay the import cost); the prose side-annotations in our own fixture (`madness-race.ts:4,39,41`), which are the defect that opened this review; and seven `MULTIPLAYER-*.md` design records that go to the archive with a one-line banner rather than a rewrite — two of them carry *"the fork … is expressed by which callback you write, never by an if"* as their headline sentence, and that must stop being citable.

One rename is worth its churn: `game.onStart` becomes `game.onReady`, three call sites. Under the new rule a creator writes `start() { if (isServer()) { … } }`, so `game.onStart` inside it reads as start inside start — and the confusion is not cosmetic, it is the cause of the worst silent failure in §3.

Not deleted, but named because nobody has: the Trigger Area verification exists twice in this repo, once in the runtime core with one call site and once as a 209-line item script. One of them should go. That decision belongs in this work, not after it, and I am not making it here.

---

## 3. Where the new idea breaks, and what we do about it

Six failures survived the adversarial pass. They are ranked by how likely a real creator is to hit them, and each one ships with its guard in the same commit as the change that creates it.

**1. One message verb, two contracts, and the side picks which.** This is the headline defect and the migration plan would have introduced it into a shipped item. `game.onMessage` registers into one map; on the server that registration hears what players send, on the client it hears what the server sends (`gameCore.ts:293-294`, `handleAsk` vs `handleTell`). Follow the scaffold, put `game.onMessage` inside the server branch, and a broadcast is dropped **quietly** on every client (`gameCore.ts:1004-1006`). The Announcer item registers it unbranched today for precisely that reason; branch it per the old plan and every announcement in the kit stops appearing, with no error, no card, and a chip that paints it "both sides" while it fires on one. The same for the tower's podium. Meanwhile `game.send` is the mirror image: on the client it asks and resolves with the answer, on the server it broadcasts and resolves nothing — and the old document ships both spellings 32 lines apart in its own flagship rewrite.

> **The guard: split them.** `game.ask` / `game.onAsk` for a message a player sends and the server answers; `game.tell` / `game.onTell` for a message the server sends to everyone. Thirteen call sites. The runtime already thinks this way internally — the wire envelope is literally `game.tell`, and the ports are `sendAsk` / `sendTell`. Splitting deletes the direction-inference machinery outright, deletes a lie (the player argument on a client handler is always empty, `gameCore.ts:1015`), and delivers the security win by construction rather than by creator discipline: a listener that only hears broadcasts can never arm an inbound endpoint on the Multiplayer Server. It also fixes failure 5 below for free.
>
> This is the one API change here I would not make without your word, because it is a coinage where the official API is polymorphic too, and your vocabulary rule bans "asks" and "tells" as nouns. The rule survives: these are verbs. Every creator-visible string still says *a message a player sends* and *a message the server sends*, never *an ask*. If you refuse the split, the fallback is a static check plus a scene card, which detects the same class instead of preventing it — weaker, and it leaves two contracts under one name in a model whose whole point is that the same tokens never mean two things.

**2. The server exists, but has not woken up yet.** A creator reads saved data in the server half of `start()` — the first line of server code most people write, and the scaffold's comment invites it. It returns nothing. Saved data is only populated when the server boots, which happens one system after `start()` runs. Today this throws a wrong but loud message; after we fix the guards it returns `undefined` silently, forever, and the first score written wipes the record that survived the restart. "Put this line inside `if (isServer())`" is useless advice here — the creator did that.

> **The guard: its own sentence, and a rename.** *"game.saved is loaded when the server wakes. Read it inside game.onReady, not in start()."* Renaming `game.onStart` to `game.onReady` is what makes that sentence make sense, and it is the reason the verb survives at all: it is the only hook that runs after saved data has loaded and before the first message is served (`gameCore.ts:738-747`).

**3. The stale role, in four more places than we fixed.** Covered in §1. A server `game.send` in a branched `start()` takes the client path and poisons the message name for the session, and the trace line blames the client.

> **The guard: one port, five readers.** Add `isServerNow()` to the core's ports, reading the official `isServer()`, and use it in the guard, in `send`, in `flushState`, in `presentPlayers` and in `sweepZones`. Then delete the pushed role.

**4. A blocker that fires on correct scenes, on the first Play after the scaffold changes.** A shipped scene check decides whether an item "keeps a server half" by testing its scripts for the token `isServer` (`placement.ts:39-44`). The moment the scaffold writes that token into every script, every spawn-only item in every project raises a blocker telling the creator to make a decorative prop appear from the start.

> **The guard: change the premise before the scaffold changes.** "Has a server half" must mean a *non-empty* server region, which the re-anchored scanner can answer, not the presence of a token. This is a prerequisite, not a follow-up.

**5. A false warning on a shipped item, produced by our own check.** The scene check that asks "does anything answer this message?" decides whether a send is a broadcast by testing whether it sits inside a green region (`runs-on.ts:299`). Re-anchor those regions to `isServer()` branches and the four items that use the game module have no branches at all, so a broadcast in the Game Flow item becomes an unanswered message and the card tells the creator to add a handler that would then trip the runtime's own "used both ways" warning.

> **The guard: the split from failure 1, landed first.** Once a broadcast is spelled `game.tell`, the check does not need regions to know it needs no answerer. If the split is refused, the scanner re-anchor and the kit migration must land in one commit.

**6. The Trigger Area registered in the wrong place, or in a callback.** Registered inside a branch it never fires; registered inside a round-start hook it never fires either, and the server's registry grows an entry per round. Both are silent.

> **The guard: retire the middle.** Source the client's watch list from the zone bus and the registration side stops mattering — both failures become impossible rather than detectable, and a whole concept leaves the creator's model. The cost is one refused claim per crossing of an area nobody listens to, against a rate limiter that already exists. Locked by a test first.

**Two more things that are not creator errors but would ship with the change.** Deleting the dynamic counter legalises a `setState` from a plain server `update()`, and there is no publish rate cap anywhere in that path — the old document calls it "one tick later (~24 ms)", which is true of one write and wrong about the steady state, which is up to 41 publishes per key per second. A per-key publish budget lands in the same commit as the deletion, or not at all. And **the scaffold cannot ship unconditionally**: `isServer` does not exist in the SDK a new scene ships with — our own capability probe uses that very absence as its test (`sdk-capability.ts:24`), and the installed standard SDK's network module has zero occurrences of the name. Gate the scaffold on the auth-server capability. A scene with no Multiplayer Server keeps today's shape and never sees a branch, which is also the honest answer to the objection in §7.

---

## 4. Tower of Madness, rebuilt

The build is **about 40 gestures, identical to today**. Not one step is added, removed, or reordered. What changes is inside the files.

| Phase | Gestures |
|---|---|
| New scene, grow to 3×3 in Scene settings → Parcels | 3 |
| Eleven chunk models → Create prefab… → Appears: When spawned | 12 |
| Place the kit: Game Flow, Trigger Area named `Start`, Health & Respawn, two Leaderboards, Announcer, four plain entities | 8 |
| Fill in the cards | 6 |
| Scripts: four attached, five made-then-detached helper modules | 9 |
| Play, Publish | 2 |

Two ordering facts the walkthrough must state, because the editor does not. **Place Game Flow before writing any script** — that is what installs the server toolchain, and until it does, a branched scaffold does not compile. And the Start gate's card will read *"Nothing reacts to this area yet."* for the whole session even after the race is wired, because that panel only finds reactions that name an area in a string parameter and the race names it in a module constant (`zone-listeners.ts:58`). Do not chase that message, and do not click **+ Add a reaction**, which scaffolds a second, client-only way to do what the race is about to do.

Typed lines, measured on the shipped fixture with blank and comment-only lines removed:

| File | Today | After | Δ |
|---|---|---|---|
| `madness-race.ts` | 73 | 82 | +9 |
| `round-results.ts` | 81 | 87 | +6 |
| `tower-builder.ts` | 29 | 34 | +5 |
| `clock-board.ts` | 26 | 31 | +5 |
| `race-ui.ts`, four `pure/` modules | 128 | 128 | 0 |
| **Total** | **337** | **362** | **+25 (+7.4%)** |

Plus roughly 45 lines of scaffold deleted by hand, because five of the nine files have no lifecycle at all and the scaffold got longer. **The rule is not a shortcut. It is a 7% typing tax, and what it buys is three deletions of untruth, one performance correction and one security correction.** Say that plainly in the walkthrough rather than selling it as simplification.

### The script that shows the model best

Not the flagship. `madness-race.ts` is the file the old document showcased, and under these decisions its client half is empty and its `return` is dead ceremony. The clearest file is `round-results.ts`, because it is the only one in the fixture where **both halves carry real work**, and because it is where the message-direction split pays for itself in the open.

```ts
// What a round is worth, and when it ends.
//
// The madness clock owns the ending, so Game Flow is placed with "Who ends a
// round: your own script" — its round length stays as a ceiling that keeps a
// forgotten game.newRound() from wedging the loop, and every round start (its
// own and this one's) still comes through Game Flow's single hook, which is what
// stops the two from both ending one round.
//
// Points accumulate privately in game.playerData; the top ten are folded into
// game.saved and copied into game.state, because playerData cannot be listed and
// a board has to be synced state every client can read.
import { Transform, type Entity } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { movePlayerTo } from '~system/RestrictedActions'
import { game } from './runtime/game'
import { asClock, remainingNow, type Clock } from './pure/clock'
import { asRuns, asScores, bestTimes, season } from './pure/boards'
import { showPodium } from './race-ui'

const CLOCK_KEY = 'clock'
const FINISHERS_KEY = 'finishers'
const FLOW_KEY = 'flow'
const TIMES_BOARD = 'leaderboard'
const POINTS_BOARD = 'seasonBoard'
const SAVED_TIMES = 'bestTimes'
const SAVED_SEASON = 'season'
const ROUND_OVER = 'roundOver'
const PODIUM = [100, 90, 80]
const FINISH_POINTS = 30

interface PlayerRecord extends Record<string, unknown> {
  points: number
  best: number
}

/** Reads synced state, so it is the same answer on both sides. */
function inRound(): boolean {
  const fact = game.state[FLOW_KEY]
  if (typeof fact !== 'object' || fact === null) return false
  return (fact as Record<string, unknown>).phase === 'round'
}

export class RoundResults {
  constructor(
    public src: string,
    public entity: Entity,
    // Defaults stay under Game Flow's own round length, which is a ceiling in
    // script mode: a round that hits the ceiling never reaches close(), so
    // nobody is paid and both boards stay empty.
    /** How long a round lasts before anybody finishes. Finishers drain it faster. */
    public roundSeconds: number = 60,
    /** How long the podium stays up before the next round's clock starts. */
    public breakSeconds: number = 5,
    /** Where players land when a round ends. Pick the pad by the start gate. */
    public home: Entity = 0 as Entity
  ) {}

  start(): void {
    if (isServer()) {
      // The server. One copy, shared by everyone.
      //
      // Saved data is loaded when the server wakes, not when start() runs —
      // which is why the boards are read in here and not four lines up.
      game.onReady(() => {
        game.setState({
          [CLOCK_KEY]: this.freshClock(),
          [FINISHERS_KEY]: [],
          [TIMES_BOARD]: asRuns(game.saved.get(SAVED_TIMES)),
          [POINTS_BOARD]: asScores(game.saved.get(SAVED_SEASON))
        })
      })
      // every round start lands here, whether Game Flow began it or close() did
      game.onRoundStart(() => {
        game.setState({ [CLOCK_KEY]: this.freshClock(), [FINISHERS_KEY]: [] })
      })
      game.every(1, () => {
        if (!inRound()) return
        const clock = asClock(game.state[CLOCK_KEY])
        if (clock === null || remainingNow(clock, game.now()) > 0) return
        this.close()
      })
      return
    }
    // The client — this player's own copy. Only a player's own client can move
    // that player, so the podium and the trip home happen here.
    game.onTell(ROUND_OVER, (data: unknown) => this.landed(data))
  }

  private close(): void {
    const finishers = asRuns(game.state[FINISHERS_KEY])
    for (const [place, run] of finishers.entries()) {
      const record = game.playerData<PlayerRecord>(run.p).get()
      game.playerData<PlayerRecord>(run.p).set({
        points: (record.points ?? 0) + (PODIUM[place] ?? FINISH_POINTS),
        best: record.best === undefined ? run.time : Math.min(record.best, run.time)
      })
    }
    const times = bestTimes(asRuns(game.saved.get(SAVED_TIMES)), finishers)
    const points = season(asScores(game.saved.get(SAVED_SEASON)), finishers, PODIUM, FINISH_POINTS)
    game.saved.set(SAVED_TIMES, times)
    game.saved.set(SAVED_SEASON, points)
    game.setState({ [TIMES_BOARD]: times, [POINTS_BOARD]: points })
    game.tell(ROUND_OVER, { top: finishers.slice(0, PODIUM.length) })
    game.newRound()
  }

  private landed(data: unknown): void {
    const top = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).top : []
    showPodium(asRuns(top))
    const spot = Transform.getOrNull(this.home)
    if (spot === null) return
    void movePlayerTo({ newRelativePosition: spot.position })
  }

  private freshClock(): Clock {
    // the break is the clock starting in the future: it reads full while the
    // podium is up, then drains — one number instead of a second phase machine
    return { at: game.now() + Math.max(0, this.breakSeconds) * 1000, left: Math.max(1, this.roundSeconds), speed: 1 }
  }
}
```

Six lines longer than today. What it deleted: the comment explaining that only a player's own client can move that player — the line's *position* says that now — and the two prose annotations on the private methods. What it bought: `game.tell` and `game.onTell` are two verbs with one meaning each, so nothing can silently register a broadcast listener on the wrong machine, and the Multiplayer Server no longer exposes `roundOver` as something a client can ask it to run.

**And the honest cost, in this same file.** `close()` and `landed()` lost their one-line side annotations and gained a control-flow trace: to know which side `close()` is on you must find its only call site, twenty-five lines up, inside a branch. What actually keeps them readable is the verbs — `saved.set` and `newRound` say server, `movePlayerTo` says client — which is to say the reader still runs the verb table in their head after we deleted it from the tooling. That is the cost of the rule, it lands in the file with the most private methods, and the cross-side field check is the only thing that will catch it when it goes wrong.

The other four files, briefly. `madness-race.ts` gets the Trigger Area registration inside the server branch (once the middle is retired) and a client `update()` whose server bail is a statement rather than an accident that depended on where the phantom avatar parks. `clock-board.ts` gets four lines that stop its `update()` walking every Transform in the scene five times a second on the Multiplayer Server. `tower-builder.ts` gets four lines that turn a silent no-op into a declared one. `race-ui.ts` changes by three words — it is a module of free functions with no lifecycle, so the rule has nothing to say about it, and its side is recorded nowhere except a console tag.

One thing must be budgeted that the old plan did not: **the tower's own test breaks.** It constructs every script while the mock host still reports client, then flips to server afterwards, modelling the fork-latched role we are removing. Under the new rule every `start()` takes the client path and nothing registers. Fixing it means setting the role before the server-side construction *and* standing up a second instance as a client for the podium path — a two-peer shape the harness does not have (`packages/desktop/src/tower-of-madness.test.ts:139,273-276,414-455`).

---

## 5. What we are not doing

**We are not inventing per-side lifecycle methods.** `serverStart` / `serverUpdate` / `extends Script` appear in no SDK export, no docs page, and not in the class template we already follow. They lose on your vocabulary rule and on nothing else — and the document should stop claiming they lose on the middle or on vendoring cost, because both of those arguments are false against this tree.

**We are not re-exporting a throwing `isServer()` from the game module.** One name, two contracts, defeated the moment anyone copies the official import — which is the whole reason we chose the official API.

**We are not renaming the `game` identifier.** 115 call sites, a wire-level global, and an import path baked into every generated scene, against a rename that would make `server.state` and `server.now()` actively wrong on the client. `game` names the scene's shared game, not the machine. What does change is every string around it: fifteen documentation comments in the module still call the server "the game", the console tags still print `[game]` and `[you]`, and thirteen creator-visible strings still say "screen". Those are the module's real vocabulary debt, and the tags matter most because they are wire-parsed, which means every script in the kit is currently *obliged* to print the banned word.

**We are not converting the Trigger Area reaction template to the game module.** It is the most common creator gesture in the editor and it currently depends on nothing but the item's own carried bus. Pointing it at the game module would vendor a 28-file runtime tree into every "open the door when someone walks up" scene. The old plan priced that at two files and thirty lines. Teach the Trigger Area verb in the race script and in the assistant's prompt; leave the reaction template alone.

**We are not keeping the runs-on chip in its current polarity — we invert it.** The promise that "the eight kit scripts light up with zero edits" is worth zero visible chips on the library a creator can place: six of the eight are in items hidden since `47ad4c0`, and the two placeable ones have empty server regions that render as nothing. Inverted, the chip says the one thing the code cannot say — *this script has no branch, so every line also runs on the Multiplayer Server* — and it fires on four kit scripts and four tower scripts today and on zero once they are migrated. Silent on a correct kit, loud on the file that forgot. That is the only version that changes what a creator does next. Note the open hole the old plan left: the tables being deleted are also the only source of the chip's words, so they survive demoted to a label table with no say in the side.

**We are not fixing the guarantee chips.** There is nothing on a card to fix — the renderer returns an empty list. Delete the tables, but lift the one honest sentence out of them first, because §5 of the old document quotes it verbatim as the tip for the Server-owned property.

**We are not executing the two vocabulary migration lists in `MULTIPLAYER-DEVEXP-REVIEW.md:122` and `MULTIPLAYER-COPY-PACK.md:102`.** They order a sweep *from* "client" *to* "screen". Whoever runs them next would remove the correct word from the surfaces this whole change is about. Strike both entries in the first commit.

**We are not shipping the Server-owned property in this work.** It is a real capability and it earns its surface, but it is a separate feature wearing this decision's coat, and it depends on a reserved sync-id band, which is a one-way door.

**We are not fixing the vendored script-components skill in this pass, but it is now a known defect.** It teaches the wrong home directory for scripts and it teaches the `@action` model this project forbids, and it is the skill the assistant reads to learn what a Script is. Fork it or drop it; do not leave it.

---

## 6. The plan

Ordered so the fact everything turns on is locked by a test before any code moves.

| # | Commit | Real numbers |
|---|---|---|
| 0 | **Lock the two facts.** A runtime test that `isServer()` is true inside the *first* `start()` on a real Multiplayer Server. A runtime test that a Trigger Area's watch list sourced from the zone bus fires for a registration made only under `isServer()`, and that today's registry-sourced list does not. | 2 test files. If the first fails, the rule is unimplementable as written and everything below stops. |
| 1 | **Truthful role, all five readers.** Add `isServerNow()` to the core's ports; use it in the guard, `send`, `flushState`, `presentPlayers`, `sweepZones`; delete the pushed role and the cached field. | 2 files, ~9 lines deleted, 5 call sites changed. |
| 2 | **Report, don't throw.** Ten registration guards and the five data guards that are reachable from `update()` emit a card once per verb per session and return. Strings carry class and method. | ~15 constants, 1 report path, no new UI. |
| 3 | **Delete the dynamic counter, and cap the publish rate in the same commit.** | ~15 lines out, one per-key budget in. Not separable. |
| 4 | **Retire the middle.** Source the client's watch list from the zone bus, including areas published after boot. `game.onEnterArea` becomes a server verb; `game.onExitArea` is deleted. | ~15 lines changed in `game.ts`, ~15 deleted across both runtime files. |
| 5 | **Split the message verbs** into ask/answer and tell/listen; delete direction inference; delete `game.onClick` and the `trace` export; move `childrenOf` out. | 13 call sites migrated, ~60 lines deleted. Must precede commit 6. |
| 6 | **Re-anchor the scanner, invert the chip, fix the spawn-only check's premise.** Delete the client-side tables; keep the label table as labels only; recognise `isServer` imported from the SDK; handle the inverted, dispatcher and field-cached forms the kit actually uses. | `runs-on.ts` 311 lines, `runs-on.test.ts` 192 lines rewritten, `runs-on-line.tsx` 50 lines, `placement.ts` 6 lines. |
| 7 | **Templates and the assistant's prompt.** Both templates gated on the auth-server capability. Raise the prompt cap from 14600 to 14800 — the prompt is 14443 today, so there are 156 characters of headroom and the replacement section needs about 220 more. | 3 files, ~40 lines. |
| 8 | **Kit and fixture.** Four items that use the game module and five tower scripts branch; twelve branch-forming sites elsewhere already conform; the two performance edits (one seat file covering 23 items, one admin-tools file). | ~60 inserted lines in unique files, ~120 re-indented, plus the tower test's two-peer rework. |
| 9 | **Four static checks**, on the AST the parser already builds: a Trigger Area verb inside a branch, `isServer()` at module scope, a wrong-side call, and a field written on one side and read on the other. The fourth is the one that finally retires the prose annotations. The transitive walk that finds a private helper called from both halves already computes its answer and throws it away. | 4 checks, no new parser. |
| 10 | **Docs.** Rewrite three (the copy pack, the developer-experience review, the walkthrough); archive seven behind a banner; strike the two backwards migration lists; correct eight kit guides. | ~14 files, prose only. |
| 11 | **Server-owned property**, per the old §5 — after all of the above, never alongside. | Separate. |

Two things to settle inside commits 0–1 rather than later: whether the protected-sync log payload should carry a component name instead of ids, which is one line now and a re-vendor across every item copy later; and what a bilateral `update()` at ~41 Hz with N scripts actually costs on a headless server. We are about to stop that happening by accident, which is exactly the moment to measure what it was costing.

---

## 7. The strongest case against

**Stated fairly, and it has three parts.**

First, the one the creator judge made and I will not soften: `if (isServer())` guards a *region*, and regions are what non-coders get wrong. A method name is a lexical answer — scroll up, read the nearest name, done, and it stays cheap in a 200-line file. A boolean asks a creator to trace control flow. The leaks are ordinary, not exotic: a private helper called from both halves, a line after an await, a callback in one half closing over a field the other half owns, a whole module of free functions whose side is recorded nowhere. Our own rebuilt fixture demonstrates it: three private methods lost a one-line answer and gained a control-flow trace, and a module of four functions has no place to say its side at all.

Second, and this one is newer and sharper: **the scaffold creates the hazard the static checks then exist to contain.** Today not one shipped file places a game-module call inside an `isServer()` branch — the eight scripts that branch and the four that use the module are disjoint populations. Write the branch into every new script and Trigger-Area-in-a-branch becomes reachable for the first time. The same move taxes the majority case: 30 of 40 kit scripts are client-only and would get a two-branch skeleton before their author types a `Transform`.

Third: nothing here is shipped, no creator outside this repo has written a script against it, and this is the least reversible option on the table. Once creators have `if (isServer())` in their files you cannot take it back.

**The answer, in four parts.**

The vocabulary rule decides the tie and you set it: `isServer()` is the official SDK API, it is what the vendored official skill teaches, and it is what every assistant generation produces. Inventing lifecycle methods adds a second divergence while claiming to remove one. That argument stands on its own and does not need the two false ones I have struck.

Three shipped things are *false*, not merely suboptimal — the sentence in the assistant's prompt, the header comment in our own reference fixture, and a guard that tells a creator standing on the Multiplayer Server that only the server can do what they are doing. Shipping known-false teaching in order to gather data on it is not a real option, so "wait for creator contact" is not available in full. What *is* available, and what I am taking, is that the two grafts which fix currently-wrong behaviour — the truthful role and no-new-throws — are correct under every possible answer and are not owned by this decision at all. They go first.

The scaffold objection is answered by a gate we need anyway. A branched scaffold cannot ship into a scene whose SDK has no `isServer` export, so the template must be capability-gated regardless. Gated, a scene with no Multiplayer Server never sees a branch — the 30-of-40 client-only case pays nothing — and a scene that has placed a multiplayer item is a scene where the fact is already true and already surprising.

And the region risk is smaller than it was when the argument was made, because two of the three hard cases are being removed rather than detected. Retiring the middle deletes the Trigger Area hazard by construction. Splitting the message verbs deletes the broadcast hazard by construction. What is left for the static checks is the ordinary leak class — a helper called from both halves, a field written on one side and read on the other — and the transitive walk that finds them already exists and already computes the answer.

**The honest summary is unchanged from the old document, with one correction.** We are trading a structural guarantee we cannot afford for a legible convention we can enforce most of the way. The correction is that we now know how much of the way: two of the three failure classes we were going to detect, we can instead make impossible, for about twenty lines and thirteen call sites — and that is the difference between a rule creators have to be careful about and a rule that mostly holds itself up.