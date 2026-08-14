import { describe, expect, it } from 'vitest'
import { scriptUsesGame, usesGame } from './uses-game'

describe('scriptUsesGame', () => {
  it('sees the import a game scene is made of', () => {
    expect(scriptUsesGame("import { game } from './runtime/game'\ngame.onStart(() => {})")).toBe(true)
  })

  it('sees a free export imported on its own', () => {
    expect(scriptUsesGame("import { onClick } from '../runtime/game'")).toBe(true)
  })

  it('says no to a script that only talks to its own screen', () => {
    expect(scriptUsesGame("import { engine } from '@dcl/sdk/ecs'\nexport class Door {}")).toBe(false)
  })

  it('says no to a types-only import — nothing runs because of it', () => {
    expect(scriptUsesGame("import type { GameState } from './runtime/game'")).toBe(false)
  })

  it('ignores an import written in a comment or a doc string', () => {
    expect(scriptUsesGame("// import { game } from './runtime/game'")).toBe(false)
    expect(scriptUsesGame("const doc = `import { game } from './runtime/game'`")).toBe(false)
  })

  it('does not mistake a neighbouring module for the game', () => {
    expect(scriptUsesGame("import { start } from './game-flow'")).toBe(false)
  })
})

describe('usesGame', () => {
  const PROJECT = {
    'src/door.ts': "import { engine } from '@dcl/sdk/ecs'",
    'src/race.ts': "import { game } from './runtime/game'"
  }

  it('is true when a script placed on an entity uses it', () => {
    expect(usesGame(PROJECT, ['src/door.ts', 'src/race.ts'])).toBe(true)
  })

  it('is false when the game script is in the project but on no entity', () => {
    expect(usesGame(PROJECT, ['src/door.ts'])).toBe(false)
  })

  it('is false for a scene with nothing placed', () => {
    expect(usesGame(PROJECT, [])).toBe(false)
    expect(usesGame({}, ['src/race.ts'])).toBe(false)
  })
})
