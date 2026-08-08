# Building real games in Decentraland Studio — worked walkthroughs

> Flagtag and Tower of Madness rebuilt as Studio creator sessions on the `game` API, with an adversarial verification pass. The plan changes it produced are recorded in MULTIPLAYER-DX-PLAN.md §12.
>
> **Tower of Madness is no longer prose.** Its section is transcribed from a scene that exists: `packages/desktop/validate/fixtures/tower-of-madness/`, exercised on every run by `packages/desktop/src/tower-of-madness.test.ts`. `packages/desktop/validate/probe-tower.mjs` builds and boots the whole scene, but it is run by hand and is not in `npm run validate:probes`. Local Play *does* boot a Multiplayer Server — the editor installs `@dcl/sdk@auth-server` **and** `@dcl/sdk-commands@auth-server` into the scene (`packages/desktop/src/sdk-capability.ts:34`), and that toolchain's `start` spawns the server on every local run — so the probe's round, tower, finish and board claims are reachable without deploying anything; a run that never sees a round tuple reports them SKIP rather than PASS. The eight mismatches building it turned up are tabled at the end of its §2.
>
> **Flagtag has not been built.** Its code still predates the §12 fixes noted in the verification section at the end — read them together, and expect the same class of drift the tower's table records (state reads are `unknown`, `playerData` needs its type argument, an attached script may export exactly one class).

# Building Flagtag in Decentraland Studio

*A creator-session walkthrough of rebuilding `flagtag.dcl.eth` on the `game` runtime (MULTIPLAYER-DX-PLAN §2–§6), written to be honest about where v1 carries the game and where it strains.*

---

## 1. The game in one paragraph

Flag Tag is a free-for-all "keep away" in a medieval castle world: one flag, no teams. Find the flag, walk up and take it, and hold it — your score is cumulative hold-seconds. Walk close to the carrier and you steal it (3 s immunity after every take). Rounds last 5 minutes; at the boundary the top-3 get a podium and coins, and everything resets. Rubber-banding comes from hazards: lightning odds rise with the carrier's score until a strike forces a drop; the moat drowns you; coins scattered in the world fund a store of boomerangs and traps that stun the carrier into dropping. Today it is **26,988 lines of raw SDK source** (plus 3,251 lines of tests): 7,865 lines of hand-rolled server, ~80 message schemas, 20+ synced CRDT components, and a 900-line bespoke storage-reliability layer.

---

## 2. The session

### 2.1 New project

**Add a scene → Create a new scene → Starter: Blank** (*"An empty parcel — start from scratch"*). The picker offers two starters, Blank and **Example** (*"A clickable cube with a bit of SDK7 code"*), and neither says anything about a server, because there is nothing to opt into. The scene opens empty; zero runtime code exists until the first `game` import (the module generates into `src/scripts/runtime/game.ts` on first use). The first server-aware item dragged in raises **"Announcer needs the server SDK"** with one **Install and place** button — it runs `npm install @dcl/sdk@auth-server @dcl/sdk-commands@auth-server` in this scene, then places what it held back — that second package is what gives local **▶ Play** a Multiplayer Server. The creator drops in the castle GLB, the moat, the pedestal.

### 2.2 Place the kit (all names from plan §6)

| Gesture | Prefab | Inspector shows |
|---|---|---|
| Library → drag onto the courtyard | **Game Flow** | *"Lobby, countdown, rounds, winners — runs your game from start to end. Works with: Leaderboard, Announcer."* Round length **5:00**, lobby countdown **10 s**, podium for **top 3** of `game.state.leaderboard`. Chip (derived, never declared): green ● *Everyone sees it*. |
| Drag onto the keep entrance | **Door & Switch** | *"A door whose open/closed everyone agrees on."* Door model = portcullis.glb; **switch** is a dropdown of the scene's named entities plus *none* — name the wall lever, then pick it there. |
| Drag ×20 around the map | **Collectible** (the coins) | *"Each player can pick this up once — gives points."* Gives points: **1**. Chip: *Remembered per player*. |
| Drag once (invisible) | **Points** | *"Give and track points per player."* Keep between visits: **✓** — this is the wallet. |
| Drag once | **Health & Respawn** | *"Players can take damage and respawn. Works with: Game Flow, Trigger Area."* **respawn at** is one entity, not a set: name a marker in a castle corner and pick it from the dropdown. Four corners would need four placements, or a script that moves the marker. **max health 100** · **die below height 0** (off). |
| Drag, stretch over the moat | **Trigger Area** | Area name: **Moat** (the entity's Name *is* the area's name). Damage on enter: **100** — see correction #5 below, nothing routes an area's damage into Health & Respawn today. The area's volume is visible in Play. |
| Drag near the gate | **Announcer** | *"Shows a message on every player's screen — it fades, so lasting facts belong on a board. Works with: Game Flow."* Its `ai.md` teaches: the game says `game.send('announce', { text })` and every screen shows the toast. |
| Drag onto the keep wall | **Leaderboard** (the flagship, rewritten on `game`) | Reads `game.state.leaderboard`; second instance set to *All-time* backed by `game.playerData` hold totals. |
| Drag onto a rooftop | **Pickup** (the mushroom) | *"One item, first player to grab it wins it."* The canonical `game.spawn` — one contested item, gives points: **30**, respawns each round. |

Struck deliberately: **Teams** (FFA), **Waves** and **Level Slots** (no wave enemies here), **Save Point** (Points' "keep between visits" already covers the wallet), **Spawner** (nothing decorative to scatter).

### 2.3 The flag — three custom scripts

The flag is a **placed entity** (flag.glb), not a spawned one. The key design move, straight from the plan's mental model: *the carrier is a fact* (`game.state.flag`), *the flag on someone's back is what each screen draws*. Nothing about the flag's motion ever crosses the wire.

**Script 1 — `flag-rules.ts`**, attached to the flag entity. Right-click → **Add Script** (or **New script** on the flag's Script card — every entity has one). The template scaffolds the two-sentence model; the creator writes:

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
    game.onEnterArea('Moat', (p) => { if (game.state.flag?.carrier === p) this.drop('moat') })
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

Every idiom is a §2.3 recipe: identity comes from `(data, player)`, never the payload; the decision happens before anything slow; the payload's `flag: this.entity` claim is validated against state; `positionOf` is used for a **generous** 4 m check, not a precise one. `stealRadius` renders in the properties panel as a number field. The Script card's derived **runs-on line**:

> ● **on the server, for everyone:** start · round start · takeFlag · enter Moat · a player leaves

There is no blue half, and `drop()` is why there isn't: it reads `game.state.flag`, but the only things that call it are green callbacks, and the scan follows a green callback into the methods it calls. A read of `game.state` earns the blue *shows synced state* label only where no green callback reaches it.

**Script 2 — `flag-visual.ts`**, also on the flag entity. Its `base: Entity` param shows in the card as **base** — a dropdown listing every *named* entity in the scene plus *none*, with the hint *"This flag won't return anywhere until you pick a base."* Name the pedestal first: an entity with no Name is not in the list. Picking it stores the composite id, so renaming the pedestal later does not break the link.

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

> ● **on the server, for everyone:** lightningWarning · struck &nbsp;&nbsp; ● **on this player's screen:** synced state changes · clicks

A message name always reads green, even here, where both handlers are screen code: `game.onMessage` is the same call on both sides and the scan does not guess which one you meant. The card is a reading of your file, not a verdict on it.

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

This is the plan's canonical teaching example verbatim: *scores accumulate in `playerData`; the top ten are copied into `game.state.leaderboard` so every screen shows them.* The Leaderboard prefab and Game Flow's podium both read that key. Runs-on line: ● **on the server, for everyone:** round start · every 1s.

### 2.4 Two AI prompts

**Prompt 1**, from the flag's Script card: *"While someone is carrying the flag, roll lightning every second — no risk under 100 seconds of hold time, rising to almost certain near 300; give the carrier a 3-second warning, then the strike makes them drop the flag."*

The change comes back into `flag-rules.ts` — one field, one green block — and the Script Studio holds the whole file for review: *"The assistant changed this script. Review before it runs in the scene."* with **Accept all** and **Discard**. Review is per file, not per hunk, so read the runs-on line again after accepting — that is where the new `every 1s` shows up:

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

**Prompt 2**, on the score entity: *"When a round ends, post the winner's name and hold time to my Discord."* The change replaces `hold-score.ts`'s round-start line — note the reset happens **before** the await (the recipe discipline; flagtag's round-end race, hard part #4, is a shape the recipes simply don't produce):

```ts
// in the scene bundle, so treat it as public — see below
const WEBHOOK_URL = 'https://discord.com/api/webhooks/…'

    game.onRoundStart(async () => {
      const winner = (game.state.leaderboard ?? [])[0]
      this.round = {}
      game.setState({ leaderboard: [] })
      if (!winner) return
      await fetch(WEBHOOK_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: `${winner.player} won — ${winner.seconds}s on the flag` })
      })
    })
```

**The webhook has nowhere safe to live yet, and that is the whole strain.** There is no reader — no `game.secret()`, no env API of any kind — so the URL sits in the script as a constant, which means it ships in the scene bundle and anyone can read it. **Worlds → your world → Storage → Env keys** does store values write-only, and its own panel states the rule — *values can be set but never read back* — but until a green-side reader exists, a key set there is a key nothing can fetch. Treat a webhook posted this way as public, and rotate it from Discord when you publish.

### 2.5 Play, then publish

**▶ Play.** One avatar — yours. Click the flag: `[game] takeFlag from 0x9a…` in the logs' **Game** tab, the flag rides your back, the Leaderboard starts counting hold-seconds. Wade into the moat volume: drowned, respawned at a corner, the flag dropped where you stood. The **Game strip** reports the server — `◐ Waking…` on the first Play of a session, then `● Game running`, and messages sent while it wakes queue instead of failing.

**Two players is a published check, not an editor one.** Play runs a single avatar, so the steal (same `takeFlag` ask, the server decides grab vs. steal) and the late joiner (who reads the carrier, the countdown and the live board off the snapshot, with no `requestGameState` protocol to write) get verified after publishing, with somebody else in your world. **Publish** → *Publish to a world* → your Decentraland NAME. Your first visitor after a quiet spell wakes the game — the same `◐ Waking…` wait you saw in Play.

---

## 3. What just worked — prefabs alone, zero code

- **Rounds**: 5-minute loop, lobby countdown, frozen round-end, top-3 podium — **Game Flow** (the original's `roundManager.ts` 596 lines + cinematic 537).
- **Coins + wallet**: Collectible ×20 + Points with *keep between visits* (vs. `economy.ts` 1,005 lines of claim tokens, rate windows, deterministic ids).
- **Castle gate**: Door & Switch — shared open/closed, one state key.
- **Drowning**: Trigger Area "Moat" + Health & Respawn (vs. client-detected death + an untrusted `deathPenalty` ask flagged in flagtag's own KNOWN_BUGS).
- **Toasts, live scoreboard, all-time board**: Announcer + Leaderboard ×2 (vs. 3,111 lines of React-ECS UI plumbing plus leaderboard lifecycle guards).
- **The contested mushroom**: Pickup — first-grab-wins with an idempotency key the creator never sees.
- **Invisible but decisive**: late-join snapshot, cold-start queueing, server liveness ladder, per-player rate limits, payload caps, storage write-behind — all module-owned.

---

## 4. Where it strains — the honest list

1. **Proximity steal — the signature mechanic — is not v1.** The plan explicitly struck the PvP contact verb (decision log #3: *"no player-vs-player verb in v1"*; tag is off the coverage claims). What we shipped is **click-to-steal**: a deliberate click on the carried flag, server-validated with `positionOf` at a *generous* 4 m — honest per its 10 Hz/feet contract. An automatic 1.8 m steal *can* be hand-rolled (`game.every(0.25)` polling `positionOf` pairwise), but with each player's own screen deciding where that player is, at ~10 Hz and with no position history it produces disputed, laggy steals — the original needed 500 ms position buffers and lag-forgiveness windows the API deliberately doesn't expose. **Unlocks later**: a post-G5 `onPlayerNear` built on module-kept position history with baked-in slack — the same construction-over-configuration treatment `onEnterArea` got.
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

**Traps this creator never faced — each one a scar in flagtag's actual source:** the 10 s Storage hang-timeout ticker, write-sequence repair, and transactional rollback (`safeStorage.ts:1-40`); duplicate `PlayerIdentityData` corpse entities cross-wiring positions (their signature platform bug); the hold-time shadow-total map guarding entity-slot recycling; *"removeEntity preserves the old NetworkEntity — 'id already in use'"* on flag re-sync; CRDT saturation from per-tick fall writes (~60/s) and the whole analytic-fall redesign; sync-id pools widened to outlast tombstone windows; round-end await-gap score resurrection and max-not-sum phantom-entity dodges; the 1 Hz heartbeat for CRDT-stall self-correction (`serverLife` is the module's job); `isServer()` false at load, sealed-engine registration, the Int64/BigInt coercion crash; payload identity spoofing (`player` is the connection's wallet, structurally); and Discord name sanitization. The creator's total exposure to all of the above: two chips on a Script card.

**Bottom line**: roughly 70% of Flag Tag's *player-visible* game — flag, steal-with-immunity, hold-time scoring, rounds, podium, lightning, moat, coins, boards, Discord — assembles in one sitting from the §6 kit plus ~135 lines. What v1 honestly cannot reproduce is the *feel* of the other 30%: brush-past steals, dodgeable boomerangs, a chasing ghost — precisely the three items the G1 spikes and the post-G5 PvP-verb decision exist to price.
---

# Building Tower of Madness in Decentraland Studio

*The complete creator session on the `game` API — and, since 2026-08-08, a scene that actually exists. Everything below is transcribed from code that compiles and runs: the scripts live in `packages/desktop/validate/fixtures/tower-of-madness/scripts/`, the loop is exercised by `packages/desktop/src/tower-of-madness.test.ts`, and `packages/desktop/validate/probe-tower.mjs` builds and boots the whole scene by hand — it is not wired into `validate:probes` because it needs a built app and takes minutes, not because it needs a deployed world: local Play boots a Multiplayer Server for any scene whose `node_modules` carry the auth-server toolchain, which is the toolchain the editor installs. Where this section used to teach an API that had drifted, the "What building it changed" note at the end of §2 says what moved and which side was wrong.*

---

## 1. The game in one paragraph

Tower of Madness is a multiplayer vertical-platforming race: every round, a random tower — three to eight obstacle-course chunks drawn from ten models — stacks up in the middle of the world, and everyone climbs it against one shared clock. Walk through the start gate at the base to begin an attempt, reach the summit to log a time; fall past the death plane and you walk back and try again. The "madness" is the pressure mechanic: every finisher accelerates the round clock *for everyone* — one finisher makes it drain 2×, two make it 3× — so each summit is bad news for everyone still climbing. Rounds end with a teleport home, a podium, points (100/90/80 for the top three, 30 for other finishers), and persistent best-time and season leaderboards.

---

## 2. The session, step by step

### Step 0 — New project

**Add a scene → Create a new scene → Starter: Blank**. The picker asks only for a starter, a name and a location — there is no parcel count in it, so the scene opens as a single parcel and you grow it afterwards in **Scene Settings → Parcels**, clicking the grid out to the 3×3 block every coordinate below assumes (`SceneSettingsModal.tsx:121-129`). The picker offers exactly two starters — **Blank** (*"An empty parcel — start from scratch"*) and **Example** (*"A clickable cube with a bit of SDK7 code"*) — and there is no multiplayer starter, because there is nothing to choose: a blank scene ships zero runtime code, no flag to set and no `main()` to branch, and `src/scripts/runtime/game.ts` and its 27 siblings appear the moment the first script says `import { game } from './runtime/game'`.

The one thing that does interrupt: dragging the first kit item in raises **"Game Flow needs the server SDK"** with a single **Install and place** button. It runs `npm install @dcl/sdk@auth-server @dcl/sdk-commands@auth-server` in this scene (`packages/desktop/src/sdk-capability.ts:34`), takes a minute or two, and places the item it held back when it finishes. That is the whole setup step — and the second package is the one that makes **▶ Play** a real game: the auth-server build of `sdk-commands` spawns a Multiplayer Server on every `start`, with no flag to suppress it, so the copy that runs your green code exists locally the same way it will in your world.

### Step 1 — The chunk library

Drag the ten middle-chunk GLBs plus `chunk-end.glb` into the scene, right-click each → **Create prefab…**. The dialog asks two things: a **name** (`Chunk 01` … `Chunk 10`, `Chunk End`) and **Appears — From the start / When spawned**. Pick **When spawned** for all eleven: a chunk exists only while a round is running, and the tower is built per round, not authored.

One authoring decision replaces a networking hack: every chunk is modelled entry-south / exit-north, so the raw scene's alternating-180° stacking dance isn't needed. There is no copy limit to set: the dialog has two fields and neither is one. A prefab a creator never annotates gets the default pool of 64 alive copies, and nothing in the editor exposes that number — so the same kind coming up on several floors of one tower needs no setting at all.

### Step 2 — Place the base (all gestures, no code)

| Placed | Gesture / inspector state |
|---|---|
| **Game Flow** (kit) | **round seconds 180** *(a ceiling — see below)* · **countdown seconds 3** · **intermission seconds 10** · **min players 1** · **ends when — your own script** · **board key** `leaderboard`. Labels are derived from the param names and read lower-cased; that is the shipped style, not a typo. |
| **Trigger Area** (kit) | Its **Name** is the area's name — type **Start**. A 6×3×6 box at the tower base, on the plinth. Visible in Play. |
| **Health & Respawn** (kit) | **respawn at** — a dropdown of the scene's *named* entities plus *none*; name the pad **BaseSpawn** first, then pick it (an unnamed entity never appears in the list). **die below height 1** — the plinth's floor is the death plane. |
| **Leaderboard** (kit) ×2 | Board 1: **title** *Best Times*, **board key** `leaderboard`, **sort — lowest wins**. Board 2: **title** *Season Points*, **board key** `seasonBoard`, **sort — highest wins**. |
| **Announcer** (kit) | Stock. Green code anywhere calls `game.send('announce', { text })` and every screen shows the toast. |
| **Tower** anchor, **BaseSpawn**, **Home**, plinth | Plain entities. **ClockSign** with two text faces dragged under it — a collection by structure, not by param. |

Hovering **Game Flow** in the library reads *"Game Flow — Lobby, countdown, rounds, winners — runs your game from start to end. Works with: Leaderboard, Announcer. · a copy is added to this scene"* (`PrefabsPanel.tsx:431-440`, from the prefab's `data.json` description). Once it is placed, that sentence is behind you: selecting the entity opens its **Script** card, which shows the script row and its params — the values in the table above. That is the whole `server.ts` phase machine, placed.

**Ends when.** This game's clock accelerates, so the round has to end on a condition, not a timer. Game Flow's **ends when** dropdown says so in words — *this clock* or *your own script* — and picking *your own script* makes the round length a ceiling that keeps a forgotten `game.newRound()` from wedging the loop, the sign stops showing a countdown it does not own, and *every* round start — Game Flow's own and the script's — still runs through Game Flow's single `game.onRoundStart` hook. That is what stops the two from both ending one round, and the podium is left to whichever script closed the round, so no second winners line goes out beside it.

**Round 1 is the lobby.** Every game boots into round 1, and Game Flow keeps it as the lobby: it ignores `onRoundStart` while `round.number <= 1`, so the flow fact stays on phase `lobby` and the first *played* round is round 2. Nothing closes a round in the lobby, so a finish taken there would be recorded and never paid — `madness-race.ts` refuses it outright with *"the round has not started yet — wait for the clock"* rather than banking a run that goes nowhere. Any script that hands out points is in the same position: gate on `game.state.flow`'s phase, not on the round existing.

**Keep the ceiling above your own round.** The ceiling is the safety net, never the clock: `round-results.ts` below runs a **60 s** round plus a **5 s** break — the values on its card *and* the defaults in its code — well under the 180 s ceiling, so the script always ends the round first. **The rule: your script's round plus its break must stay under Game Flow's round seconds.** If the ceiling ever does fire, Game Flow starts the next round the way your script would — and prints one line, `[game] Game Flow: The round hit its time ceiling — call game.newRound() from your script, or raise the ceiling.` Set a ceiling *below* your own round length and every round ends there instead: nobody is paid, the boards stay empty, and that line is the only thing that tells you why.

### Step 3 — `tower-builder.ts` (custom script, attached to the **Tower** anchor)

Right-click **Tower** → **Add Script**: it selects the entity, opens its **Script** card and puts the cursor on **New script** — clicking that scaffolds the file and attaches it. Every entity carries that card, so the same file is one click away whenever the entity is selected. The scaffold auto-names the file (`my-script.ts`, then `my-script-2.ts`…), so each listing below opens with the path it should end up at — rename it there and then with the row's **⋯ → Rename script**, which accepts the whole path. Eleven prefab pools have to agree on one stack, and `game.layout` hands each pool its own rng stream — they *must* differ, or two layouts in one round would share draws. So the plan is a hand-written pure function of `round.seed` and the streams go unused. Fixed draw count, sliced after: the number of floors is itself a draw, so drawing the maximum every round keeps the draw order independent of the count.

The plan lives in its own file, because an attached script must export **exactly one** class — see the note at the end of this step.

**How you make a file that runs on no entity.** This session needs five of them (`pure/tower.ts`, `pure/clock.ts`, `pure/boards.ts`, `pure/names.ts`, `race-ui.ts`), and every gesture that makes a script *attaches* it: **Add Script** and **New script** both scaffold `src/scripts/<name>.ts` and add a row to the selected entity. There is no "new file" button — the Script Studio's file rail opens files, it does not create them. Three ways to end up with an unattached file, all real:

- **Make one, move it, then detach it.** **New script** on any entity → ⋯ → **Rename script**, and type a path: `pure/tower`. The name field takes one, and the file lands at `src/scripts/pure/tower.ts` with the folder created for you (`script-view.tsx:287-300`, `template.ts:36-40`). Then ⋯ → **Remove script**: that drops the row from the entity and leaves the file where it is — only a rename deletes a file. It stays listed in the Studio's file rail, and `import { towerFor } from './pure/tower'` finds it.
- **Ask the assistant to write it.** It writes files directly, and a file it writes is attached to nothing until you attach it.
- **Create it in the project folder.** `src/scripts/` is an ordinary folder on disk; your own editor works.

Either way the rule is the same: a file under `src/scripts/` runs as a script only where some entity's Script card names it. Unnamed, it is just a module the scripts import — which is exactly what these five are.

```ts
// src/scripts/pure/tower.ts
export const CHUNK_KINDS = 10
export const CHUNK_HEIGHT = 6
export const BASE_X = 24
export const BASE_Z = 24
export const BASE_Y = 2
export const MIN_FLOORS = 3
export const MAX_FLOORS = 8

export function towerFor(seed: number): number[] {
  let s = seed >>> 0
  const next = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const floors = MIN_FLOORS + Math.floor(next() * (MAX_FLOORS - MIN_FLOORS + 1))
  const picks: number[] = []
  for (let i = 0; i < MAX_FLOORS; i++) picks.push(Math.floor(next() * CHUNK_KINDS))
  return picks.slice(0, floors)
}

export function floorY(floor: number): number { return BASE_Y + CHUNK_HEIGHT * floor }
export function topFor(seed: number): number { return floorY(towerFor(seed).length) }
```

```ts
// src/scripts/tower-builder.ts
import type { Entity } from '@dcl/sdk/ecs'
import { game } from './runtime/game'
import { BASE_X, BASE_Z, floorY, topFor, towerFor } from './pure/tower'

/** A prefab picked in the inspector. The annotation is what makes it a picker. */
type PrefabRef = string

export class TowerBuilder {
  constructor(
    public src: string,
    public entity: Entity,
    /** The middle chunks. Pick one prefab per kind; the seed picks the order. */
    public chunks: PrefabRef[] = [],
    /** The chunk that caps the tower — where a climb ends. */
    public endChunk: PrefabRef = ''
  ) {}

  start(): void {
    const kinds = this.chunks.filter((prefab) => prefab !== '')
    if (kinds.length === 0) {
      console.log('[towerBuilder] no chunks picked yet — the tower has nothing to build from.')
      return
    }
    kinds.forEach((prefab, kind) => {
      game.layout(prefab, (_rng, round) =>
        towerFor(round.seed).flatMap((pick, floor) =>
          pick % kinds.length === kind ? [{ x: BASE_X, y: floorY(floor), z: BASE_Z }] : []
        )
      )
    })
    if (this.endChunk !== '') {
      game.layout(this.endChunk, (_rng, round) => [{ x: BASE_X, y: topFor(round.seed), z: BASE_Z }])
    }
  }
}
```

The chunks are **params, not string names**: `game.layout` takes the prefab a creator picked, and `chunks: PrefabRef[]` renders in the card as a multi-prefab picker. Runs-on line: `● on this player's screen: layouts` — the card names the prefab when the call spells one out, and falls back to the plain word when it comes from a param, as it does here. The seed is drawn by the game and published at round start, so nobody precomputes next round's tower; late joiners rebuild it from the round tuple with zero traffic.

**Why the plan is in `pure/tower.ts`.** The SDK's script runner constructs `Object.values(module).find(exp => typeof exp === 'function')` — the **first** function-valued export, not the class it can see. A `export function towerFor` sitting above `export class TowerBuilder` in the same file makes the runner construct `towerFor` instead, silently, with the scene still building and nothing in the console. `packages/ui/src/prefabs/tower-fixture.test.ts` holds every attached script in this scene to one exported class.

**Two more unattached files, before Step 4 needs them.** `race-ui.ts` is what this player sees about their own run — Step 4 imports `showVerdict` and the `Verdict` type from it, Step 5 imports `showPodium` — and it in turn imports `shortName` from `pure/names.ts`. Neither is attached to an entity: make them the same way as `pure/tower.ts` above.

```ts
// src/scripts/race-ui.ts
// What this player sees about their own run. Only this screen ever runs it, so
// nothing here decides anything — it reads what the game already decided.
//
// Deliberately plain lines: the toast every player sees is the Announcer item's
// job, and the podium's dancing avatars are the one thing of the original this
// rebuild cannot reproduce (no green profile ask exists).
import { shortName } from './pure/names'
import type { Run } from './pure/boards'

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
  console.log(`[you] not counted — ${verdict.why ?? 'the game refused it'}`)
}

export function showPodium(top: Run[]): void {
  if (top.length === 0) {
    console.log('[you] round over — nobody made it up.')
    return
  }
  const line = top.map((run, place) => `${place + 1}. ${shortName(run.p)} ${run.time.toFixed(2)}s`).join('   ')
  console.log(`[you] round over — ${line}`)
}
```

```ts
// src/scripts/pure/names.ts
// Wallets are long. A board keyed by wallet has no display name to show — the
// game has no profile ask, and the client's own lookup only covers players who
// are connected — so both boards render the tail.
export function shortName(player: string): string {
  return player.startsWith('0x') && player.length > 10 ? `${player.slice(0, 6)}…${player.slice(-4)}` : player
}
```

`Verdict` is the shape `finish()` returns in Step 4 and the shape the message resolves to on the screen that sent it — one interface, both halves of the file, which is why it lives here and not in either. The `Run` type `race-ui.ts` imports lives in `pure/boards.ts`, which Step 5 lists: typing along in order, that one import stays unresolved until you create that file.

### Step 4 — `madness-race.ts` (also on the **Tower** anchor)

Attempts, finish validation, and the clock acceleration. The two halves of this file are the whole model: `update()` runs on **this player's screen** — only it can see where its own avatar is, so only it can notice a summit — and all it does is ask. `game.onMessage` runs **on the server, for everyone**: it re-checks the height against the game's own view of that player's feet, times the run from its own start stamp, and writes the result once.

```ts
import { Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { game, type Player } from './runtime/game'
import { asClock, remainingNow } from './pure/clock'
import { asRuns } from './pure/boards'
import { BASE_Y, topFor } from './pure/tower'
import { showVerdict, type Verdict } from './race-ui'

// one const per line, and not for style: the card reads names off the text, and
// only the first declaration on a `const a = 'x', b = 'y'` line is one it finds
const FINISH = 'finish'
const ANNOUNCE = 'announce'
const START_ZONE = 'Start'
const CLOCK_KEY = 'clock'
const FINISHERS_KEY = 'finishers'
const FLOW_KEY = 'flow'
const SUMMIT_SLACK_M = 3
const ASK_WITHIN_M = 1
const REARM_ABOVE_BASE_M = 4

/** True while Game Flow says a round is actually being played. */
function inRound(): boolean {
  const fact = game.state[FLOW_KEY]
  if (typeof fact !== 'object' || fact === null) return false
  return (fact as Record<string, unknown>).phase === 'round'
}

export class MadnessRace {
  private attempt: Record<Player, { atMs: number; round: number }> = {}   // in the game only
  private asked = false                                                   // this screen only

  constructor(public src: string, public entity: Entity) {}

  start(): void {
    game.onEnterArea(START_ZONE, (player) => {
      this.attempt[player] = { atMs: game.now(), round: game.round.number }
    })
    game.onMessage(FINISH, (_data: unknown, player: Player) => this.finish(player))
  }

  update(): void {
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
    const feet = game.positionOf(player)   // feet, ~10×/second — generous checks only
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

Runs-on line: `● on the server, for everyone: enter Start · finish   ● on this player's screen: shows synced state`. The green half is the two callbacks by name — `START_ZONE` and `FINISH` are single-declaration consts, so the card prints *enter Start* and *finish* instead of falling back to *enter an area* and *a message* (`runs-on.ts:36-37`). The blue half is `update()`: it registers no callback the card can name, but it reads `game.round`, and a read of the game's own facts outside every green callback is what the blue label means.

Three things to notice. The finish *time* is computed entirely in the game from the game's own start stamp — the raw scene's client `time` field was ignored for the same reason; here that discipline is the only expressible shape. The per-player verdict rides the ask's own resolve: no broadcast-with-address-filter, no hand-rolled 4-second VALIDATING timeout. And `game.state` hands back `unknown`, so every read of a shared fact goes through a small reader (`asClock`, `asRuns`) — the fact crossed the wire and any script in the scene can write the key, so a defensive read is not ceremony, it is the shape.

```ts
// src/scripts/pure/clock.ts — three numbers every screen integrates locally
export interface Clock { at: number; left: number; speed: number }

export function asClock(value: unknown): Clock | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const num = (key: keyof Clock): number | null => {
    const raw = record[key]
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  }
  const at = num('at'), left = num('left'), speed = num('speed')
  if (at === null || left === null || speed === null) return null
  return { at, left: Math.max(0, left), speed: Math.max(1, speed) }
}

export function remainingNow(clock: Clock, nowMs: number): number {
  return Math.max(0, Math.min(clock.left, clock.left - ((nowMs - clock.at) / 1000) * clock.speed))
}

/** What the sign reads: m:ss, plus the multiplier once anybody has finished. */
export function clockText(clock: Clock, nowMs: number): string {
  const left = Math.floor(remainingNow(clock, nowMs))
  const rest = left % 60
  const face = `${Math.floor(left / 60)}:${rest < 10 ? '0' : ''}${rest}`
  return clock.speed > 1 ? `${face}  x${clock.speed}` : face
}
```

`clockText` is here and not in `clock-board.ts` for the same reason the rest is: it is a pure function of the three numbers, so it is testable on its own and Step 6's attached script keeps its single exported class.

That is the raw scene's exact clock design — `{lastSpeedChangeTime, remainingAtSpeedChange, speedMultiplier}`, integrated locally — minus the 271-line NTP module, because `game.now()` exists.

### Step 5 — `round-results.ts` (attached to Game Flow's entity) + `pure/boards.ts` (attached to nothing)

The clock ends rounds, points accumulate privately, the top ten go public.

Card values for this scene: **round seconds 60** · **break seconds 5** · **home** — the dropdown of named entities; pick the **Home** pad by the gate (name it first, or it is not in the list). The card's values win over the code's, and the script carries the same 60 and 5 as its defaults on purpose.

**The rule: `round seconds` + `break seconds` must stay under Game Flow's `round seconds`.** Ship a script whose clock outruns the ceiling and Game Flow ends every round first, `close()` never runs, nobody is paid and both boards stay empty — the silent failure tabled as #9 below. 60 + 5 against a 180 s ceiling has room to spare.

```ts
import { Transform, type Entity } from '@dcl/sdk/ecs'
import { movePlayerTo } from '~system/RestrictedActions'
import { game } from './runtime/game'
import { asClock, remainingNow, type Clock } from './pure/clock'
import { asRuns, asScores, bestTimes, season } from './pure/boards'
import { showPodium } from './race-ui'

const PODIUM = [100, 90, 80]
const FINISH_POINTS = 30

interface PlayerRecord extends Record<string, unknown> { points: number; best: number }

/** True while Game Flow says a round is actually being played. */
function inRound(): boolean {
  const fact = game.state.flow
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
    game.onStart(() => {
      game.setState({
        clock: this.freshClock(),
        finishers: [],
        leaderboard: asRuns(game.saved.get('bestTimes')),
        seasonBoard: asScores(game.saved.get('season'))
      })
    })
    // every round start lands here, whether Game Flow began it or close() did
    game.onRoundStart(() => {
      game.setState({ clock: this.freshClock(), finishers: [] })
    })
    game.every(1, () => {
      if (!inRound()) return
      const clock = asClock(game.state.clock)
      if (clock === null || remainingNow(clock, game.now()) > 0) return
      this.close()
    })
    game.onMessage('roundOver', (data: unknown) => this.landed(data))
  }

  private close(): void {
    const finishers = asRuns(game.state.finishers)
    for (const [place, run] of finishers.entries()) {
      const record = game.playerData<PlayerRecord>(run.p).get()
      game.playerData<PlayerRecord>(run.p).set({
        points: (record.points ?? 0) + (PODIUM[place] ?? FINISH_POINTS),
        best: record.best === undefined ? run.time : Math.min(record.best, run.time)
      })
    }
    const times = bestTimes(asRuns(game.saved.get('bestTimes')), finishers)
    const points = season(asScores(game.saved.get('season')), finishers, PODIUM, FINISH_POINTS)
    game.saved.set('bestTimes', times)
    game.saved.set('season', points)
    game.setState({ leaderboard: times, seasonBoard: points })
    void game.send('roundOver', { top: finishers.slice(0, PODIUM.length) })
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

```ts
// src/scripts/pure/boards.ts
export interface Run { p: string; time: number }
export interface Score { p: string; pts: number }

const TOP = 10

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

export function asScores(value: unknown): Score[] {
  if (!Array.isArray(value)) return []
  const out: Score[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.p !== 'string' || record.p === '') continue
    if (typeof record.pts !== 'number' || !Number.isFinite(record.pts)) continue
    out.push({ p: record.p, pts: record.pts })
  }
  return out
}

export function bestTimes(board: Run[], runs: Run[], n = TOP): Run[] {
  const best = new Map(board.map((run) => [run.p, run.time]))
  for (const run of runs) {
    const seen = best.get(run.p)
    best.set(run.p, seen === undefined ? run.time : Math.min(seen, run.time))
  }
  return [...best].map(([p, time]) => ({ p, time })).sort((a, b) => a.time - b.time).slice(0, n)
}

export function season(board: Score[], runs: Run[], podium: number[], base: number, n = TOP): Score[] {
  const total = new Map(board.map((score) => [score.p, score.pts]))
  runs.forEach((run, place) => total.set(run.p, (total.get(run.p) ?? 0) + (podium[place] ?? base)))
  return [...total].map(([p, pts]) => ({ p, pts })).sort((a, b) => b.pts - a.pts).slice(0, n)
}
```

`asRuns` and `asScores` are the same shape as `asClock` — every read of a `game.state` key goes through one, because the key crossed the wire and any script in the scene can write it. `p` and `time`/`pts` are field names the Leaderboard prefab's reader already knows, so pointing a board at `leaderboard` or `seasonBoard` is all the wiring there is.

Runs-on line: `● on the server, for everyone: start · round start · every 1s · roundOver` — and no blue half. `inRound()` does read `game.state`, but the only thing that calls it is the `game.every(1, …)` callback, and the card follows a green callback into the functions it calls, so the read counts as green too. A script earns the blue *shows synced state* label only where a read of `game.state`, `game.now()` or `game.round` sits outside every green callback — as `update()`'s does in `madness-race.ts`, and `clock-board.ts`'s does in Step 6. `roundOver` sits on the green half because a message name can land on either side and the card does not guess. `roundOver` is an announcement with a screen effect: the game tells, every screen obeys `movePlayerTo`, because moving an avatar is the one thing only that player's own screen can do. Per-name direction holds — `finish` is asked by players, `roundOver` and `announce` are told by the game.

**The per-player record is typed at the call site.** `game.playerData<PlayerRecord>(p).get()` returns `Partial<PlayerRecord>`; without the type argument the parameter defaults to `Record<string, unknown>` (`runtime-modules/game.ts:800-803`), so `record.points` is `unknown` and the arithmetic does not compile. `get()` on a wallet the game has never seen returns `{}`, not `undefined`, so no `?? {}` is needed — only `?? 0` on the field.

### Step 6 — `clock-board.ts` (attached to ClockSign; faces are its children)

```ts
import { TextShape, type Entity } from '@dcl/sdk/ecs'
import { childrenOf, game } from './runtime/game'
import { asClock, clockText } from './pure/clock'

const PAINT_S = 0.2

export class ClockBoard {
  private accum = 0
  private painted = ''

  constructor(public src: string, public entity: Entity) {}

  update(dt: number): void {
    this.accum += dt
    if (this.accum < PAINT_S) return
    this.accum = 0
    const clock = asClock(game.state.clock)
    if (clock === null) return
    const text = clockText(clock, game.now())
    if (text === this.painted) return
    this.painted = text
    for (const face of childrenOf(this.entity)) {
      const shape = TextShape.getMutableOrNull(face)
      if (shape !== null) shape.text = text
    }
  }
}
```

Runs-on line: `● on this player's screen: shows synced state` — this file registers no callback at all, so the only thing the card can say about it is that it reads `game.state` and `game.now()` on the screen, which is exactly what it does. Every screen integrates the remaining time locally from three synced numbers. Add a face by dragging another text entity under ClockSign — nothing to set and nothing to confirm: the card has no param for the faces and no readout of them, because `childrenOf` reads the hierarchy at run time. The hierarchy panel is where you check you dragged it to the right parent. Two things a per-frame version gets wrong and this one doesn't: it repaints at 5 Hz and only when the text actually changed (a `TextShape` write is a component write), and it reads `getMutableOrNull`, because a child without a `TextShape` is an ordinary thing for a creator to drag under a sign.

### Step 7 — Two AI prompts

**Prompt 1** (round-results.ts open): *"If nobody finishes a round, give 5,4,3,2,1 points to the five highest climbers instead."* The Script Studio holds the changed file behind one review bar — *"The assistant changed this script. Review before it runs in the scene."*, **Accept all** or **Discard**, whole file either way. Expected change:

```diff
 export class RoundResults {
+  private high: Record<string, number> = {}   // in the game only
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
     const finishers = asRuns(game.state.finishers)
+    if (finishers.length === 0) {
+      Object.entries(this.high).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([p], i) => {
+        const record = game.playerData<PlayerRecord>(p).get()
+        game.playerData<PlayerRecord>(p).set({ points: (record.points ?? 0) + (5 - i) })
+      })
+    }
+    for (const p of Object.keys(this.high)) this.high[p] = 0
```

**Prompt 2** (madness-race.ts open): *"Watch for players who gain height impossibly fast — more than 12 meters per second. First time is a warning; after that their attempts don't count."* Expected change: a green `game.every(0.5)` sampler over `game.positionOf`, a `strikes` record, a warning via `game.send('warned', {…}, { to: p })`, and one guard line at the top of `finish()` — `if ((this.strikes[player] ?? 0) > 1) return { ok: false, why: 'flagged' }`. This is the raw scene's teleport-strike heuristic in ~15 lines; `positionOf`'s JSDoc ("generous checks only") is the contract that scene had to discover empirically.

### Step 8 — The fly-up camera

Ported nearly verbatim from `cinematicCamera.ts` as blue code — `VirtualCamera`, `MainCamera`, keyframes, the hand-rolled lookAt. The only part Studio replaces is the trigger plumbing, and it is **not** `game.onRoundStart`: that hook is green, it runs in the game, and a screen never sees it. A screen notices a new round the way it notices any other shared fact:

```ts
game.onStateChange((changed) => {
  if (changed.round === undefined) return
  flyUp(topFor(game.round.seed))
})
```

~310 lines survive untouched (see §4).

### Step 9 — Play

- **▶ Play**: climb, finish, watch the clock face go ×2. The **Game strip** in the bottom-left of the viewport reports the server for you — `◐ Waking… 12s` on the first Play of a session, then `● Game running`; the first `finish` queues behind the wake and flushes when it lands.
- Stand on the plinth and a chip reads **You're inside: Start**, tagged *editor only* — an editor aid, so you can see the gate you named without guessing.
- Open the logs (the terminal button in the topbar) and read the **Game** tab: `[game] finish accepted — 41.20s, the clock now drains x2` from the server next to `[you] summit! 41.20s` from your own screen. The **Build** tab is the build; the doubled-log mystery is pre-answered by the tags.
- Play runs **one avatar** — yours. The two-climber pressure (a second finisher taking the clock to ×3) and the late-join rebuild need a second player, so they get checked after Step 10, in the published world with somebody else in it. Neither needs code: the clock is arithmetic on three synced numbers and the tower rebuilds from the round tuple.

### Step 10 — Publish

**Publish** in the topbar → *Publish to a world* → your Decentraland NAME. Nothing here needs a key, which is just as well: **Worlds → your world → Storage → Env keys** stores values write-only, but no runtime API reads one back yet, so a scene that needs a webhook or an API token has nowhere safe to keep it (Flagtag §2.4 hits this).

Then drop the test-run data, which lives on the server and survives publishing: **Worlds → your world → Storage**. **Data** holds a single row, `game.saved` — everything the game saved (`bestTimes`, `season`) rides inside that one value, so you delete the row or use **Delete all data** (it asks twice); there is no per-key row to remove. **Players** holds the per-wallet points and best times — **Delete every player's data** clears those. Your first visitor after a quiet spell wakes the server, the same `◐ Waking…` wait you saw in Play.

### What building it changed

Every line above used to be prose. Building it turned up eight mismatches — six the walkthrough's fault, one the module's, one the scene's own — and the devexp review that followed turned up a ninth.

| # | What broke | Which side was wrong |
|---|---|---|
| 1 | `game.layout('chunk-01', …)` — a folder name is not a prefab. `layout` takes what a creator picked; the module's own error already says *"Pass one from Spawnables"*. | **the doc.** Now `chunks: PrefabRef[]` params. |
| 2 | `game.state.clock` is `unknown`. `remainingNow(game.state.clock, …)` does not compile, and never could. | **the doc.** Now `asClock` / `asRuns` / `asScores` readers, the same shape the kit's own `asFlowFact` uses. |
| 3 | `game.playerData(p).get()` hands back `Record<string, unknown>`; `(d.points ?? 0) + n` does not compile. | **the doc.** Now `game.playerData<PlayerRecord>(p)`. The old `?? {}` correction is stale — `get()` returns `{}` for a first-time player. |
| 4 | `towerFor`/`topFor` exported above `class TowerBuilder`, `remainingNow` above `class MadnessRace`. The SDK runner constructs the **first** function-valued export — the scene would have run `towerFor` as its script, silently. | **the doc.** Shared helpers moved to `pure/`; a test holds every attached script to one class. |
| 5 | "Round length 10 min as a ceiling; hide the stock countdown" was undesigned. | **the doc** — the kit closed the gap. Game Flow ships `endsWhen: 'script'` and routes *every* round start through one hook. |
| 6 | `game.onRoundStart` used blue-side for the camera. It is green: it runs in the game, and a screen never sees it. | **the doc.** Screens derive the round change from `game.onStateChange`. |
| 7 | After a successful run, a second `finish` answered *"start again from the gate"* instead of *"already finished this round"* — a run deletes its own attempt, so the guards were in the wrong order. | **the scene.** Reordered. |
| 8 | With Game Flow **and** a script both registering `game.onRoundStart`, the second hook got *"Only the game can change game.state"* thrown at it, forever. `newRound()` runs the hooks in a microtask outside the caller's green span — two spans overlap by design — and the guard was a boolean the outer span's `finally` cleared mid-flight. | **the module.** `pure/gameCore.ts` now counts green spans instead of flagging one. Regression leg in `game-harness.test.ts`. |
| 9 | With **ends when — your own script**, the round ceiling still ended the round down the timer path — so `close()` never ran: no points, empty boards, nobody teleported home, and nothing printed. Set the ceiling under your own round length and the game silently stopped paying out. | **the item.** Game Flow now goes out the same door a script goes out — `game.newRound()` — and prints one `[game]` line naming the fix. Its own podium is left to the script that closed the round, which is where the winners actually are. Leg in `packages/desktop/src/prefab-game-kit.test.ts`. |

Two more things the walkthrough claimed that the code now settles rather than assumes: `game.round.number` exists (rounds are numbered, and per-round validity keys on it), and `childrenOf` really is exported from `./runtime/game`.

---

## 3. What just worked

- **The round loop cost zero lines.** `server.ts` (338 lines: phase machine, boot-delay-by-dt-accumulation because "setTimeout not available in sandbox", height sweeps) is the Game Flow prefab plus one `game.every(1)` check. Lobby, intermission, countdown, late-join fast-forward: placed, not programmed.
- **The seeded tower is the layout showcase.** The raw scene's tower is its heaviest networking artifact: a 9-entity pre-created synced pool, full component sync per round, plus two documented collider hacks plus a TriggerEnd re-parented to world space because parents don't sync. Here the tower is **derived, not synced**: eleven `game.layout` pools re-run a pure plan from the round seed on every screen and every late joiner, zero wire traffic, and the collider-reload hygiene lives inside the pool runtime. The random-per-round hazard course — the heart of the game — became the *cheapest* part of the scene.
- **The accelerating clock without NTP.** Three state keys, a four-line `remainingNow`, and `game.now()`.
- **Leaderboards are prefab + idiom.** Per-player bests in `playerData`, boards in `saved`, top ten copied to `game.state`, two Leaderboard prefabs pointed at two keys. The raw scene's Storage-JSON maps, string-key change-detection dedupe, weekly persistence dance, and 1,337 lines of board rendering collapse into 20 pure lines plus placements.
- **Every per-player exchange got honest delivery.** The finish verdict is the ask's return value; warnings are `{to: player}`. The client-side 4 s validation timeout is the rpc layer's own timeout.
- **`onEnterArea` is the whole start gate.** The raw scene runs hand-rolled point-in-AABB checks every frame plus server-side height re-validation; here the detect→ask→verify dance is the only shape the API can express.

---

## 4. Where it strains

- **The podium is the biggest visible cut.** The raw scene's crowning flourish — three dancing avatar clones wearing the winners' real wearables — leans on server-side `getPlayer()` appearance scraping, a 1 s insurance cache, an HTTP profile fallback, and emote replay via timestamp bumps. v1 `game` has no profile ask, and the headless target has no AvatarBase at all. This session ships names and times, and offline players render as a shortened wallet.
- **The camera gains nothing from `game.*` — by design.** It's client-local, so it's *allowed*, but ~310 of the session's hand-written lines are the ported cinematic camera.
- **Moving hazards: paths and clock-keyed motion only.** Anything that *chases* is out in v1: layout callbacks can't see players by construction, and chasing enemies are unreconstructible for late joiners.
- **`layout` is single-prefab; the tower is ten kinds.** The eleven pools agree only because the plan is a hand-written pure function of `round.seed` — the API's per-pool rng streams were deliberately bypassed. It works and it's safe, but the API didn't help; a multi-variant layout is a v1.1 wish. This is the one strain building the scene did not soften.
- **A script-ended round has no intermission phase.** Game Flow's own timer ends a round into `intermission`; a `game.newRound()` from a script rolls straight into the next round. This game gets its podium break anyway, because its clock starts in the future (`at: now + breakSeconds`) — one number instead of a second phase machine — but that is the script's doing, not the kit's.
- **Tournament, MANA prize, wearable claim: struck.** They need a wallet key the scene can read on the server, and nothing reads one: **Env keys** takes values and never hands them back, so there is no reader to build on — before ethers-over-signedFetch and the client-side claim handshake, which are expert code outside the kit anyway.
- **The honest ceiling is unchanged:** every player's own screen decides where that player is, so strikes *bound* teleport cheating, never prevent it. The game tracks results; players report actions.

---

## 5. The scoreboard

Both columns count **code lines** — blank lines and comment-only lines removed — and every file of the session appears in exactly one row.

| Layer | Raw scene (LOC) | Studio session |
|---|---|---|
| Phase machine + anti-cheat sweep (`server.ts`) | 338 | Game Flow prefab + `madness-race` 73 + one AI diff |
| Game state, tower, boards, points (`gameState.ts`) | 1,259 | `pure/tower` 21 + `tower-builder` 29 + `round-results` 81 + `pure/boards` 54 |
| Client glue (`index.ts`) | 841 | folded into the scripts |
| Sync facade + schemas + messages | 581 | 0 |
| Time sync (`timeSync.ts`) | 271 | 0 — `game.now()` |
| Leaderboard rendering (5 files) | 1,337 | Leaderboard prefab ×2 + `pure/names` 3 |
| UI (`ui.tsx`) | 1,916 | Announcer + `pure/clock` 28 + `clock-board` 26 + `race-ui` 22 |
| Podium avatars | 353 | cut (§4) |
| Prize + tournament | 83+ | cut (§4) |
| Cinematic camera | 334 | ~310 ported as-is |
| Snapshots/face UI | 242 | cut |
| **Hand-written total** | **≈7,765** | **≈647 (337 game code + ~310 camera)** |

The 337 is measured, not estimated: the nine files of `packages/desktop/validate/fixtures/tower-of-madness/scripts/`, minus `tower-probe.ts` (the observer the probe reads the scene through, not part of the game) and minus `runtime/` (the editor writes those the moment a script imports `./runtime/game`). Those nine are **486 lines as they sit on disk**; 337 once blank lines and comments come out, which is the number the rows above add up to. The camera's ~310 is the raw scene's own file, ported.

**Traps this session never met** (each one bitten, hacked around, or comment-documented in the raw scene):

- **`isServer()` false at module load** — nobody typed `isServer()`; the module decides its half on first tick.
- **Heartbeat / stale-snapshot liveness** — the serverLife ladder is the Game strip, sends gate on it automatically, and the boot wipe re-adopts and overwrites stale facts.
- **Collider-reload hacks** — the runtime's job now, not scene code.
- **NTP by hand** — 271 lines → `game.now()`; the BigInt/Int64 arithmetic trap dies with it.
- **Broadcast-with-address-filter** — replaced by ask replies and enforced `{to}`.
- **Moments used as facts** — `announce`/`roundOver` are moments; everything a late joiner must see rides state. The distinction is API-shaped, not convention.
- **Identity from payload** — `player` *is* the connection. The finish payload is literally `{}`.
- **Manual AABB trigger checks, entity pools for stable sync ids, Storage silent-false, 12/13 KB edges, sandbox-has-no-setTimeout** — all module-owned.

The two things that don't shrink are the two things the raw scene got right for reasons outside networking: the camera, and the chunk GLBs themselves.
---

# Verification notes

## Verification of the two walkthroughs against docs/MULTIPLAYER-DX-PLAN.md (+ docs/CLIENT-SERVER-SPAWNING.md)

**Struck 2026-08-08 (BL9).** The paragraph below checks the walkthroughs against the *plan*, and three of the surfaces it credits never shipped: the Play ▾ second-player view, the Saved-data tab, and the Secrets step inside the publish flow. Both sessions now teach the gestures that exist — Play with one avatar, the logs' **Game** tab, right-click **Add Script** / the Script card's **New script**, and **Worlds → your world → Storage** for saved boards, per-player data and env keys. Read the rest of this section as a record of a past pass, not as a description of the editor.

**Checks that pass (both walkthroughs)** — stated once, not repeated below: identity always from `(data, player)`, never payload; all `setState`/`saved`/`playerData`/`secret`/`spawn` calls sit in green contexts; blue↔green flows use only `send`/`onMessage` with per-name direction respected (`takeFlag`/`finish` asked by players; `announce`/`roundOver`/`warned`/`struck`/`lightningWarning` told by the game); `{to}` only in green; no `isServer`/`syncEntity`/`registerMessages`/`MessageBus`/`Storage`/`EnvVar` anywhere; no `Math.random`/`Date.now` inside layout callbacks (W2 hand-rolls a pure LCG of `round.seed` — trap-10 clean); template-card copy, runs-on-line format, Pick gesture + hover-flash, `childrenOf` counts + "Add spawn point" verb, Play ▾ menu, Game strip states, `[game]`/`[you]` tags, "Shared — one real copy"/"Your screen's copy" labels, Saved-data two-step clear, and the Secrets publish step (incl. verbatim consequence line) all match §3/§5/§9. Neither walkthrough uses `myData`, `onOutcome`, or chase AI. `onPlayerNear` appears in W1 only as a labeled post-G5 "unlocks later" idea, consistent with decision #3. **`announce` is not a violation**: both use `game.send('announce', {text})` as a message *name* on the symmetric pair via the Announcer prefab — exactly what decision #2 sanctions (only the dedicated `announce`/`onAnnounce` verb was struck).

---

### Walkthrough 1 (Flagtag) — corrections

1. **All-time Leaderboard "backed by `game.playerData` hold totals" is not buildable as described** (§2.2 kit table). `playerData` is green-only, per-wallet, and has no enumeration API in §2.2; a display prefab cannot read it. An all-time board needs a green-maintained aggregate (top-N incrementally folded into `game.saved` and copied to a `game.state` key — exactly what W2's `boards.ts` does correctly). Fix: `hold-score.ts` maintains `game.state.allTime` from a saved aggregate, or the second board is cut.
2. **The `takeFlag` handler never validates `data.flag`**, yet the prose claims "the payload's `flag: this.entity` claim is validated against state." Nothing reads `data.flag`. §11.2 ("payloads are claims — validate every claim") demands either an actual check or dropping the claim. Related: the single hard-coded `flag` state key means `flag-rules.ts` is *not* safe-to-place-twice, so the walkthrough shouldn't gesture at the derived-key idiom while not following it (fine for a one-flag game — but say so).
3. **Unmatched message names — W1's own code trips G2b.** `flagTaken` and `flagDropped` are green-sent but no script registers a blue `onMessage` for either; §2.2/G2b flags unmatched send/onMessage names at edit time. Also the flag-visual runs-on line lists `flagTaken`, which that script never registers — the derived scanner could not produce that line.
4. **Collectible chip "Remembered per player" conflicts with §6's definition.** §6 defines Collectible as "one per-player state flag + one message" — a `game.state` flag dies when the game sleeps (§5 lifetime table), so the derived chip would not read "Remembered per player" (that's the `playerData` chip). Since the walkthrough's wallet story leans on coins being once-ever, either Collectible must be playerData-backed (and §6's description updated) or the chip and the once-ever claim are wrong.
5. **Trigger Area "Damage on enter: 100 (routes through Health & Respawn)" is invented capability.** §6's area/Health surfaces don't specify cross-prefab damage routing; the "Drowning: zero code" claim in W1 §3 depends on it. Needs to be named as G5 rework scope, not assumed.
6. **`game.onRoundStart` used green (calls `reset()` → `setState`)** — the plan never assigns this callback a side; see New Gaps #1.
7. **Game Flow "podium for top 3 of `game.state.leaderboard`"** assumes Game Flow reads a creator-maintained state key — no such key-contract is specified (see New Gaps #4).
8. **Strain 7 under-declares the store**: "the store shrinks to a points-spend" — no Store prefab exists in §6; that's a bespoke script + UI, and the strain list should say so.
9. Minor: "New scene → 'Multiplayer game' template" — §3 says every scene is an auth scene since P0 and §1 speaks of *the* template picker card; a distinct multiplayer template contradicts the dead-surface cut. Minor: `game.round.number` never used here — good — but note W2's use (below).

### Walkthrough 2 (Tower of Madness) — corrections

**Settled 2026-08-08 by building the scene.** Every item below was written against the prose version; §2 has since been rewritten from code that compiles and runs (`packages/desktop/validate/fixtures/tower-of-madness/`). Status kept for traceability — the live list of what building it changed is the table at the end of §2.

1. ~~**`game.round.number` does not exist in the plan.**~~ **Closed** — the shipped tuple carries a monotonic `number` (New Gaps #2), and the scene keys attempt validity on it.
2. ~~**`game.onRoundStart` used blue-side** (step 8: camera fly-up).~~ **Closed, doc was wrong** — the hook is green. Step 8 now derives the round change on a screen from `game.onStateChange`, which is the split New Gaps #1 asked for.
3. ~~**`game.newRound()` from a script vs Game Flow's own timer is undesigned.**~~ **Closed** — Game Flow ships `endsWhen: 'script'` and routes every round start through one hook (New Gaps #3). One thing the kit does *not* give a script-ended round is an intermission phase; §4 says so.
4. ~~**`childrenOf` imported from `./runtime/game`.**~~ **Closed** — it is exported there.
5. ~~**`game.playerData(f.p).get()` used without `?? {}`.**~~ **Superseded** — `get()` returns `{}` for a wallet the game has never seen, so `?? {}` was never the fix. The real defect was the missing type argument: without `playerData<T>(p)` the record is `Record<string, unknown>` and the arithmetic does not compile.
6. ~~**Script export shape inconsistent.**~~ **Closed in favour of W2's named `export class`** — and sharpened: the SDK runner constructs the FIRST function-valued export, so an attached script may export exactly one thing. W2's original `tower-builder.ts` and `madness-race.ts` both broke this by exporting a helper above the class; the shared helpers now live in `pure/`.
7. ~~**Leaderboard prefab "shows `game.state.seasonBoard`".**~~ **Closed** — the Leaderboard ships a `boardKey` param, and the two boards in this scene are two placements pointed at two keys.
8. ~~**Health & Respawn "Die below height".**~~ **Closed** — it is a shipped param.
9. Honesty check passes otherwise: the podium-avatar cut correctly cites no green profile ask + headless AvatarBase absence (CSS:179); finish validation is a generous height check per the `positionOf` contract; the clock design matches CSS §6's low-cardinality guidance.

**New, found only by running it:** with Game Flow *and* a creator's script both registering `game.onRoundStart`, the second hook was told *"Only the game can change game.state"* on every round — `newRound()` runs the hooks in a microtask outside the caller's green span, and the guard was a boolean the outer span's `finally` cleared mid-flight. Fixed in `pure/gameCore.ts` (green spans are counted, not flagged); regression leg in `game-harness.test.ts`.

---

### New gaps the walkthroughs reveal (missed by the plan review)

1. **`onRoundStart` has no assigned side.** The plan's core rule is "the fork is which callback you write," but this callback's color is undefined — and both real games need it on *both* sides (W1: green state reset; W2: blue camera). Needs either documented dual-side semantics (which strains the model) or split hooks (green `onRoundStart` + screens deriving round changes from `onStateChange`).
2. **No round counter.** Real recipes need to invalidate stale per-round data ("was this attempt from this round?"). The tuple offers only `seed` — usable but non-obvious. A monotonic `round.number` is a one-field API addition worth pinning in §2.2.
3. **Game Flow lacks a script-ended-round mode.** Any game whose round ends on a condition (score cap, accelerating clock, last-standing) fights the fixed timer: who owns the podium, the countdown UI, and double-fire prevention when a script calls `game.newRound()` mid-flow is undesigned. This should be explicit G5 rework scope.
4. **Aggregate/all-time boards, and kit-prefabs-read-creator-keys generally.** `playerData` can't be enumerated, so all-time boards only exist via incremental aggregation into `saved` (custom green code — W1 got this wrong, W2 hand-wrote 14 lines). Adjacent: Game Flow's podium and Leaderboard both need a documented "which state key do I read" contract. Either Points/Leaderboard grows a built-in saved top-N, or the §6 coverage claims should name this custom-code seam. Sub-gap: boards keyed by wallet have no green-side display-name resolution (client `getPlayer` only covers connected players) — offline players render as raw addresses.
5. **Multi-prefab layout.** One plan spanning several pools forces bypassing the per-pool rng streams and hand-rolling a PRNG — exactly the territory trap 10 fences. A multi-variant `layout(['a','b',…], planFn)` or a documented cross-pool derived-stream idiom belongs on the v1.1 list (W2 names it a wish; the plan itself doesn't carry it).
6. **Area → damage routing.** The area-hurts-you archetype (W1's moat) needs a specified wiring mechanism between Trigger Area and Health & Respawn (area-name channel config?) — currently in neither prefab's §6 scope.

### Plan-internal inconsistencies surfaced incidentally (worth fixing in the doc)

- §4 trap 4 lint copy still says "use **game.announce**" — stale after decision #2 struck the verb; should read "use game.send".
- §7 G6 row still uses the old hierarchy labels "Everyone sees / Only you see" — §3/§10 recast them to "Shared — one real copy / Your screen's copy" (both walkthroughs correctly use the new labels).
- §6 Collectible's "one per-player state flag" implementation contradicts its own "each player can pick this up once" promise across sleep (same issue as W1 correction #4).