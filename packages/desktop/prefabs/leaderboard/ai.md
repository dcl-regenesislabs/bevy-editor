---
prefab: leaderboard
claims-rpc: board.submit, board.top
---

# Leaderboard — AI guide

A named score board the Multiplayer Server owns: it keeps every player's best,
persists it per wallet, and paints the top places onto the placed panel.

The project copy is normally custom/leaderboard/ — check what is on disk, a
second copy of the FOLDER is custom/leaderboard_2/. Two boards in one scene do
not need a second folder: place the same prefab twice with different board
names.

## When to use

When a score should outlive the session and be the same for everyone — points,
best time, kills, laps. Not for a number only one player ever sees (keep that in
the client script) and not for live match state (that belongs to whatever owns
the round).

The prefab needs an authoritative scene (data.json requiresSdk: auth-server). In
a scene with no Multiplayer Server the panel says so and no score is ever kept.

Place ONE instance per board. The board's identity is its name, so two instances
named differently are two independent boards, with separate storage. Two
instances sharing a name share the board and the first one's settings win.

Params of the prefab's script — set them in the placePrefab request:
- board: the board's name, also the panel title and the storage namespace
  (default "Points"). Renaming it starts an empty board; the old one is still on
  disk under the old name.
- sort: desc keeps each player's HIGHEST score (points), asc keeps the LOWEST
  (best time). Default desc.
- rollover: none for one all-time board, weekly for a fresh board every ISO week
  (UTC). Default none.
- rows: how many places the panel lists (default 8). A viewer below that line
  still sees their own place under the list.

## API

    import { submitScore, awardScore, fetchBoard } from '../../custom/leaderboard/scripts/board-api'

- submitScore(board, score): CLIENT side. Submits this player's score; the server
  takes the wallet from the connection, so it can only ever be their own. Returns
  { ok, best, rank } and never throws — ok is false when there is no server, the
  board name is unknown, the number is out of range, or the player submitted less
  than half a second ago. A score that does not beat their best is accepted and
  changes nothing.
- awardScore(board, address, score): SERVER side. The trustworthy path — use it
  whenever the server itself computed the score.
- fetchBoard(board, limit): either side. Resolves { board, period, rows, you,
  live }; rows are { rank, name, score, address, you }. live is false when the
  server did not answer.

installLeaderboard is the prefab's own entry point. Never call it, and never
create your own createRpc('board'): this module owns the single rpc instance for
the board namespace.

## What the server guarantees

One bundle runs on both sides; isServer() from '@dcl/sdk/network' is the switch.
The server owns the table: clients only ask. Identity is never in a payload.

The NUMBER in submitScore is client-reported — it is range-checked, rate-limited
and kept only when it beats that player's own best, but a modified client can
still send a score it did not earn. Tell the user that plainly: for a board worth
cheating for, count the event on the server and call awardScore there. The
display NAME is cosmetic and unverified; the wallet next to it is not.

Persistence is two layers, both server-side: each player's best in Storage.player
under `leaderboard:<board>`, and the visible table in scene storage so the board
survives the server going to sleep. Writes are checkpointed, never per tick.

## Do / Don't

- DON'T keep a parallel copy of the score on the client and trust it — read the
  board back with fetchBoard.
- DON'T call submitScore every frame or per point scored; submit at the moment
  the run ends. Submissions are rate-limited per player.
- DON'T poll fetchBoard faster than a few seconds. The panel already refreshes
  itself; a consumer script does not need its own loop.
- DON'T reuse one board name for two meanings (points and times) — the sort is a
  property of the board, and mixed units make the ranking meaningless.
- If the scene is NOT authoritative, say so instead of shipping submissions that
  can only ever resolve ok: false.

## Example

"Post each run's time and show the ten fastest": place Leaderboard with board
"Best Time", sort asc and rows 10, then from the client script that times the
run:

    import { submitScore } from '../../custom/leaderboard/scripts/board-api'

    private async finish(seconds: number): Promise<void> {
      const result = await submitScore('Best Time', seconds)
      if (result.ok) this.showPlace(result.rank)
    }
