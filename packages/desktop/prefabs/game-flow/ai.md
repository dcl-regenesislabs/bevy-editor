---
prefab: game-flow
claims-state: game.state.flow
---

# Game Flow — AI guide

Lobby, countdown, rounds, winners: the piece that runs a game from start to end,
on top of `game.round`.

The project copy is normally custom/game_flow/ — check what is on disk, a second
copy is custom/game_flow_2/.

## When to use

Whenever the game is played in rounds: a race, a wave survival, a timed climb, a
scored match. Place ONE anywhere; it is a sign you can move or hide. A second
copy paints its own sign and drives nothing.

Do NOT write a phase machine, a lobby timer or a "round over" flag in a script —
this piece owns all three, and two clocks writing one game never agree.

## API

There is nothing to import. Game Flow talks through the shared facts and messages
every script already has:

- `game.state.flow` — `{ phase, endsAtMs, round, present }`. `phase` is
  `'lobby' | 'round' | 'intermission'`; `endsAtMs` is a `game.now()` instant
  (0 while the lobby is parked); `round` counts rounds PLAYED, from 1; `present`
  is the head count. Read it, never write it.
- `game.round` / `game.onRoundStart` — the engine's round tuple, as always. Game
  Flow starts rounds with `game.newRound()`, so `game.round.number` and
  `game.state.flow.round` differ by the boot round: key per-round validity on
  `game.round.number`.
- `game.send('announce', { text })` — Game Flow tells every player who won at the
  end of a round. If an Announcer is placed it shows the line; if not, nothing
  happens. Read custom/announcer/ai.md if one is placed.

Params of the prefab's script — set them in the placePrefab request:

- `roundSeconds`: how long a round lasts (default 300). With `endsWhen: 'script'`
  it is only a ceiling.
- `countdownSeconds`: how long the lobby counts down once enough players are in
  (default 10).
- `intermissionSeconds`: how long the winners stay up between rounds (default 10).
- `minPlayers`: players needed before a round starts (default 1).
- `endsWhen`: `'timer'` (the clock ends the round) or `'script'` (your code ends
  it with `game.newRound()`, and the sign hides a clock it does not own).
- `boardKey`: the `game.state` key the winners line is read from (default
  `'leaderboard'`). Point a Leaderboard at the same key.

## Ending a round from a script

Set `endsWhen: 'script'` and call `game.newRound()` inside a green handler when
your condition hits. Game Flow follows: it announces the winners of the round
that just ended and starts the new one. Never call `game.newRound()` on a screen
and never both end the round and run your own intermission — the ceiling is the
only other thing that can end it, and it exists so a forgotten call cannot wedge
the game.

## Do / Don't

- DON'T write `game.state.flow` from a script. Set the params instead.
- DON'T count players yourself for a lobby — `game.state.flow.present` is the
  game's own count, and a screen has no roster to count.
- DON'T reset scores on a timer. Reset them in `game.onRoundStart`, which runs in
  the game for every round Game Flow or your script starts.
- DO write the board rows before the round ends, not after: the winners line is
  read from `boardKey` at that instant. Rows are `{ player, score }`-ish objects
  — `player`/`p`/`address` and `score`/`points`/`time` are all understood.

## Example

"End the round as soon as three players finish, and show the winners": place Game
Flow with `endsWhen: 'script'`, then in a green handler

    game.onMessage('finish', (_data, player) => {
      const done = [...(game.state.finishers ?? []), player]
      game.setState({ finishers: done, leaderboard: board(done) })
      if (done.length >= 3) game.newRound()
      return { ok: true }
    })
