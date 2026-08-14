// The Game strip's states, read off the line the game module prints on every
// serverLife transition (`[studio] game-life <state>`, preview only). The editor
// has no view into the played scene's ECS, so the console is the channel; the
// ladder itself stays in serverLife, where the runtime already lives by it.
//
// The strip's EXISTENCE is not read from here — a game scene shows it from the
// moment Play starts (uses-game.ts), because the line above is gated on a
// preview realm the editor's Play never reports, so waiting for it meant no
// strip at all. Until a line arrives the strip reads the clock instead.
//
// Pure: log text in, strip out. The polling half is PlayGame.tsx.

export const GAME_LIFE_MARKER = '[studio] game-life'

export type GameLife = 'running' | 'waking' | 'asleep' | 'unreachable' | 'no-server'

// serverLife's five rungs, mapped to the states the creator sees. `degraded`
// reads as running on purpose: a hitch names no gesture a creator could take, so
// the lagging state was cut rather than shown as anxiety with no next step. It
// resolves to running or asleep on its own within seconds.
//
// `no-server` is not a rung — nothing prints it. It is the case where the scene
// has no Multiplayer Server to reach at all (see serverPresence below), and it
// exists so that case stops borrowing `unreachable`'s wording, which blames a
// fault that isn't there.
const LADDER: Record<string, GameLife> = {
  running: 'running',
  degraded: 'running',
  waking: 'waking',
  asleep: 'asleep',
  unreachable: 'unreachable'
}

/** The last state the played scene reported, or null when it never has one. */
export function parseGameLife(logs: string): GameLife | null {
  let found: GameLife | null = null
  for (const line of logs.split('\n')) {
    const at = line.indexOf(GAME_LIFE_MARKER)
    if (at === -1) continue
    const word = line.slice(at + GAME_LIFE_MARKER.length).trim().split(/\s+/)[0]
    const life = LADDER[word]
    if (life !== undefined) found = life
  }
  return found
}

/** True for a line the Game console tab must not show — machinery, not output. */
export function isGameLifeLine(line: string): boolean {
  return line.includes(GAME_LIFE_MARKER)
}

/** How long a game scene may stay silent before the strip calls it unreachable. */
export const GAME_SILENT_MS = 20_000

/** The state of a game that has said nothing yet: waking, then out of reach. */
export function silentLife(silentMs: number): GameLife {
  return silentMs >= GAME_SILENT_MS ? 'unreachable' : 'waking'
}

// Local Play does boot a Multiplayer Server — the editor installs the
// auth-server SDK and toolchain on first kit placement, and that toolchain's
// start command spawns the server unconditionally. So silence in a scene that
// HAS that SDK is a real fault, and `unreachable` is the honest word for it.
//
// A scene that does NOT have it is a different situation: no server was ever
// spawned, so there is nothing to fail. `installed: false` means the scene has
// no node_modules yet — unknown, not incapable — and must not be read as absent.
export type ServerPresence = 'present' | 'absent' | 'unknown'

export function serverPresence(cap: { authServer: boolean; installed: boolean } | null): ServerPresence {
  if (cap === null) return 'unknown'
  if (cap.authServer) return 'present'
  return cap.installed ? 'absent' : 'unknown'
}

/**
 * The state the strip shows: what the scene reported, what the clock says while
 * it has reported nothing, and — when the scene carries no server — the state
 * that names the gesture instead of a fault.
 *
 * A reported `running` or `asleep` beats the probe: the scene speaking is newer
 * evidence than a file read taken when Play started. Only silence and
 * `unreachable` give way, because those are exactly what an absent server looks
 * like from here.
 */
export function gameLife(reported: GameLife | null, silentMs: number, server: ServerPresence): GameLife {
  const life = reported ?? silentLife(silentMs)
  if (server === 'absent' && (life === 'unreachable' || life === 'waking')) return 'no-server'
  return life
}

// How the strip reads the console. The scene prints its game-life line ONCE per
// transition, so a transition whose line has scrolled out of the tail between two
// polls is gone for good — the strip would keep showing the state before it.
//
// Two guards, because either alone leaves a hole. The tail is sized far above the
// worst case a scene can print in one poll window, so a transition has to survive
// only ~2s of output rather than ~2s of a 60-line budget; and a poll that finds
// no line at all leaves the last state standing (PlayGame.tsx), so a tail that
// has scrolled past every line can never regress the strip to silence.
export const GAME_POLL_MS = 2000
export const GAME_LOG_TAIL = 400

export interface GameStrip {
  text: string
  /** green when the game is up, red when it cannot be reached, neutral between */
  tone: 'server' | 'danger' | 'default'
  /** the state offers the Logs drawer as its next gesture */
  logs: boolean
}

/** `seconds` is how long this state has been showing — only Waking spends it. */
export function gameStrip(life: GameLife, seconds: number): GameStrip {
  switch (life) {
    case 'running':
      return { text: '● Game running', tone: 'server', logs: false }
    case 'waking':
      return { text: `◐ Waking… ${Math.max(0, Math.floor(seconds))}s`, tone: 'default', logs: false }
    case 'asleep':
      return { text: '○ Game asleep — wakes when a player arrives.', tone: 'default', logs: false }
    case 'unreachable':
      return { text: '✕ Can’t reach the Multiplayer Server —', tone: 'danger', logs: true }
    case 'no-server':
      return { text: '○ This scene has no Multiplayer Server — place a Game Flow item to add one.', tone: 'default', logs: false }
  }
}

// The runtime's error cards print once per session into the Game tab, three
// clicks from the strip the creator is watching — so a scene that runs while
// dropping every message read `● Game running` and nothing else. A state that
// already offers the logs keeps its own wording: it points at the same drawer.
/** The strip with the problems the console has printed, when there are any. */
export function withProblems(strip: GameStrip, problems: number): GameStrip {
  if (problems < 1 || strip.logs) return strip
  return { text: `${strip.text} · ${problems} ${problems === 1 ? 'problem' : 'problems'}`, tone: 'danger', logs: true }
}
