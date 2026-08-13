// Updating swaps the new bundle into the old bundle's *path*, so a version that
// renamed the app leaves us running from an executable that no longer exists.
// Getting this wrong doesn't fail loudly — the app exits and never comes back,
// which is what a user updating from 0.2.1 hit.
import { describe, it, expect } from 'vitest'
import { pickRelaunchExec } from './updater-feed'

const OLD = '/Applications/Bevy Scene Editor.app/Contents/MacOS/Bevy Scene Editor'

describe('choosing what to relaunch after a macOS swap', () => {
  it('takes the renamed binary when ours is gone', () => {
    expect(pickRelaunchExec(OLD, ['Decentraland Studio'])).toBe('Decentraland Studio')
  })

  it('leaves the default alone when the name did not change', () => {
    expect(pickRelaunchExec(OLD, ['Bevy Scene Editor'])).toBeNull()
  })

  it('prefers our own name over a stray sibling binary', () => {
    expect(pickRelaunchExec(OLD, ['Bevy Scene Editor', 'something-else'])).toBeNull()
  })

  it('does not guess when the bundle is ambiguous', () => {
    expect(pickRelaunchExec(OLD, ['Studio A', 'Studio B'])).toBeNull()
    expect(pickRelaunchExec(OLD, [])).toBeNull()
  })

  // Finder writes .DS_Store into any directory someone opens and ditto
  // preserves it, which would otherwise make the bundle look ambiguous and
  // silently restore the bug.
  it('is not fooled by a .DS_Store next to the binary', () => {
    expect(pickRelaunchExec(OLD, ['.DS_Store', 'Decentraland Studio'])).toBe('Decentraland Studio')
    expect(pickRelaunchExec(OLD, ['.DS_Store', 'Bevy Scene Editor'])).toBeNull()
  })
})
