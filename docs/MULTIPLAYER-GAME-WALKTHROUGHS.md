# Building real games in Decentraland Studio — worked walkthroughs

> Flagtag and Tower of Madness rebuilt as Studio creator sessions on the `game` API, with an adversarial verification pass. The plan changes it produced are recorded in MULTIPLAYER-DX-PLAN.md §12. Code in these walkthroughs predates the §12 fixes noted in the verification section at the end — read them together.

# Building Flagtag in Decentraland Studio

*A creator-session walkthrough of rebuilding `flagtag.dcl.eth` on the `game` runtime (MULTIPLAYER-DX-PLAN §2–§6), written to be honest about where v1 carries the game and where it strains.*

---

## 1. The game in one paragraph

Flag Tag is a free-for-all "keep away" in a medieval castle world: one flag, no teams. Find the flag, walk up and take it, and hold it — your score is cumulative hold-seconds. Walk close to the carrier and you steal it (3 s immunity after every take). Rounds last 5 minutes; at the boundary the top-3 get a podium and coins, and everything resets. Rubber-banding comes from hazards: lightning odds rise with the carrier's score until a strike forces a drop; the moat drowns you; coins scattered in the world fund a store of boomerangs and traps that stun the carrier into dropping. Today it is **26,988 lines of raw SDK source** (plus 3,251 lines of tests): 7,865 lines of hand-rolled server, ~80 message schemas, 20+ synced CRDT components, and a 900-line bespoke storage-reliability layer.

---

## 2. The session

### 2.1 New project

**File → New scene → "Multiplayer game"** template. The picker card says the one honest sentence: *"This scene has its own game server — free, sleeps when empty. Your scene runs a shared copy for everyone — players ask it, it decides."* The scene opens empty; zero runtime code exists until the first `game` import (the module generates into `src/scripts/runtime/game.ts` on first use). The creator drops in the castle GLB, the moat, the pedestal.

### 2.2 Place the kit (all names from plan §6)

| Gesture | Prefab | Inspector shows |
|---|---|---|
| Library → drag onto the courtyard | **Game Flow** | *"Lobby, countdown, rounds, winners — the heartbeat of a game."* Round length **5:00**, lobby countdown **10 s**, podium for **top 3** of `game.state.leaderboard`. Chip (derived, never declared): green ● *Everyone sees it*. |
| Drag onto the keep entrance | **Door & Switch** | *"A door whose open/closed everyone agrees on."* Door model = portcullis.glb; switch picked via **[Pick]** → the wall lever. |
| Drag ×20 around the map | **Collectible** (the coins) | *"Each player can pick this up once — gives points."* Gives points: **1**. Chip: *Remembered per player*. |
| Drag once (invisible) | **Points** | *"Give and track points per player."* Keep between visits: **✓** — this is the wallet. |
| Drag once | **Health & Respawn** | *"Players can take damage and respawn."* Respawn points: **4 (its children)** — the creator right-clicks it → **Add spawn point** four times and drags them to the castle corners (§9 `childrenOf`, structure not params). |
| Drag, stretch over the moat | **Trigger Zone** | Zone name: **Moat**. Damage on enter: **100** (routes through Health & Respawn). The zone volume is visible in Play. |
| Drag near the gate | **Announcer** | *"Show a message on every player's screen."* Its `ai.md` teaches: the game says `game.send('announce', { text })` and every screen shows the toast. |
| Drag onto the keep wall | **Leaderboard** (the flagship, rewritten on `game`) | Reads `game.state.leaderboard`; second instance set to *All-time* backed by `game.playerData` hold totals. |
| Drag onto a rooftop | **Pickup** (the mushroom) | *"One item, first player to grab it wins it."* The canonical `game.spawn` — one contested item, gives points: **30**, respawns each round. |

Struck deliberately: **Teams** (FFA), **Waves** and **Level Slots** (no wave enemies here), **Save Point** (Points' "keep between visits" already covers the wallet), **Spawner** (nothing decorative to scatter).

### 2.3 The flag — three custom scripts

The flag is a **placed entity** (flag.glb), not a spawned one. The key design move, straight from the plan's mental model: *the carrier is a fact* (`game.state.flag`), *the flag on someone's back is what each screen draws*. Nothing about the flag's motion ever crosses the wire.

**Script 1 — `flag-rules.ts`**, attached to the flag entity. Right-click → *Attach script* → *New script*. The template scaffolds the two-sentence model; the creator writes:

```ts
import { Entity } from '@dcl/sdk/ecs'
import { game, type Player } from './runtime/game'

const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.z - b.z)

export default class FlagRules {
  /** How close a thief must be to the carrier (meters). */
  constructor(public src: string, public entity: Entity, public stealRadius = 4) {}

  start() {
    game.onStart(() => this.reset())
    game.onRoundStart(() => this.reset())
    game.onMessage('takeFlag', (data, player) => {
      const f = game.state.flag
      if (!f || f.carrier === player) return { ok: false }
      if (f.carrier) {
        if (game.now() < f.immuneUntil) return { ok: false, why: 'immune' }
        const a = game.positionOf(player), b = game.positionOf(f.carrier)
        if (!a || !b || dist(a, b) > this.stealRadius) return { ok: false, why: 'too far' }
      }
      const stolen = !!f.carrier
      game.setState({ flag: { carrier: player, at: null, immuneUntil: game.now() + 3000 } })
      game.send('flagTaken', { by: player, stolen })
      game.send('announce', { text: stolen ? 'Flag stolen!' : 'The flag is taken!' })
      return { ok: true }
    })
    game.onEnterZone('Moat', (p) => { if (game.state.flag?.carrier === p) this.drop('moat') })
    game.onPlayerLeave((p) => { if (game.state.flag?.carrier === p) this.drop('left') })
  }

  drop(why: string) {
    const at = game.positionOf(game.state.flag.carrier) ?? null
    game.setState({ flag: { carrier: null, at, immuneUntil: 0 } })
    game.send('flagDropped', { at, why })
  }

  reset() { game.setState({ flag: { carrier: null, at: null, immuneUntil: 0 } }) }
}
```

Every idiom is a §2.3 recipe: identity comes from `(data, player)`, never the payload; the decision happens before anything slow; the payload's `flag: this.entity` claim is validated against state; `positionOf` is used for a **generous** 4 m check, not a precise one. `stealRadius` renders in the inspector as a number field. The behavior card's derived **runs-on line**:

> ● **in the game, for everyone:** takeFlag · enter Moat · player leaves · round start &nbsp;&nbsp; *(no blue side)*

**Script 2 — `flag-visual.ts`**, also on the flag entity. Its `base: Entity` param shows in the card as **Base — none · [Pick]** with the hint *"This flag won't return anywhere until you pick a base."* The creator clicks **Pick**, then clicks the pedestal in the viewport (§9 singular ref; composite id persisted, rename-proof).

```ts
import { Entity, Transform, AvatarAttach, AvatarAnchorPointType } from '@dcl/sdk/ecs'
import { game, onClick } from './runtime/game'

export default class FlagVisual {
  /** The pedestal the flag sits on and returns to. */
  constructor(public src: string, public entity: Entity, public base: Entity) {}

  start() {
    onClick(this.entity, () => void game.send('takeFlag', { flag: this.entity }))
    game.onStateChange(() => this.render())
    game.onMessage('lightningWarning', (d) => this.rumble(d.on))
    game.onMessage('struck', (d) => this.thunder(d.player))
    this.render()
  }

  render() {
    const f = game.state.flag
    if (!f) return
    const t = Transform.getMutable(this.entity)
    if (f.carrier) {
      AvatarAttach.createOrReplace(this.entity, {
        avatarId: f.carrier, anchorPointId: AvatarAnchorPointType.AAPT_NAME_TAG
      })
      t.position = { x: 0, y: -0.6, z: -0.35 }
    } else {
      AvatarAttach.deleteFrom(this.entity)
      t.position = f.at ?? Transform.get(this.base).position
    }
  }

  rumble(on: string) { console.log(`[you] storm gathers over ${on}`) }
  thunder(player: string) { console.log(`[you] CRACK — ${player} struck`) }
}
```

This is the whole carry system. `AvatarAttach` here is **client-local on every screen** — each screen attaches its own copy of the placed flag to the carrier's avatar, driven by the shared fact. Late joiners render the carrier correctly from the CRDT snapshot with zero extra code. Clicking the flag *on someone's back* is the steal gesture — same `takeFlag` ask, the game decides grab vs. steal. Runs-on line:

> ● **on this player's screen:** click flag · flagTaken · lightningWarning · struck · state changes

**Script 3 — `hold-score.ts`**, on an empty "Score" entity (a *placed* entity — green handlers on layout clones never install; trap 26 never comes up because the creator was never tempted):

```ts
import { Entity } from '@dcl/sdk/ecs'
import { game, type Player } from './runtime/game'

export default class HoldScore {
  round: Record<Player, number> = {}

  constructor(public src: string, public entity: Entity) {}

  start() {
    game.onRoundStart(() => { this.round = {}; game.setState({ leaderboard: [] }) })
    game.every(1, () => {
      const p = game.state.flag?.carrier
      if (!p) return
      this.round[p] = (this.round[p] ?? 0) + 1
      const d = game.playerData(p).get() ?? {}
      game.playerData(p).set({ ...d, holdSeconds: (d.holdSeconds ?? 0) + 1 })
      const top = Object.entries(this.round)
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([player, seconds]) => ({ player, seconds }))
      game.setState({ leaderboard: top })
    })
  }
}
```

This is the plan's canonical teaching example verbatim: *scores accumulate in `playerData`; the top ten are copied into `game.state.leaderboard` so every screen shows them.* The Leaderboard prefab and Game Flow's podium both read that key. Runs-on line: ● **in the game, for everyone:** every 1s · round start.

### 2.4 Two AI prompts

**Prompt 1**, from the flag's behavior card: *"While someone is carrying the flag, roll lightning every second — no risk under 100 seconds of hold time, rising to almost certain near 300; give the carrier a 3-second warning, then the strike makes them drop the flag."*

The diff comes back into `flag-rules.ts` — one field, one green block, every hunk green-striped *"runs in the game, for everyone"* and excluded from Accept All:

```ts
  strike: { on: Player; atMs: number } | null = null

  // inside start():
  game.every(1, () => {
    const f = game.state.flag
    if (this.strike && game.now() >= this.strike.atMs) {
      const s = this.strike; this.strike = null
      if (f?.carrier === s.on) {
        this.drop('lightning')
        game.send('struck', { player: s.on })
        game.send('announce', { text: 'Lightning! The flag is loose!' })
      }
    } else if (!this.strike && f?.carrier) {
      const held = (game.state.leaderboard ?? []).find((r) => r.player === f.carrier)?.seconds ?? 0
      const chance = held < 100 ? 0 : Math.min(0.95, (held - 100) / 200)
      if (Math.random() < chance / 5) {
        this.strike = { on: f.carrier, atMs: game.now() + 3000 }
        game.send('lightningWarning', { on: f.carrier, inMs: 3000 })
      }
    }
  })
```

Pure server timer + RNG + broadcast — exactly what the raw analysis says lightning *actually needs*, and here that's all it is. The runs-on line grows `· every 1s`.

**Prompt 2**, on the score entity: *"When a round ends, post the winner's name and hold time to my Discord."* Diff replaces `hold-score.ts`'s round-start line — note the reset happens **before** the await (the recipe discipline; flagtag's round-end race, hard part #4, is a shape the recipes simply don't produce):

```ts
    game.onRoundStart(async () => {
      const winner = (game.state.leaderboard ?? [])[0]
      this.round = {}
      game.setState({ leaderboard: [] })
      if (!winner) return
      const url = await game.secret('DISCORD_WEBHOOK_URL')
      await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: `${winner.player} won — ${winner.seconds}s on the flag` })
      })
    })
```

The **Publish flow now grows a "Secret keys" step**: `DISCORD_WEBHOOK_URL — used by hold-score.ts to post round winners. Stored on the game server only; you can replace it later, but never read it back.`

### 2.5 Play, then publish

**▶ Play ▾ → Play with a second player.** Split view, Player 2 on a guest wallet. Player 1 clicks the flag — `[game] takeFlag from 0x9a…` in the console, flag on their back on **both** tiles. Player 2 runs up and clicks the carried flag: steal, immunity, `Flag stolen!` toast on both screens. Player 2 wades into the moat volume: drowns, respawns at a corner, flag drops where they stood. **Player 2 joins late**: lands mid-round, sees the carrier, the countdown, and the live board — the CRDT snapshot did it, no `requestGameState` protocol exists to write. The **Game strip** shows `● Game running`; ticking **☐ Start like a real visit** replays the session behind a 15 s `◐ Waking…` spinner — sends queue, nothing times out. In the Play hierarchy the flag sits under the normal scene tree; `game.state`'s facts appear under **"Shared — one real copy."** Publish: checklist notes *"Your first visitor wakes the game (~15 s)"*, the secret gets pasted once, done.

---

## 3. What just worked — prefabs alone, zero code

- **Rounds**: 5-minute loop, lobby countdown, frozen round-end, top-3 podium — **Game Flow** (the original's `roundManager.ts` 596 lines + cinematic 537).
- **Coins + wallet**: Collectible ×20 + Points with *keep between visits* (vs. `economy.ts` 1,005 lines of claim tokens, rate windows, deterministic ids).
- **Castle gate**: Door & Switch — shared open/closed, one state key.
- **Drowning**: Trigger Zone "Moat" + Health & Respawn (vs. client-detected death + an untrusted `deathPenalty` ask flagged in flagtag's own KNOWN_BUGS).
- **Toasts, live scoreboard, all-time board**: Announcer + Leaderboard ×2 (vs. 3,111 lines of React-ECS UI plumbing plus leaderboard lifecycle guards).
- **The contested mushroom**: Pickup — first-grab-wins with an idempotency key the creator never sees.
- **Invisible but decisive**: late-join snapshot, cold-start queueing, server liveness ladder, per-player rate limits, payload caps, storage write-behind — all module-owned.

---

## 4. Where it strains — the honest list

1. **Proximity steal — the signature mechanic — is not v1.** The plan explicitly struck the PvP contact verb (decision log #3: *"no player-vs-player verb in v1"*; tag is off the coverage claims). What we shipped is **click-to-steal**: a deliberate click on the carried flag, server-validated with `positionOf` at a *generous* 4 m — honest per its 10 Hz/feet contract. An automatic 1.8 m steal *can* be hand-rolled (`game.every(0.25)` polling `positionOf` pairwise), but with client-authoritative movement at ~10 Hz and no position history it produces disputed, laggy steals — the original needed 500 ms position buffers and lag-forgiveness windows the API deliberately doesn't expose. **Unlocks later**: a post-G5 `onPlayerNear` built on module-kept position history with baked-in slack — the same construction-over-configuration treatment `onEnterZone` got.
2. **Flag carry**: `AvatarAttach` sync is unverified (G1 spike b). The workaround above — fact in state, every screen locally attaches its own copy — is actually *cleaner* than the original's 3-layer Anchor→Offset→Visual buffer, and costs zero wire traffic. The real gap is a **shared spawned** carryable: `game.spawn('flag', { attachTo: player })` waits on the spike saying yes.
3. **Boomerangs, traps, bombs — cut.** Homing projectiles with lag-forgiving hit windows, pre-created entity pools, and client-raycast ground reports are the planned-pool/outcomes expert machinery, explicitly off-limits to creator code (non-goal 3), and hit validation is impossible in principle for client-simulated objects (§11.3). A crude version — click a visible player, `game.send('throw')`, green checks `positionOf` distance — is buildable but plays nothing like a dodgeable projectile. **Unlocks later**: a combat-flavored prefab on the outcomes ledger (Waves' internals already are one), never a creator-facing API.
4. **Flag fall physics**: no analytic shared-fall or client-as-raycast-oracle surface. Our drop teleports the flag to the carrier's feet (`positionOf`, y included) — the arc, the water-sink animation, and with them ~600 lines of the original's nastiest threat modeling (raise caps, lower budgets, first-report-wins poisoning) simply don't exist. A dropped-in-moat check is 3 green lines against an authored rectangle (`if inMoat(at) at = null` → flag returns to base). Loss: spectacle. Gain: no residual "stranded flag" exploit — flagtag still ships that bug.
5. **The ghost — cut.** Chasing AI is struck by construction (*Waves = paths, not chase*; layout callbacks can't see players). **Unlocks later**: the G1 waypoint-verb spike (~1 Hz server waypoints, client interpolation) is exactly the primitive a night ghost needs.
6. **24/7 UTC-aligned continuous rounds** become Game Flow's lobby→round loop. `game.state` sleeps a few minutes after the last player leaves — fine here, because everything durable already lives in `playerData`/`saved`, but "round boundary at :00/:05 UTC even while empty" isn't a concept the kit has.
7. **Small change in texture**: coins are collect-once-per-player (Collectible) rather than contested 30 s-respawn world coins; mushroom speed-boost and updrafts stay client-local (fine) but broadcasting the "boosted" trail to *other* screens is a cosmetic relay someone must write; the store shrinks to a points-spend since the weapons it sold are gone.

---

## 5. The scoreboard

| | Flagtag today | Flagtag in Studio |
|---|---|---|
| Source | **26,988 LOC** (+3,251 test LOC) | **9 prefab kinds placed** + **3 scripts ≈ 100 lines** + **2 AI prompts (~35 diff lines)** |
| Server code | 7,865 lines, 27 files | 0 written; green handlers in the 3 scripts |
| Message schemas | ~80 registered | 0 (names on the module's envelope: `takeFlag`, `flagTaken`, `flagDropped`, `lightningWarning`, `struck`, `announce`) |
| Synced components | 20+, hand-guarded | 0 visible (`game.state` keys: `flag`, `leaderboard`) |
| Storage layer | 924 lines (`safeStorage` + `playerDoc`) | `game.saved` / `game.playerData` |
| Tests the creator writes for netcode | 23 specs | 0; G1 harness + `probe-game` own it |

**Traps this creator never faced — each one a scar in flagtag's actual source:** the 10 s Storage hang-timeout ticker, write-sequence repair, and transactional rollback (`safeStorage.ts:1-40`); duplicate `PlayerIdentityData` corpse entities cross-wiring positions (their signature platform bug); the hold-time shadow-total map guarding entity-slot recycling; *"removeEntity preserves the old NetworkEntity — 'id already in use'"* on flag re-sync; CRDT saturation from per-tick fall writes (~60/s) and the whole analytic-fall redesign; sync-id pools widened to outlast tombstone windows; round-end await-gap score resurrection and max-not-sum phantom-entity dodges; the 1 Hz heartbeat for CRDT-stall self-correction (`serverLife` is the module's job); `isServer()` false at load, sealed-engine registration, the Int64/BigInt coercion crash; payload identity spoofing (`player` is the connection's wallet, structurally); and Discord name sanitization (the webhook secret never reaches a client at all). The creator's total exposure to all of the above: the sentence on the template card and two colored dots on a behavior card.

**Bottom line**: roughly 70% of Flag Tag's *player-visible* game — flag, steal-with-immunity, hold-time scoring, rounds, podium, lightning, moat, coins, boards, Discord — assembles in one sitting from the §6 kit plus ~135 lines. What v1 honestly cannot reproduce is the *feel* of the other 30%: brush-past steals, dodgeable boomerangs, a chasing ghost — precisely the three items the G1 spikes and the post-G5 PvP-verb decision exist to price.
---

# Building Tower of Madness in Decentraland Studio

*The complete creator session, rebuilt on the `game` API (docs/MULTIPLAYER-DX-PLAN.md) against the engine facts in docs/CLIENT-SERVER-SPAWNING.md. Companion to the raw-SDK findings; every mechanic below maps to a line in that analysis.*

---

## 1. The game in one paragraph

Tower of Madness is a multiplayer vertical-platforming race: every round, a random tower — three to eight obstacle-course chunks drawn from ten models — stacks up in the middle of the world, and everyone climbs it against one shared 7-minute clock. Walk through the start gate at the base to begin an attempt, reach the summit to log a time; fall to the death plane and you walk back and try again. The "madness" is the pressure mechanic: every finisher accelerates the round clock *for everyone* — one finisher makes it drain 2×, two make it 3× — so each summit is bad news for everyone still climbing. Rounds end with a teleport home, a podium, points (100/90/80 for the top three, 30 for other finishers, consolation points for the highest climbers when nobody summits), and persistent all-time and seasonal leaderboards.

---

## 2. The session, step by step

### Step 0 — New project

**New scene → the multiplayer template card:** *"This scene has its own game server — free, sleeps when empty. Your scene runs a shared copy for everyone — players ask it, it decides."* Size 9×5 parcels. No `authoritativeMultiplayer` flag to know about, no `main()` to branch — a blank scene ships zero runtime code; `./runtime/game` generates on first import.

### Step 1 — The chunk library

Drag the ten middle-chunk GLBs plus `chunk-end.glb` into the scene, right-click each → **Save as prefab** (`chunk-01` … `chunk-10`, `chunk-end`). One authoring decision replaces a networking hack: every chunk is modeled entry-south / exit-north, so the raw scene's alternating-180° stacking dance isn't needed. Delete the placed originals — the tower is built per round, not authored.

### Step 2 — Place the base (all gestures, no code)

| Placed | Gesture / inspector state |
|---|---|
| **Game Flow** (kit) | Round length **10 min** *(a ceiling — the madness clock ends rounds early, see script 3)* · Intermission **10 s** · Countdown **3 s** |
| **Trigger Zone** (kit) | Name **Start**, 6×3×6 box at the tower base. Visible in Play, per the standing zone rules. |
| **Health & Respawn** (kit) | **Respawn at — none · [Pick]** → click **BaseSpawn** pad in the viewport (row flashes the pad on hover). **Die below height — 7** (the death plane). |
| **Leaderboard** (kit) ×2 | Board 1: *Best Times*, shows `game.state.leaderboard`. Board 2: *Season Points*, shows `game.state.seasonBoard`. |
| **Announcer** (kit) | Stock. Its `ai.md` documents the channel: green code sends `game.send('announce', { text })`. |
| **BaseSpawn** pad, ground, décor | Plain entities. **ClockSign** entity with two child text faces dragged under it (`childrenOf` collection — structure, not params). |

Selecting Game Flow auto-opens its behavior card: *"Lobby, countdown, rounds, winners — the heartbeat of a game."* That's the entire `server.ts` phase machine, placed.

### Step 3 — `tower-builder.ts` (custom script, attached to a placed **Tower** anchor)

Right-click Tower → **Attach script → New script**. The tower is ten prefab kinds sharing one plan, so the plan is a pure function of the round seed — the per-pool `rng` streams are deliberately unused (they differ per pool by construction; eleven pools must agree on one stack). Fixed draw count, slice after: the draw-order idiom.

```ts
import { game } from './runtime/game'
import type { Entity } from '@dcl/sdk/ecs'

const CHUNKS = ['chunk-01','chunk-02','chunk-03','chunk-04','chunk-05',
                'chunk-06','chunk-07','chunk-08','chunk-09','chunk-10']
const H = 10.821
const BASE = { x: 32, y: 10.5, z: 24 }

export function towerFor(seed: number): number[] {
  let s = seed >>> 0
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const count = 3 + Math.floor(next() * 6)                       // 3–8 middle chunks
  const picks: number[] = []
  for (let i = 0; i < 8; i++) picks.push(Math.floor(next() * 10)) // fixed draws, then slice
  return picks.slice(0, count)
}
export const topFor = (round: { seed: number }) => BASE.y + H * towerFor(round.seed).length

export class TowerBuilder {
  constructor(private src: string, private entity: Entity) {}
  start() {
    CHUNKS.forEach((chunk, kind) => {
      game.layout(chunk, (_rng, round) =>
        towerFor(round.seed).flatMap((k, i) =>
          k === kind ? [{ x: BASE.x, y: BASE.y + H * i, z: BASE.z }] : []))
    })
    game.layout('chunk-end', (_rng, round) => [{ x: BASE.x, y: topFor(round), z: BASE.z }])
  }
}
```

Runs-on line in the inspector: `● on this player's screen: tower layout (same for everyone)`. The seed is drawn by the game and published at round start (§11 seed secrecy) — nobody precomputes next round's tower. Late joiners rebuild it from the round tuple with zero traffic; the pool machinery owns the collider-reload hygiene.

### Step 4 — `madness-race.ts` (attached to Tower)

Attempts, finish validation, and the signature clock acceleration. The blue half detects the summit locally and *asks*; the green half re-checks height against the game's own view of the player's feet — the payload is a claim, position is server truth, identity is the connection's.

```ts
import { game, type Player } from './runtime/game'
import { engine, Transform, type Entity } from '@dcl/sdk/ecs'
import { topFor } from './tower-builder'
import { showVerdict } from './race-ui'

export const remainingNow = (c: { at: number; left: number; speed: number }, now: number) =>
  Math.max(0, Math.min(c.left, c.left - ((now - c.at) / 1000) * c.speed))

export class MadnessRace {
  private attempt: Record<Player, { at: number; round: number }> = {} // green room only
  private asked = false                                              // this screen only
  constructor(private src: string, private entity: Entity) {}
  start() {
    game.onEnterZone('Start', (p) => {
      this.attempt[p] = { at: game.now(), round: game.round.number }
    })
    game.onMessage('finish', (_data, p) => {
      const a = this.attempt[p]
      const done = (game.state.finishers ?? []) as { p: Player; time: number }[]
      if (!a || a.round !== game.round.number || done.some((f) => f.p === p)) return { ok: false }
      const feet = game.positionOf(p)                 // "feet, ~10×/second — generous checks only"
      if (!feet || feet.y < topFor(game.round) - 11) return { ok: false }
      delete this.attempt[p]
      const finishers = [...done, { p, time: (game.now() - a.at) / 1000 }]
      const left = remainingNow(game.state.clock, game.now())
      game.setState({ finishers, clock: { at: game.now(), left, speed: finishers.length + 1 } })
      game.send('announce', { text: `A climber made it — the clock now drains ×${finishers.length + 1}` })
      return { ok: true, time: finishers[finishers.length - 1].time }
    })
  }
  update() {
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (!me) return
    if (me.position.y < 15) this.asked = false
    if (me.position.y > topFor(game.round) - 2 && !this.asked) {
      this.asked = true
      void game.send('finish', {}).then((r) => showVerdict(r))
    }
  }
}
```

Runs-on line: `● in the game, for everyone: enter Start · finish   ● on this player's screen: summit check · verdict popup`. Three things to notice against the raw scene: the finish *time* is computed entirely in the game from the game's own start stamp (the raw scene's client `time` field was ignored for the same reason — here that discipline is the only expressible shape); the per-player verdict rides the ask's own resolve — no broadcast-with-address-filter, no hand-rolled 4-second VALIDATING timeout (the module's rpc timeout/retry is the timeout); and the clock tuple `{at, left, speed}` is the exact shape the raw scene invented — minus the 271-line NTP module, because `game.now()` exists.

### Step 5 — `round-results.ts` + `boards.ts` (attached to Game Flow's entity)

The clock ends rounds, points accumulate privately, the top ten go public — the §5 canonical idiom verbatim: *scores accumulate in `game.playerData`; at round end the top ten are copied into `game.state` so every screen shows them.*

```ts
import { game, type Player } from './runtime/game'
import { movePlayerTo } from '~system/RestrictedActions'
import type { Entity } from '@dcl/sdk/ecs'
import { remainingNow } from './madness-race'
import { bestTimes, season, type Run } from './boards'
import { showPodium } from './race-ui'

const PODIUM = [100, 90, 80], FINISH_PTS = 30, ROUND_S = 420, BREAK_MS = 10_000
const freshClock = () => ({ at: game.now() + BREAK_MS, left: ROUND_S, speed: 1 })

export class RoundResults {
  constructor(private src: string, private entity: Entity) {}
  start() {
    game.onStart(() => game.setState({
      clock: freshClock(), finishers: [],
      leaderboard: game.saved.get('bestTimes') ?? [], seasonBoard: game.saved.get('season') ?? []
    }))
    game.every(1, () => {
      if (game.state.clock && remainingNow(game.state.clock, game.now()) <= 0) this.close()
    })
    game.onMessage('roundOver', (d) => {
      movePlayerTo({ newRelativePosition: { x: 32, y: 11, z: 12 } })
      showPodium(d.top3)
    })
  }
  private close() {
    const finishers = (game.state.finishers ?? []) as Run[]
    for (const [i, f] of finishers.entries()) {
      const d = game.playerData(f.p).get()
      game.playerData(f.p).set({ points: (d.points ?? 0) + (PODIUM[i] ?? FINISH_PTS),
                                 best: Math.min(d.best ?? Infinity, f.time) })
    }
    const times = bestTimes(game.saved.get('bestTimes') ?? [], finishers)
    const pts = season(game.saved.get('season') ?? [], finishers, PODIUM, FINISH_PTS)
    game.saved.set('bestTimes', times); game.saved.set('season', pts)
    game.setState({ leaderboard: times, seasonBoard: pts })
    game.send('roundOver', { top3: finishers.slice(0, 3) })
    game.newRound()
    game.setState({ clock: freshClock(), finishers: [] })
  }
}
```

```ts
import type { Player } from './runtime/game'
export type Run = { p: Player; time: number }
export type Score = { p: Player; pts: number }

export function bestTimes(board: Run[], runs: Run[], n = 10): Run[] {
  const m = new Map(board.map((r) => [r.p, r.time]))
  for (const r of runs) m.set(r.p, Math.min(m.get(r.p) ?? Infinity, r.time))
  return [...m].map(([p, time]) => ({ p, time })).sort((a, b) => a.time - b.time).slice(0, n)
}
export function season(board: Score[], runs: Run[], podium: number[], base: number, n = 10): Score[] {
  const m = new Map(board.map((s) => [s.p, s.pts]))
  runs.forEach((r, i) => m.set(r.p, (m.get(r.p) ?? 0) + (podium[i] ?? base)))
  return [...m].map(([p, pts]) => ({ p, pts })).sort((a, b) => b.pts - a.pts).slice(0, n)
}
```

Runs-on line: `● in the game, for everyone: every 1s · saved boards · round over   ● on this player's screen: teleport home · podium`. `roundOver` is the mapping table's "announcement with a client effect — fine as is": the game tells, every screen obeys `movePlayerTo`. Per-name direction holds: `finish` is asked by players, `roundOver` and `announce` are told by the game; a script reusing a name the other way is a dev-Play error, not a silent bug.

### Step 6 — `clock-board.ts` (attached to ClockSign; faces are its children)

```ts
import { game, childrenOf } from './runtime/game'
import { TextShape, type Entity } from '@dcl/sdk/ecs'
import { remainingNow } from './madness-race'

export class ClockBoard {
  constructor(private src: string, private entity: Entity) {}
  update() {
    const c = game.state.clock
    if (!c) return
    const left = remainingNow(c, game.now())
    const text = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` +
      (c.speed > 1 ? `  ×${c.speed}` : '')
    for (const face of childrenOf(this.entity)) TextShape.getMutable(face).text = text
  }
}
```

Runs-on line: `● on this player's screen: clock faces`. Every screen integrates the remaining time locally from three shared numbers — the raw scene's exact no-per-tick-sync design, now a four-line derivation on a stock clock. Add a face by dragging another text entity under ClockSign; the card shows **Faces: 3 (its children)**.

### Step 7 — Two AI prompts

**Prompt 1** (round-results.ts open): *"If nobody finishes a round, give 5,4,3,2,1 points to the five highest climbers instead."* Expected diff — every hunk green-striped *"runs in the game, for everyone"*, excluded from Accept All:

```diff
 export class RoundResults {
+  private high: Record<Player, number> = {}   // green room only
   start() {
+    game.onPlayerJoin((p) => { this.high[p] = 0 })
+    game.onPlayerLeave((p) => { delete this.high[p] })
+    game.every(0.5, () => {
+      for (const p of Object.keys(this.high)) {
+        const feet = game.positionOf(p)
+        if (feet) this.high[p] = Math.max(this.high[p] ?? 0, feet.y)
+      }
+    })
   private close() {
     const finishers = (game.state.finishers ?? []) as Run[]
+    if (finishers.length === 0) {
+      Object.entries(this.high).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([p], i) => {
+        const d = game.playerData(p).get()
+        game.playerData(p).set({ points: (d.points ?? 0) + (5 - i) })
+      })
+    }
+    for (const p of Object.keys(this.high)) this.high[p] = 0
```

**Prompt 2** (madness-race.ts open): *"Watch for players who gain height impossibly fast — more than 12 meters per second. First time is a warning; after that their attempts don't count."* Expected diff: a green `game.every(0.5)` sampler over `game.positionOf`, a `strikes` record, a warning via `game.send('warned', {...}, { to: p })`, and one guard line in the finish handler — `if ((this.strikes[p] ?? 0) > 1) return { ok: false }`. This is the raw scene's teleport-strike heuristic in ~15 lines; `positionOf`'s JSDoc ("generous checks only") is the contract that scene had to discover empirically.

### Step 8 — The fly-up camera

Ported nearly verbatim from `cinematicCamera.ts` as blue code — `VirtualCamera`, `MainCamera`, keyframes, the hand-rolled lookAt. The only part Studio replaces is the trigger plumbing: one blue `game.onRoundStart(() => flyUp(topFor(game.round)))` instead of phase-transition detection over synced components. ~310 lines survive untouched (see §4).

### Step 9 — Play

- **▶ Play**: climb, finish, watch the clock chip go ×2. Console shows `[game] finish accepted` next to `[you] verdict shown` — the doubled-log mystery pre-answered.
- **Play with a second player**: split view, guest wallet. The Play hierarchy tells the ownership story: the tower chunks sit under **"Your screen's copy"** on *both* tiles (identical layout, locally owned — not a bug, the label says so), while `clock`, `finishers`, and the boards sit under **"Shared — one real copy."**
- **Player 2 joins late** mid-round: the tower reconstructs from the round tuple, the clock lands correct by arithmetic, the boards arrive with the snapshot. No code was written for any of this.
- **☐ Start like a real visit** on before the final run: the Game strip shows `◐ Waking… 12s`, the first `finish` queues, then flushes. Cold-start behavior verified before a visitor ever sees it.

### Step 10 — Publish

Saved data tab → two-step **Clear all saved data** (drop the test-run boards). No Secret keys step appears — nothing calls `game.secret()`. The checklist carries the one warning that matters: *"Your first visitor wakes the game (~15 s)."* Publish.

---

## 3. What just worked

- **The round loop cost zero lines.** `server.ts` (338 lines: phase machine, boot-delay-by-dt-accumulation because "setTimeout not available in sandbox", height sweeps) is the Game Flow prefab plus one `game.every(1)` check. Lobby, intermission, countdown, late-join fast-forward: placed, not programmed.
- **The seeded tower is the layout showcase.** The raw scene's tower is its heaviest networking artifact: a 9-entity pre-created synced pool, full component sync per round, plus two documented collider hacks (destroy 10 s early so clients unload physics; blank `GltfContainer.src` so the CRDT sees a change) plus a TriggerEnd re-parented to world space because parents don't sync. Here the tower is **derived, not synced**: eleven `game.layout` pools re-run a pure plan from the round seed on every screen and every late joiner, zero wire traffic, and the collider-reload hygiene lives inside the pool runtime where it was already written once. The random-per-round hazard course — the heart of the game — became the *cheapest* part of the scene.
- **The accelerating clock without NTP.** The raw scene's smartest design (sync only `{lastSpeedChangeTime, remainingAtSpeedChange, speedMultiplier}`, integrate locally) forced it to build a 271-line NTP module first. Here the same design is three state keys, a four-line pure `remainingNow`, and `game.now()`.
- **Leaderboards are prefab + idiom.** Per-player bests in `playerData`, boards in `saved`, top ten copied to `game.state`, two Leaderboard prefabs render them. The raw scene's Storage-JSON maps, string-key change-detection dedupe, weekly persistence dance, and 1,337 lines of board rendering collapse into `boards.ts` (14 pure lines) plus placements. State sharding + per-key coalescing make the dedupe hack unnecessary.
- **Every per-player exchange got honest delivery.** `attemptRejected`/`teleportWarning`-style broadcast-then-filter-by-address is gone: the finish verdict is the ask's return value; warnings are `{to: player}` (SFU-enforced — non-targets never receive it). The client-side 4 s validation timeout is the rpc layer's own timeout.
- **`onEnterZone` is the whole start gate.** The raw scene runs hand-rolled point-in-AABB checks every frame plus server-side height re-validation; here the detect→ask→verify dance is the only shape the API can express.

---

## 4. Where it strains

- **The podium is the biggest visible cut.** The raw scene's crowning flourish — three dancing avatar clones wearing the winners' real wearables — leans on server-side `getPlayer()` appearance scraping, a 1 s insurance cache, an HTTP profile fallback, and emote replay via timestamp bumps. v1 `game` has no profile/appearance ask, and the headless target has no AvatarBase at all. This session ships names and times on the podium toast and boards (blue-side `getPlayer()` resolves display names for connected players). The spectacle waits on a platform-level profile ask.
- **The camera gains nothing from `game.*` — by design.** It's client-local, so it's *allowed* (blue code is full SDK), but ~310 of the session's ~500 hand-written lines are the ported cinematic camera. Studio's multiplayer story doesn't touch camera work; only the trigger shrank.
- **Moving hazards: paths and clock-keyed motion only.** Obstacles baked into chunk GLBs and tweens keyed to `game.now()` are deterministic and fine. Anything that *chases* — a pursuer climbing after the pack, the WaveDirector-with-zombies idea this very scene dogfooded (and shipped inert, zombie param empty) — is out in v1: layout callbacks can't see players by construction, and chasing enemies are unreconstructible for late joiners. That waits on the G1 waypoint spike, honestly.
- **The madness clock fights Game Flow's fixed timer.** Round length is demoted to a ceiling; the custom script ends rounds via `game.newRound()` and the stock countdown chip is hidden in favor of ClockSign. Workable, but the kit's heartbeat and the game's signature mechanic overlap awkwardly.
- **`layout` is single-prefab; the tower is ten kinds.** The eleven pools agree only because the plan is a hand-written pure function of `round.seed` — the API's per-pool rng streams were deliberately bypassed. It works and it's safe, but the API didn't help; a multi-variant layout is a v1.1 wish.
- **Tournament, MANA prize, wearable claim: struck.** `game.secret()` would hold the wallet key properly, but ethers-over-signedFetch and the client-side claim handshake are expert code outside the kit and outside this session. The raw scene ships them; this rebuild doesn't.
- **Small hand-rolls remain:** weekly rollover would still be a UTC-week key in green code (the "rollover as policy" idea didn't make v1 — this session ships a single season board instead), and the honest ceiling is unchanged from today: movement is client-authoritative, so strikes *bound* teleport cheating, never prevent it. The game tracks results; players report actions.

---

## 5. The scoreboard

| Layer | Raw scene (LOC) | Studio session |
|---|---|---|
| Phase machine + anti-cheat sweep (`server.ts`) | 338 | Game Flow prefab + ~12 lines + one AI diff |
| Game state, tower, boards, points (`gameState.ts`) | 1,259 | `tower-builder` 30 + `round-results` 40 + `boards` 14 |
| Client glue (`index.ts`) | 841 | folded into the scripts (~20) |
| Sync facade + schemas + messages | 581 | 0 |
| Time sync (`timeSync.ts`) | 271 | 0 — `game.now()` |
| Leaderboard rendering (5 files) | 1,337 | Leaderboard prefab ×2 |
| UI (`ui.tsx`) | 1,916 | Announcer + `clock-board` 14 + ~60 popup |
| Podium avatars | 353 | cut (§4) |
| Prize + tournament | 83+ | cut (§4) |
| Cinematic camera | 334 | ~310 ported as-is |
| Snapshots/face UI | 242 | cut |
| **Hand-written total** | **≈7,765** | **≈500 (≈190 game code + ~310 camera)** |

Plus: the 18,109 lines of per-prefab duplicated runtime under `custom/` become invisible library plumbing, and the 2,737-line generated kit is the same runtime this API composes.

**Traps this session never met** (each one bitten, hacked around, or comment-documented in the raw scene):

- **`isServer()` false at module load** — the raw kit needed the lazy-transport-fork pattern and the bevy sync-op saga to survive it. Here the fork doesn't exist in creator space: nobody typed `isServer()`, and the module decides its half on first tick (trap 5, dead by construction).
- **Heartbeat / stale-snapshot liveness** — the raw scene's world needs a heartbeat field and distrust of `isStateSyncronized()` (first-chunk lie, stale replays from dead runs). Here the serverLife ladder is the Game strip, sends gate on it automatically, and the module's boot-wipe re-adopts and overwrites stale SharedFacts — the creator wrote none of it (trap 8/13).
- **Collider-reload hacks** — the destroy-10-seconds-early dance and the `src=''` reset are the runtime's job now, not scene code.
- **NTP by hand** — 271 lines → `game.now()`; the BigInt/Int64 arithmetic trap dies with it.
- **Broadcast-with-address-filter** — replaced by ask replies and enforced `{to}`.
- **Moments used as facts** — `playerFinishedBroadcast` and friends survive as `announce`/`roundOver` (moments), while everything a late joiner must see rides state; the distinction is API-shaped, not convention.
- **Identity from payload** — the raw scene's discipline (ignore the client's `time` field, look the name up server-side) is now the only expressible shape: `player` *is* the connection.
- **Manual AABB trigger checks, entity pools for stable sync ids, Storage silent-false, 12/13 KB edges, sandbox-has-no-setTimeout** — all module-owned.

The two things that don't shrink are the two things the raw scene got right for reasons outside networking: the camera, and the chunk GLBs themselves.
---

# Verification notes

## Verification of the two walkthroughs against docs/MULTIPLAYER-DX-PLAN.md (+ docs/CLIENT-SERVER-SPAWNING.md)

**Checks that pass (both walkthroughs)** — stated once, not repeated below: identity always from `(data, player)`, never payload; all `setState`/`saved`/`playerData`/`secret`/`spawn` calls sit in green contexts; blue↔green flows use only `send`/`onMessage` with per-name direction respected (`takeFlag`/`finish` asked by players; `announce`/`roundOver`/`warned`/`struck`/`lightningWarning` told by the game); `{to}` only in green; no `isServer`/`syncEntity`/`registerMessages`/`MessageBus`/`Storage`/`EnvVar` anywhere; no `Math.random`/`Date.now` inside layout callbacks (W2 hand-rolls a pure LCG of `round.seed` — trap-10 clean); template-card copy, runs-on-line format, Pick gesture + hover-flash, `childrenOf` counts + "Add spawn point" verb, Play ▾ menu, Game strip states, `[game]`/`[you]` tags, "Shared — one real copy"/"Your screen's copy" labels, Saved-data two-step clear, and the Secrets publish step (incl. verbatim consequence line) all match §3/§5/§9. Neither walkthrough uses `myData`, `onOutcome`, or chase AI. `onPlayerNear` appears in W1 only as a labeled post-G5 "unlocks later" idea, consistent with decision #3. **`announce` is not a violation**: both use `game.send('announce', {text})` as a message *name* on the symmetric pair via the Announcer prefab — exactly what decision #2 sanctions (only the dedicated `announce`/`onAnnounce` verb was struck).

---

### Walkthrough 1 (Flagtag) — corrections

1. **All-time Leaderboard "backed by `game.playerData` hold totals" is not buildable as described** (§2.2 kit table). `playerData` is green-only, per-wallet, and has no enumeration API in §2.2; a display prefab cannot read it. An all-time board needs a green-maintained aggregate (top-N incrementally folded into `game.saved` and copied to a `game.state` key — exactly what W2's `boards.ts` does correctly). Fix: `hold-score.ts` maintains `game.state.allTime` from a saved aggregate, or the second board is cut.
2. **The `takeFlag` handler never validates `data.flag`**, yet the prose claims "the payload's `flag: this.entity` claim is validated against state." Nothing reads `data.flag`. §11.2 ("payloads are claims — validate every claim") demands either an actual check or dropping the claim. Related: the single hard-coded `flag` state key means `flag-rules.ts` is *not* safe-to-place-twice, so the walkthrough shouldn't gesture at the derived-key idiom while not following it (fine for a one-flag game — but say so).
3. **Unmatched message names — W1's own code trips G2b.** `flagTaken` and `flagDropped` are green-sent but no script registers a blue `onMessage` for either; §2.2/G2b flags unmatched send/onMessage names at edit time. Also the flag-visual runs-on line lists `flagTaken`, which that script never registers — the derived scanner could not produce that line.
4. **Collectible chip "Remembered per player" conflicts with §6's definition.** §6 defines Collectible as "one per-player state flag + one message" — a `game.state` flag dies when the game sleeps (§5 lifetime table), so the derived chip would not read "Remembered per player" (that's the `playerData` chip). Since the walkthrough's wallet story leans on coins being once-ever, either Collectible must be playerData-backed (and §6's description updated) or the chip and the once-ever claim are wrong.
5. **Trigger Zone "Damage on enter: 100 (routes through Health & Respawn)" is invented capability.** §6's zone/Health surfaces don't specify cross-prefab damage routing; the "Drowning: zero code" claim in W1 §3 depends on it. Needs to be named as G5 rework scope, not assumed.
6. **`game.onRoundStart` used green (calls `reset()` → `setState`)** — the plan never assigns this callback a side; see New Gaps #1.
7. **Game Flow "podium for top 3 of `game.state.leaderboard`"** assumes Game Flow reads a creator-maintained state key — no such key-contract is specified (see New Gaps #4).
8. **Strain 7 under-declares the store**: "the store shrinks to a points-spend" — no Store prefab exists in §6; that's a bespoke script + UI, and the strain list should say so.
9. Minor: "New scene → 'Multiplayer game' template" — §3 says every scene is an auth scene since P0 and §1 speaks of *the* template picker card; a distinct multiplayer template contradicts the dead-surface cut. Minor: `game.round.number` never used here — good — but note W2's use (below).

### Walkthrough 2 (Tower of Madness) — corrections

1. **`game.round.number` does not exist in the plan.** §2.2/CSS define the round tuple as `{seed, phase, phaseStartMs, configVersion}` — no counter. `madness-race.ts` keys attempt validity on it. Either key on `round.seed` or the plan needs a round counter (New Gaps #2).
2. **`game.onRoundStart` used blue-side** (step 8: camera fly-up) while W1 uses it green-side — the two walkthroughs jointly expose that the plan never assigns this hook a color (New Gaps #1).
3. **`game.newRound()` from a script vs Game Flow's own timer is undesigned.** The session sets round length "10 min as a ceiling," ends rounds itself via `close()`, and "hides the stock countdown chip" — no documented Game Flow mode supports any of that, and nothing prevents Game Flow's own timer firing a second round end. The strain list admits awkwardness but presents the interplay as working; it's actually unspecified (New Gaps #3).
4. **`childrenOf` imported from `./runtime/game`** — §9 describes the helper but §2.2 claims the module surface is "complete," and `childrenOf` isn't in it. Either the import path is wrong or §2.2/§9 must add it to the surface.
5. **`game.playerData(f.p).get()` used without `?? {}`** in `round-results.ts` and the prompt-1 diff — a first-time finisher returns undefined and `d.points` crashes (contained by try/catch, but it's an error card, and W1 shows the correct `?? {}` shape). Also unspecified: `playerData(p)` for a player who left before round end (§2.2 flushes on leave).
6. **Script export shape inconsistent with the v1 contract as W1 renders it**: W2 uses named `export class`; W1 uses `export default class`. One of them doesn't match the parser.
7. **Leaderboard prefab "shows `game.state.seasonBoard`"** — a configurable source key for the flagship rewrite isn't documented (same key-contract gap; it is also the capability that would fix W1's board).
8. **Health & Respawn "Die below height"** — plausible but not in §6's rework scope; should be flagged as new prefab capability, not assumed.
9. Honesty check passes otherwise: the podium-avatar cut correctly cites no green profile ask + headless AvatarBase absence (CSS:179); finish validation is a generous height check per the `positionOf` contract; the clock design matches CSS §6's low-cardinality guidance.

---

### New gaps the walkthroughs reveal (missed by the plan review)

1. **`onRoundStart` has no assigned side.** The plan's core rule is "the fork is which callback you write," but this callback's color is undefined — and both real games need it on *both* sides (W1: green state reset; W2: blue camera). Needs either documented dual-side semantics (which strains the model) or split hooks (green `onRoundStart` + screens deriving round changes from `onStateChange`).
2. **No round counter.** Real recipes need to invalidate stale per-round data ("was this attempt from this round?"). The tuple offers only `seed` — usable but non-obvious. A monotonic `round.number` is a one-field API addition worth pinning in §2.2.
3. **Game Flow lacks a script-ended-round mode.** Any game whose round ends on a condition (score cap, accelerating clock, last-standing) fights the fixed timer: who owns the podium, the countdown UI, and double-fire prevention when a script calls `game.newRound()` mid-flow is undesigned. This should be explicit G5 rework scope.
4. **Aggregate/all-time boards, and kit-prefabs-read-creator-keys generally.** `playerData` can't be enumerated, so all-time boards only exist via incremental aggregation into `saved` (custom green code — W1 got this wrong, W2 hand-wrote 14 lines). Adjacent: Game Flow's podium and Leaderboard both need a documented "which state key do I read" contract. Either Points/Leaderboard grows a built-in saved top-N, or the §6 coverage claims should name this custom-code seam. Sub-gap: boards keyed by wallet have no green-side display-name resolution (client `getPlayer` only covers connected players) — offline players render as raw addresses.
5. **Multi-prefab layout.** One plan spanning several pools forces bypassing the per-pool rng streams and hand-rolling a PRNG — exactly the territory trap 10 fences. A multi-variant `layout(['a','b',…], planFn)` or a documented cross-pool derived-stream idiom belongs on the v1.1 list (W2 names it a wish; the plan itself doesn't carry it).
6. **Zone → damage routing.** The Trigger-Zone-hurts-you archetype (W1's moat) needs a specified wiring mechanism between Trigger Zone and Health & Respawn (zone-name channel config?) — currently in neither prefab's §6 scope.

### Plan-internal inconsistencies surfaced incidentally (worth fixing in the doc)

- §4 trap 4 lint copy still says "use **game.announce**" — stale after decision #2 struck the verb; should read "use game.send".
- §7 G6 row still uses the old hierarchy labels "Everyone sees / Only you see" — §3/§10 recast them to "Shared — one real copy / Your screen's copy" (both walkthroughs correctly use the new labels).
- §6 Collectible's "one per-player state flag" implementation contradicts its own "each player can pick this up once" promise across sleep (same issue as W1 correction #4).