// The Game strip's states, read off the line the game module prints on every
// serverLife transition (`[studio] game-life <state>`, preview only). The editor
// has no view into the played scene's ECS, so the console is the channel; the
// ladder itself stays in serverLife, where the runtime already lives by it.
//
// Pure: log text in, strip out. The polling half is PlayGame.tsx.

export const GAME_LIFE_MARKER = '[studio] game-life'

export type GameLife = 'running' | 'waking' | 'asleep' | 'unreachable'

// serverLife's five rungs, mapped to the four the creator sees. `degraded` reads
// as running on purpose: a hitch names no gesture a creator could take, so the
// lagging state was cut rather than shown as anxiety with no next step. It
// resolves to running or asleep on its own within seconds.
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
  }
}
