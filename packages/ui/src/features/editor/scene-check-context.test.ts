import { describe, expect, it } from 'vitest'
import { isCheckedScript } from './scene-check-context'

describe('which files the scene checks read', () => {
  it('reads a .tsx script — the Announcer is one, and every rule was blind to it', () => {
    expect(isCheckedScript('custom/announcer/scripts/announcer.tsx')).toBe(true)
    expect(isCheckedScript('src/scripts/hud.tsx')).toBe(true)
  })

  it('reads a .ts script', () => {
    expect(isCheckedScript('src/scripts/race.ts')).toBe(true)
    expect(isCheckedScript('custom/tower/scripts/madness-race.ts')).toBe(true)
  })

  it('leaves the carried runtime modules and everything that is not a script', () => {
    expect(isCheckedScript('custom/announcer/scripts/runtime/game.ts')).toBe(false)
    expect(isCheckedScript('src/scripts/runtime/pure/gameCore.tsx')).toBe(false)
    expect(isCheckedScript('src/scene.json')).toBe(false)
    expect(isCheckedScript('node_modules/@dcl/sdk/index.ts')).toBe(false)
  })
})
