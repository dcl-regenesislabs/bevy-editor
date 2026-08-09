---
prefab: announcer
claims-messages: announce
---

# Announcer — AI guide

One line on every player's client, for a few seconds. The server says it; every
client shows it.

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

There is nothing to import. The channel is one broadcast name every script
already has:

    game.broadcast('announce', { text: 'Round over — the tower is rebuilt' })

- WHICH SIDE: the call goes on the SERVER, inside the `if (isServer())` branch —
  in a `game.onRequest`, `game.onRoundStart`, `game.every` or `game.onEnterArea`
  handler. A broadcast from a client reaches nobody.
- `game.broadcast('announce', { text }, player)` narrows it to one player — only
  that player's client receives it.
- The payload is `{ text }`; a plain string works too. Longer than 140 characters
  is trimmed, and empty text shows nothing.
- Do NOT register your own `game.onBroadcast('announce', …)`. Broadcast listeners
  are many-per-name, so yours would not replace this prefab's client-side one —
  it would run beside it and the line would be shown twice.

Params of the prefab's script — set them in the placePrefab request:

- `holdSeconds`: how long a message stays up (default 4, max 60).
- `fontSize`: text size at 1920×1080 (default 32).

## The scene's UI is single-owner

Only one script per scene may draw UI. This prefab claims it at start and says so
in the console if something else (Admin Tools, your own panel) already has it —
in that case the announcements do not render. If you write a UI panel of your
own, draw the announcement inside it instead of placing this prefab.

## Do / Don't

- DON'T announce from the client half of a script. `game.broadcast` is a server
  verb; a client that calls it reaches nobody, itself included.
- DON'T announce the same thing every frame. Broadcast it once, where the
  decision is made — and `update()` runs on the server too, so a broadcast there
  fires ~41 times a second.
- DO pair it with a board: the announcement is the moment, the board is the fact.

## Example

"Tell everyone when someone takes the flag": in the server branch that decides it,

    start(): void {
      if (isServer()) {
        game.onRequest('takeFlag', (_data, player) => {
          game.setState({ flag: { carrier: player } })
          game.broadcast('announce', { text: 'The flag is taken!' })
          return { ok: true }
        })
        return
      }
    }
