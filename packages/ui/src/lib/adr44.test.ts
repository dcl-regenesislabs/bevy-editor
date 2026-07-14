import { describe, expect, it } from 'vitest'
import { signedFetchPayload } from './adr44'

// These strings are the exact bytes the auth-chain signs. A change here silently
// 401s every authenticated worlds/gatekeeper/storage request, so they are pinned.
describe('signedFetchPayload (ADR-44)', () => {
  it('joins method:path:timestamp:metadata, all lowercased', () => {
    expect(signedFetchPayload('GET', '/wallet/contribute', '1700000000000', '{}')).toBe(
      'get:/wallet/contribute:1700000000000:{}'
    )
  })

  it('lowercases the whole payload including the path and metadata', () => {
    expect(
      signedFetchPayload('PUT', '/World/Boedo.dcl.eth/Permissions/Deployment/0xABCDEF', '42', '{"Realm":"X"}')
    ).toBe('put:/world/boedo.dcl.eth/permissions/deployment/0xabcdef:42:{"realm":"x"}')
  })

  it('preserves the literal colon separators between the four parts', () => {
    // exactly three colons come from join; any inside metadata are part of it
    const p = signedFetchPayload('post', '/scene-bans', '1', '{"a":"b"}')
    expect(p).toBe('post:/scene-bans:1:{"a":"b"}')
  })
})
