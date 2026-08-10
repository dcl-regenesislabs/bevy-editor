import { describe, expect, it } from 'vitest'
import { driveHint } from './drive-hint'
import type { PrefabData } from '../../prefabs/format'

const DRIVE = {
  rule: 'The server sends a line.',
  code: "game.broadcast('announce', { text: 'Round over' })",
  next: 'Press New script below.'
}

function prefab(id: string, folder: string, drivenBy?: PrefabData['drivenBy']): { folder: string; data: PrefabData } {
  return {
    folder,
    data: {
      id,
      name: id,
      category: 'custom',
      tags: [],
      ...(drivenBy === undefined ? {} : { drivenBy })
    }
  }
}

const ANNOUNCER = prefab('a1', 'custom/announcer', DRIVE)
const GAME_FLOW = prefab('g1', 'custom/game_flow')
const OWN = 'custom/announcer/scripts/announcer.tsx'
const MINE = 'src/scripts/round-rules.ts'

describe('the line that drives a placed item', () => {
  it('pins it to the script the prefab installed, not to the creator’s own', () => {
    expect(driveHint([ANNOUNCER], 'a1', [MINE, OWN])).toEqual({ drive: DRIVE, path: OWN })
  })

  it('says nothing for an item that drives itself', () => {
    expect(driveHint([GAME_FLOW], 'g1', ['custom/game_flow/scripts/game-flow.ts'])).toBeNull()
  })

  it('says nothing on an entity that is not a prefab instance', () => {
    expect(driveHint([ANNOUNCER], null, [MINE])).toBeNull()
  })

  // A prefab the project no longer holds: the strip above already says the copy
  // is gone, and a line about driving it would be about nothing.
  it('says nothing when the prefab is not in the project', () => {
    expect(driveHint([], 'a1', [OWN])).toBeNull()
  })

  // The item was gutted — its own script is off the entity, so it does nothing at
  // all now and the missing line is not what is wrong with it.
  it('says nothing once the prefab’s own script is off the entity', () => {
    expect(driveHint([ANNOUNCER], 'a1', [MINE])).toBeNull()
  })

  // custom/announcer_2 is a second copy, not this one: a prefix match on the
  // folder alone would hand copy 2's row copy 1's line.
  it('does not mistake a sibling copy’s script for this copy’s', () => {
    expect(driveHint([ANNOUNCER], 'a1', ['custom/announcer_2/scripts/announcer.tsx'])).toBeNull()
  })
})
