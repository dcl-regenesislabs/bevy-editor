import { beforeEach, describe, expect, it, vi } from 'vitest'

// `destructiveVerdict` is the gate in front of the only CLI build Studio refuses
// to spawn. It has to mirror the CLI's own condition and nothing wider: that
// build clears a world only when the world holds scenes the publish does NOT
// overlap, so an empty world and a plain republish must both pass. Blocking
// those would tell a creator their SDK is about to wipe a world that has nothing
// in it — and offer "update your SDK" as the only way out.
vi.mock('../worlds/signed-fetch', () => ({ signedFetch: vi.fn() }))

import { destructiveVerdict } from './publish-preflight'

function scene(entityId: string, parcels: string[], base = parcels[0]): unknown {
  return { entityId, parcels, entity: { timestamp: 1, metadata: { scene: { parcels, base } } } }
}

function respond(scenes: unknown[] | null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      scenes === null
        ? new Response('{}', { status: 503 })
        : new Response(JSON.stringify({ scenes, total: scenes.length }), { status: 200 })
    )
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
  // endpoints.ts picks the stack from localStorage — this project runs in node
  vi.stubGlobal('localStorage', { getItem: () => null })
})

describe('destructiveVerdict', () => {
  it('is ok for an empty world — there is nothing such a build could remove', async () => {
    respond([])
    await expect(destructiveVerdict('boedo.dcl.eth', ['0,0'])).resolves.toBe('ok')
  })

  it('is ok when the only scene there is the one we are about to replace', async () => {
    respond([scene('bafyMine', ['0,0'])])
    await expect(destructiveVerdict('boedo.dcl.eth', ['0,0'])).resolves.toBe('ok')
  })

  it('is ok when every scene overlaps us somewhere', async () => {
    respond([scene('bafyA', ['0,0', '1,0'])])
    await expect(destructiveVerdict('boedo.dcl.eth', ['1,0', '2,0'])).resolves.toBe('ok')
  })

  it('blocks when the world holds a scene on ground we never touch', async () => {
    respond([scene('bafyMine', ['0,0']), scene('bafyTheirs', ['10,10'])])
    await expect(destructiveVerdict('boedo.dcl.eth', ['0,0'])).resolves.toBe('block')
  })

  it('forgives whitespace on both sides rather than inventing a block', async () => {
    respond([scene('bafyMine', [' 0, 0 '], '0,0')])
    await expect(destructiveVerdict('boedo.dcl.eth', ['0, 0'])).resolves.toBe('ok')
  })

  it('says unreadable rather than ok when the world could not be read', async () => {
    respond(null)
    await expect(destructiveVerdict('boedo.dcl.eth', ['0,0'])).resolves.toBe('unreadable')
  })
})
