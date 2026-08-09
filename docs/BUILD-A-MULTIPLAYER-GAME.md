# Build a multiplayer game: Tower of Madness

Tower of Madness is a climbing race: every round a tower of three to eight obstacle chunks stacks itself in the middle of the parcel, and everyone climbs it against one shared clock. Every player who reaches the summit makes that clock drain faster for everyone still climbing.

**What it costs.** Around forty gestures in the editor — eleven of them are the chunk prefabs — plus nine files you type: 497 lines on disk, 349 once blank lines and comments come out. Nothing here is one click.

Everything below is transcribed from `packages/desktop/validate/fixtures/tower-of-madness/`, which compiles against the real SDK signatures and is exercised by `packages/desktop/src/tower-of-madness.test.ts`.

---

## The one idea: which side a line runs on

Your scene runs in two places at once. Each player has a **client** — their own copy, the only one that knows where their avatar is. Behind them all is one **Multiplayer Server**, the only copy that can be trusted with a score.

Two verbs cross between them, and only two:

- A client asks and awaits; the server answers. `const answer = await game.request(name, data)` on the client, `game.onRequest(name, (data, player) => answer)` on the server. `player` is the wallet the connection proves — a payload can never forge it.
- The server tells; a client listens. `game.broadcast(name, data, to?)` on the server, `game.onBroadcast(name, (data) => {})` on the client. There is no server-to-client request.

Which side a line runs on is written in the file:

```ts
import { isServer } from '@dcl/sdk/network'

start() {
  if (isServer()) {
    // the Multiplayer Server: one copy, shared by every player
    return
  }
  // the client: this player's own copy
}
```

**`update()` and `start()` both run on the Multiplayer Server too.** This is the fact that surprises everyone. The server ticks every frame like a client does, so an `update()` without the branch runs twice, once per side, and the server's copy has no avatar to read. The scaffold you get from **New script** already carries the branch in both methods, with that comment in it (`packages/ui/src/script/template.ts:84-99`) — leave it there.

If you put a line on the wrong side the runtime says so by name. `game.setState` called on a client prints *"game.setState only runs on the server. Put this line inside if (isServer())."*, and every server-only verb has its own version of that sentence (`packages/desktop/runtime-modules/pure/gameCore.ts:191-208`).

Server-only: `setState`, `onRequest`, `broadcast`, `onReady`, `onEnterArea`, `onPlayerJoin`, `onPlayerLeave`, `onRoundStart`, `newRound`, `positionOf`, `saved`, `playerData`. Client-only: `request`, `onBroadcast`, `layout`. Both sides: `state`, `onStateChange`, `now`, `round`, `every`, `childrenOf`.

---

## The build

### 1. The scene

**Add a scene → Create a new scene → Starter: Blank** (`packages/ui/src/features/home/NewSceneModal.tsx:50,54,91`; the two starters are Blank and Example, `packages/desktop/src/projects.ts:68-71`). The picker asks for a starter, a name and a location, and nothing else, so the scene opens as one parcel — grow it to 3×3 in **Scene settings → Parcels** (`packages/ui/src/features/scene-settings/SceneSettingsModal.tsx:67,121`).

There is no multiplayer starter and nothing to switch on. `src/scripts/runtime/game.ts` and its siblings appear the moment a script says `import { game } from './runtime/game'`.

### 2. The chunk prefabs

Drag your eleven chunk models in. Select each one and right-click → **Create prefab…** (`packages/ui/src/panels/EntityContextMenu.tsx:160`). The dialog asks for a name and for **Appears — From the start / When spawned** (`packages/ui/src/panels/CreatePrefabDialog.tsx:22-23,76`). Name them `Chunk 01` … `Chunk 10` and `Chunk End`, and pick **When spawned** for all eleven: a chunk exists only while a round is running.

Model each chunk entry-south / exit-north so the tower stacks without rotation. That is an authoring decision, and it is why no code below rotates anything.

### 3. Place the items

Open the **Prefabs** tab and drag each item into the viewport, or right-click its card → **Place in scene** (`packages/ui/src/panels/PrefabsPanel.tsx:607-608`). The four server items sit together under a **Multiplayer Server** group tile.

The first one you place raises **"Game Flow needs the server SDK"** with one button, **Install and place** (`packages/ui/src/panels/SdkGateDialog.tsx:19,28`). It runs `npm install @dcl/sdk@auth-server @dcl/sdk-commands@auth-server` in this scene (`packages/desktop/src/sdk-capability.ts:34`), takes a minute or two, and places the item when it is done. The second package is why local Play is a real game: that build of `sdk-commands` spawns a Multiplayer Server on every run.

Place: **Game Flow**, **Trigger Area**, **Health & Respawn**, **Announcer**, and **Leaderboard** twice.

Then add the plain entities the scripts point at — a plinth, `BaseSpawn`, `Home`, a `Tower` anchor, and a `ClockSign` with two text entities dragged under it. Rename each with right-click → **Rename** (`EntityContextMenu.tsx:128`); child entities come from **New child entity** (`:197`).

Rename the Trigger Area to **Start**. The name *is* the area's id — that is what `game.onEnterArea('Start', …)` matches (`packages/desktop/runtime-modules/game.ts:415-434`).

### 4. Set the params

Select an entity and its **Script** card in the Inspector shows the item's settings. Param labels are derived from the param names and rendered lower-cased — that is the shipped style, not a typo (`packages/ui/src/panels/fields.tsx:268-273`, used at `packages/ui/src/panels/views/script-params.tsx:44`).

| Entity | Settings |
|---|---|
| **Game Flow** | round seconds `180` · countdown seconds `3` · intermission seconds `10` · min players `1` · ends when **your own script** · board key `leaderboard` |
| **Health & Respawn** | respawn at **BaseSpawn** · max health `100` · die below height `1` |
| **Leaderboard** #1 | title `Best Times` · board key `leaderboard` · sort **lowest wins** · rows `8` |
| **Leaderboard** #2 | title `Season Points` · board key `seasonBoard` · sort **highest wins** · rows `8` |
| **Announcer** | stock — hold seconds `4`, font size `32` |
| **Start** (Trigger Area) | stock — the block is titled **Area settings**, not shown as a file (`packages/ui/src/panels/views/script-view.tsx:226`) |

Two dropdowns read as words rather than as their stored values: **ends when** offers *this clock* / *your own script*, and **sort** offers *lowest wins* / *highest wins* (`packages/ui/src/panels/views/enum-words.ts:11-20`).

**ends when → your own script** is the load-bearing one. This game's clock accelerates, so the round has to end on a condition. In that mode Game Flow's round length becomes a ceiling that keeps a forgotten `game.newRound()` from wedging the loop, and every round start — Game Flow's own and yours — still comes through its single `game.onRoundStart` hook, which is what stops the two from both ending one round.

**respawn at** is a dropdown of the scene's *named* entities plus *none* (`script-params.tsx:112-138`). An entity you have not named never appears in it — name the pad first.

### 5. The four attached scripts

Right-click the entity → **Add Script**, which selects it, opens its Script card and puts the cursor on **New script**; clicking that scaffolds the file and attaches it (`EntityContextMenu.tsx:151`, `script-view.tsx:259`). The scaffold auto-names the file, so rename it straight away with the row's **⋯ → Rename script** (`script-view.tsx:504`).

| File | Attached to | What it does |
|---|---|---|
| `tower-builder.ts` | **Tower** | one `game.layout` per chunk kind; the tower is arithmetic on the round's seed, so it costs no messages |
| `madness-race.ts` | **Tower** | the start gate, the summit check, the accelerating clock — printed in full below |
| `round-results.ts` | **Game Flow** | what a round is worth and when it ends: points, both boards, the teleport home |
| `clock-board.ts` | **ClockSign** | paints the remaining time onto whatever text entities are dragged under it |

`tower-builder.ts` needs its prefabs picked. Its params are typed `chunks: PrefabRef[]` and `endChunk: PrefabRef`, and that annotation is what turns them into pickers (`packages/ui/src/script/parser.ts:30-35`): **chunks** is a multi-select — pick all ten — and **end chunk** is a single one. `game.layout` takes what you picked there, never a folder name.

### 6. The five files nothing attaches

`race-ui.ts`, `pure/tower.ts`, `pure/clock.ts`, `pure/boards.ts` and `pure/names.ts` are imported by the four scripts above and attached to nothing.

There is no "new file" gesture. Two ways to make one, both real: ask **the assistant** to write it, or use **Attach an existing script…** on any entity, type the path (`pure/tower` becomes `src/scripts/pure/tower.ts` — `packages/ui/src/script/template.ts:38-42`), then remove the row with **⋯ → Remove script**. Removing a row unattaches it and leaves the file on disk (`script-view.tsx:210`).

Do not leave a helper attached. The runner constructs the first function-valued export of an attached file, so a `pure/` module on an entity would silently be run as a script.

---

## One script in full

`src/scripts/madness-race.ts` — both sides doing real work. Only a client can see where its own avatar is, so only a client can notice a summit, and all it does is ask. The answer is worked out once, against the server's own view of that player's feet and its own start stamp.

```ts
// Attempts, finish validation, and the madness: every finisher makes the round
// clock drain faster for everyone still climbing.
//
// The two halves of this file are the whole model, and the branches below are
// where to read them: only a client can see where its own avatar is, so only a
// client can notice a summit, and all it does is ask. The answer is worked out
// once, against the server's own view of that player's feet and its own start
// stamp.
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
// A client asks once it is essentially there, and re-arms back at the base.
const ASK_WITHIN_M = 1
const REARM_ABOVE_BASE_M = 4

// Round 1 is the round every scene boots into, and Game Flow keeps it as the
// lobby. Nothing closes a round there, so a finish taken then would be recorded
// and never paid — refuse it instead of banking a run that goes nowhere.
function inRound(): boolean {
  const fact = game.state[FLOW_KEY]
  if (typeof fact !== 'object' || fact === null) return false
  return (fact as Record<string, unknown>).phase === 'round'
}

export class MadnessRace {
  /** When each player last walked through the start gate. */
  private attempt: Record<Player, { atMs: number; round: string }> = {}
  /** Whether this player's request is already out. */
  private asked = false

  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start(): void {
    if (isServer()) {
      game.onEnterArea(START_ZONE, (player) => {
        this.attempt[player] = { atMs: game.now(), round: game.round.id }
      })
      game.onRequest(FINISH, (_data: unknown, player: Player) => this.finish(player))
    }
  }

  update(): void {
    if (isServer()) { return }
    const round = game.round
    if (round.number <= 0) return
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (me === null) return
    if (me.position.y < BASE_Y + REARM_ABOVE_BASE_M) this.asked = false
    if (this.asked || me.position.y < topFor(round.seed) - ASK_WITHIN_M) return
    this.asked = true
    // the answer IS the verdict — no broadcast to filter, no timeout to hand-roll
    void game.request<Verdict>(FINISH, {}).then(showVerdict, (error: unknown) =>
      showVerdict({ ok: false, why: error instanceof Error ? error.message : String(error) })
    )
  }

  /** The payload is empty on purpose: everything that decides this — who asked,
   * where they are, when they started — the server already knows. */
  private finish(player: Player): Verdict {
    const round = game.round
    if (!inRound()) return { ok: false, why: 'the round has not started yet — wait for the clock' }
    // "already finished" first: a run clears its own attempt, so asking the
    // other way round tells a finisher to start again instead of the truth
    const done = asRuns(game.state[FINISHERS_KEY])
    if (done.some((run) => run.p === player)) return { ok: false, why: 'already finished this round' }
    const attempt = this.attempt[player]
    if (attempt === undefined || attempt.round !== round.id) {
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
    game.broadcast(ANNOUNCE, { text: `A climber made it — the clock now drains x${speed}` })
    console.log(`[server] finish accepted — ${time.toFixed(2)}s, the clock now drains x${speed}`)
    return { ok: true, time }
  }
}
```

Read the shape, not the arithmetic. The client's `update()` returns immediately on the server, watches its own avatar's height, and asks once. The server's `start()` registers two hooks and does nothing else; every decision lives in `finish()`, which never trusts the payload — it is literally `{}`.

The clock is three numbers in `game.state`, not a countdown: `at`, `left`, `speed`. A finish raises `speed`, and every client integrates the rest locally, so the accelerating clock costs one small message per finish and a player who joins mid-round lands on the right number by arithmetic.

### The four files it imports

Shown trimmed to the exports this listing uses. The full fixture files also carry `clockText` (used by `clock-board.ts`), `Score`, `asScores`, `bestTimes`, `season` (used by `round-results.ts`) and `showPodium`.

```ts
// src/scripts/pure/tower.ts
export const CHUNK_KINDS = 10
export const CHUNK_HEIGHT = 6
export const BASE_X = 24
export const BASE_Z = 24
/** The plinth's top surface — the first chunk's floor. */
export const BASE_Y = 2
export const MIN_FLOORS = 3
export const MAX_FLOORS = 8

/** Which chunk kind stands on each floor, bottom first. */
export function towerFor(seed: number): number[] {
  let s = seed >>> 0
  const next = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const floors = MIN_FLOORS + Math.floor(next() * (MAX_FLOORS - MIN_FLOORS + 1))
  const picks: number[] = []
  // fixed draw count, sliced after: the floor count is itself a draw, so the
  // draw ORDER must not depend on it or two clients would build two towers
  for (let i = 0; i < MAX_FLOORS; i++) picks.push(Math.floor(next() * CHUNK_KINDS))
  return picks.slice(0, floors)
}

export function floorY(floor: number): number {
  return BASE_Y + CHUNK_HEIGHT * floor
}

/** Where the summit chunk sits — and the height a finisher must reach. */
export function topFor(seed: number): number {
  return floorY(towerFor(seed).length)
}
```

```ts
// src/scripts/pure/clock.ts
export interface Clock {
  at: number
  left: number
  speed: number
}

/** Defensive read: the clock crossed the wire and any script can clobber a key. */
export function asClock(value: unknown): Clock | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const num = (key: keyof Clock): number | null => {
    const raw = record[key]
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  }
  const at = num('at')
  const left = num('left')
  const speed = num('speed')
  if (at === null || left === null || speed === null) return null
  return { at, left: Math.max(0, left), speed: Math.max(1, speed) }
}

/** Seconds still on the clock at `nowMs`. */
export function remainingNow(clock: Clock, nowMs: number): number {
  const drained = ((nowMs - clock.at) / 1000) * clock.speed
  return Math.max(0, Math.min(clock.left, clock.left - drained))
}
```

```ts
// src/scripts/pure/boards.ts
export interface Run {
  p: string
  time: number
}

/** Defensive read of a game.state key holding this round's finishers. */
export function asRuns(value: unknown): Run[] {
  if (!Array.isArray(value)) return []
  const out: Run[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.p !== 'string' || record.p === '') continue
    if (typeof record.time !== 'number' || !Number.isFinite(record.time)) continue
    out.push({ p: record.p, time: record.time })
  }
  return out
}
```

```ts
// src/scripts/race-ui.ts
export interface Verdict {
  ok: boolean
  time?: number
  why?: string
}

export function showVerdict(verdict: Verdict): void {
  if (verdict.ok) {
    console.log(`[you] summit! ${(verdict.time ?? 0).toFixed(2)}s`)
    return
  }
  console.log(`[you] not counted — ${verdict.why ?? 'the server refused it'}`)
}
```

Everything read out of `game.state` goes through a defensive reader like `asClock` and `asRuns`. `game.state[key]` is typed `unknown` because it crossed the wire — there is no version of this that compiles without one.

---

## Play, and how to tell it worked

Press the ▶ button in the viewport toolbar (its tip reads *Run the scene* — `packages/ui/src/panels/Toolbar.tsx:159`). Local Play boots a real Multiplayer Server, so everything above is live.

Four things to watch:

- **The Game strip**, bottom-left of the viewport. `◐ Waking… 12s` on the first Play of a session, then `● Game running` (`packages/ui/src/features/play/game-life.ts:113-126`). Your first `finish` queues behind the wake and flushes when it lands. If it reads `✕ Can't reach the Multiplayer Server —` the strip offers a **Logs** button (`packages/ui/src/features/play/PlayGame.tsx:79-81`).
- **The zone chip.** Stand on the plinth and a chip reads `You're inside: Start`, tagged *editor only* (`packages/ui/src/features/play/PlayZones.tsx:14-15`). It is how you see the gate you named without guessing.
- **The logs.** The terminal button in the topbar, tip *Show build / server logs* (`packages/ui/src/features/editor/SceneTopbar.tsx:160`). The **Game** tab tags every line with which copy printed it: `[server] finish accepted — 41.20s, the clock now drains x2` next to `[you] summit! 41.20s` from your own client (`packages/ui/src/features/editor/LogsDrawer.tsx:95,110`). Those two tags are the doc for the whole model. The **Build** tab is the build.
- **The clock sign** going to `x2` after your first summit.

Play runs one avatar — yours. Two climbers taking the clock to `x3`, and a late joiner rebuilding the tower, need a second player: **Publish** in the topbar → **Publish to a world** (`SceneTopbar.tsx:103`, `packages/ui/src/features/publish/PublishModal.tsx:181`). Neither needs code — the clock is arithmetic on three synced numbers and the tower rebuilds from the round's seed.

---

## Traps worth knowing

**`game.saved` is empty in `start()`.** Saved data loads when the server wakes, which is after `start()` has run. Read it inside `game.onReady`, and the runtime will tell you if you forget: *"game.saved is loaded when the server wakes. Read it inside game.onReady, not in start()."* (`gameCore.ts:194`).

**Round 1 is the lobby.** Every scene boots into round 1 and Game Flow keeps it as the lobby, so nothing closes a round there. Any script that hands out points must gate on `game.state.flow`'s phase, not on a round existing — that is what `inRound()` above is for.

**Keep your round under the ceiling.** With **ends when → your own script**, Game Flow's round seconds is a safety net. `round-results.ts` runs a 60 s round plus a 5 s break, well under the 180 s ceiling, so the script always ends the round first. Set the ceiling *below* your own round length and every round ends on the ceiling instead: nobody is paid and both boards stay empty.

**The entity picker only lists named entities.** Name the pad before you go looking for it in **respawn at** or **home**.

**A moment is not a fact.** `game.broadcast` is shown once and then gone — a player who joins later never sees it. Anything that must survive a late join goes in `game.state`.

**Your script's own `movePlayerTo` needs a permission you cannot set in the editor.** `ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE` reaches `scene.json` because the **Health & Respawn** item declares it and placement merges it in (`packages/ui/src/prefabs/instantiate.ts:329`). There is no Permissions field in Scene settings — a scene without that item needs the line added by hand through the topbar's **Code** button.

**Edit a constructor outside the Studio and the inspector params go stale.** Saving from the Script Studio refreshes them; anything else needs the row's **⋯ → Reload params** (`script-view.tsx:507`).

**The assistant's edits are held for review.** A changed file shows *"The assistant changed this script. Review before it runs in the scene."* with **Accept all** and **Discard**, whole file either way (`packages/ui/src/script/code-editor.tsx:378-382`).
