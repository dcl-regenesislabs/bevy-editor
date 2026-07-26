import { describe, it, expect } from 'vitest'
import { isFrozenStatus } from './commands'

// `/scene_stats` reports every reason the scene isn't ticking in one set, so the
// editor has to look for "frozen" specifically — reading a bare "blocked" as
// frozen let a still-loading scene pass for a paused one, which skipped the
// auto-pause and left the scene running behind an edit-mode toolbar.
const stats = (status: string): string =>
  `scene: 'test'\nhash: bafk\ntick: 0\nentities: 12\nstatus: ${status}\nbroken: false\nin_flight: 0`

describe('isFrozenStatus', () => {
  it('is true when the editor froze the scene', () => {
    expect(isFrozenStatus(stats('blocked({"frozen"})'))).toBe(true)
  })

  it('is false while the scene is merely loading its models', () => {
    expect(isFrozenStatus(stats('blocked({"gltfs loading"})'))).toBe(false)
  })

  it('is false for other engine blocks', () => {
    expect(isFrozenStatus(stats('blocked({"get_user_data"})'))).toBe(false)
    expect(isFrozenStatus(stats('blocked({"imposter_baking"})'))).toBe(false)
  })

  it('is true when frozen appears alongside another reason, in any order', () => {
    expect(isFrozenStatus(stats('blocked({"frozen", "gltfs loading"})'))).toBe(true)
    expect(isFrozenStatus(stats('blocked({"gltfs loading", "frozen"})'))).toBe(true)
  })

  it('is false for a running scene and for unparseable output', () => {
    expect(isFrozenStatus(stats('running'))).toBe(false)
    expect(isFrozenStatus('')).toBe(false)
    expect(isFrozenStatus('scene not found')).toBe(false)
  })

  it('does not match a scene whose name contains the word', () => {
    expect(isFrozenStatus("scene: 'frozen lake'\nstatus: running")).toBe(false)
  })
})
