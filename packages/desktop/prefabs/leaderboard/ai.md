---
prefab: leaderboard
---

# Leaderboard — AI guide

A panel that shows one board: it reads a `game.state` key and paints the places.
It never decides or stores a score.

The project copy is normally custom/leaderboard/ — check what is on disk, a
second copy is custom/leaderboard_2/.

## When to use

Whenever a game already keeps a ranked list and wants it on a wall. Place one per
board: round scores and all-time bests are two keys, so two panels.

Place NOTHING if no green code writes rows — the panel would just show its empty
line. Write the rows first, then place the board on that key.

## API

There is nothing to import. The contract is the state key:

    game.setState({ leaderboard: [{ player, score }, …] })

- Rows are objects. The player field may be `player`, `p`, `address`, `wallet` or
  `name`; the score field may be `score`, `points`, `pts`, `value`, `seconds`,
  `time` or `best`. Anything else in a row is ignored, and a row missing either
  half is skipped.
- The panel sorts the rows itself, so the writer's order does not matter.
- Late joiners get the board from the snapshot. Write rows with `game.setState`,
  never with `game.send` — a message is a moment and a board is a fact.

Params of the prefab's script — set them in the placePrefab request:

- `title`: the heading on the panel (default "Leaderboard").
- `boardKey`: the `game.state` key to read (default `'leaderboard'`). Game Flow
  reads the same key for its winners line — point both at one key.
- `sort`: `'desc'` (highest wins — points) or `'asc'` (lowest wins — best times,
  which also renders the score as m:ss).
- `rows`: how many places the panel lists (default 8, max 25).

## The all-time board idiom

`game.playerData` cannot be listed, so an all-time or season board is kept by
folding results into `game.saved` at the end of a round and copying the top N
into `game.state`:

    const board = fold(game.saved.get('bestTimes') ?? [], results)
    game.saved.set('bestTimes', board)
    game.setState({ bestTimes: board })

Then place a second Leaderboard with `boardKey: 'bestTimes'`.

## Do / Don't

- DON'T keep a score on a screen and send it to the game. Count it in a green
  handler; a screen's number is a claim.
- DON'T write more than the visible places into the key. Fold to the top ten in
  green code — every extra row rides the wire on every change.
- DO expect wallet addresses. There is no name lookup for a player who is not
  connected, so offline players show as a shortened address.

## Example

"Show the fastest climbers": in a green handler keep the list, and place a board
on that key.

    game.setState({ leaderboard: runs.sort((a, b) => a.time - b.time).slice(0, 10) })

with `boardKey: 'leaderboard'`, `sort: 'asc'`, `title: 'Best Times'`.
