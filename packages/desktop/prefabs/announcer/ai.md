---
prefab: announcer
claims-messages: announce
---

# Announcer — AI guide

One line on every player's screen, for a few seconds. The game says it; the
screens show it.

The project copy is normally custom/announcer/ — check what is on disk, a second
copy is custom/announcer_2/.

## When to use

For moments: "The flag is taken", "Round over", "A climber made it". Place ONE
anywhere; it is invisible. A second copy is a no-op (the first one owns the
scene's UI).

Do NOT use it for anything a late joiner must see — a score, a carrier, a
countdown. Those are facts and belong in `game.state` with a board or a sign
reading them.

## API

There is nothing to import. The channel is one message name every script already
has:

    game.send('announce', { text: 'Round over — the tower is rebuilt' })

- Send it from GREEN code (inside `game.onMessage`, `game.onRoundStart`,
  `game.every`, `game.onEnterZone`). The game's `send` reaches every screen.
- `{ to: player }` narrows it to one player's screen — only they receive the
  packet.
- The payload is `{ text }`; a plain string works too. Longer than 140 characters
  is trimmed, and empty text shows nothing.
- Do NOT register your own `game.onMessage('announce', …)`. One name has one
  handler and this piece owns it — a second script claiming it is an error card.

Params of the prefab's script — set them in the placePrefab request:

- `holdSeconds`: how long a message stays on screen (default 4, max 60).
- `fontSize`: text size on a 1920×1080 screen (default 32).

## The scene's UI is single-owner

Only one script per scene may draw UI. This piece claims it at start and says so
in the console if something else (Admin Tools, your own panel) already has it —
in that case the announcements do not render. If you write a UI panel of your
own, draw the announcement inside it instead of placing this piece.

## Do / Don't

- DON'T send an announcement from a screen. A screen's `send` asks the game; it
  reaches nobody else.
- DON'T announce the same thing every frame. Send it once, where the decision is
  made.
- DO pair it with a board: the announcement is the moment, the board is the fact.

## Example

"Tell everyone when someone takes the flag": in the green handler that decides it,

    game.onMessage('takeFlag', (_data, player) => {
      game.setState({ flag: { carrier: player } })
      game.send('announce', { text: 'The flag is taken!' })
      return { ok: true }
    })
