import { describe, it, expect } from 'vitest'
import { isNewer, parseFeed } from './updater-feed'

// A real latest-mac.yml as electron-builder emits it (two arch zips + blockmaps).
const FEED = `version: 0.4.1
files:
  - url: Bevy-Scene-Editor-0.4.1-arm64-mac.zip
    sha512: QVJNc2hhNTEy
    size: 123456789
    blockMapSize: 12345
  - url: Bevy-Scene-Editor-0.4.1-mac.zip
    sha512: WDY0c2hhNTEy
    size: 987654321
path: Bevy-Scene-Editor-0.4.1-arm64-mac.zip
sha512: QVJNc2hhNTEy
releaseDate: '2026-08-01T10:00:00.000Z'
`

describe('parseFeed', () => {
  it('reads the version and every asset entry', () => {
    const feed = parseFeed(FEED)
    expect(feed.version).toBe('0.4.1')
    expect(feed.assets).toEqual([
      { name: 'Bevy-Scene-Editor-0.4.1-arm64-mac.zip', sha512: 'QVJNc2hhNTEy' },
      { name: 'Bevy-Scene-Editor-0.4.1-mac.zip', sha512: 'WDY0c2hhNTEy' }
    ])
  })

  // the reason it splits per entry instead of pairing line-by-line
  it('survives extra and reordered fields inside an entry', () => {
    const feed = parseFeed(`version: 1.2.3
files:
  - url: app.zip
    size: 42
    futureField: whatever
    sha512: aGFzaA==
`)
    expect(feed.assets).toEqual([{ name: 'app.zip', sha512: 'aGFzaA==' }])
  })

  it('throws rather than returning a feed with no version', () => {
    expect(() => parseFeed('files:\n  - url: a.zip\n    sha512: x\n')).toThrow(/no version/)
  })

  // silently returning zero assets would look like "nothing to download"
  it('throws when no entry yields both a name and a hash', () => {
    expect(() => parseFeed('version: 1.0.0\nfiles:\n  - url: a.zip\n    size: 4\n')).toThrow(/no assets/)
  })
})

describe('isNewer', () => {
  it('compares numerically, not lexically', () => {
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('0.9.0', '0.10.0')).toBe(false)
  })

  it('is false for the same version — the no-update case', () => {
    expect(isNewer('1.2.3', '1.2.3')).toBe(false)
  })

  it('handles a v prefix and differing segment counts', () => {
    expect(isNewer('v1.3', '1.2.9')).toBe(true)
    expect(isNewer('1.2', '1.2.0')).toBe(false)
    expect(isNewer('1.2.1', '1.2')).toBe(true)
  })

  // a prerelease tag is dropped, so 1.0.0-beta.2 is not newer than 1.0.0
  it('ignores prerelease suffixes', () => {
    expect(isNewer('1.0.0-beta.2', '1.0.0')).toBe(false)
    expect(isNewer('1.0.1-beta.1', '1.0.0')).toBe(true)
  })

  it('treats unparseable segments as 0 instead of NaN-comparing', () => {
    expect(isNewer('1.x.0', '1.0.0')).toBe(false)
    expect(isNewer('2.x.0', '1.0.0')).toBe(true)
  })
})
