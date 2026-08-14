import { beforeEach, describe, expect, it, vi } from 'vitest'

// The memory that tells a republish from a replacement. What it has to get
// right: a folder recognises only the entity IT published, a second project in
// the same world gets nothing, and every failure mode (no storage, corrupt
// value, a full disk) degrades to "I don't know" — which costs one confirmation
// and never waves a replacement through.
import { lastPublishedEntity, rememberPublishedEntity } from './publish-identity'

const KEY = 'dcl-editor:published-entities'

function fakeStorage(over: Partial<Storage> = {}): void {
  const map = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    ...over
  })
}

beforeEach(() => {
  vi.unstubAllGlobals()
  fakeStorage()
})

describe('publish-identity', () => {
  it('knows nothing until a publish succeeds', () => {
    expect(lastPublishedEntity('/p/gallery', 'boedo.dcl.eth')).toBeNull()
  })

  it('remembers per project folder AND per world', () => {
    rememberPublishedEntity('/p/gallery', 'boedo.dcl.eth', 'bafyGallery')
    expect(lastPublishedEntity('/p/gallery', 'boedo.dcl.eth')).toBe('bafyGallery')
    expect(lastPublishedEntity('/p/party', 'boedo.dcl.eth')).toBeNull()
    expect(lastPublishedEntity('/p/gallery', 'other.dcl.eth')).toBeNull()
  })

  it('reads the world name the way the flow lowercases it', () => {
    rememberPublishedEntity('/p/gallery', 'Boedo.DCL.eth', 'bafyGallery')
    expect(lastPublishedEntity('/p/gallery', 'boedo.dcl.eth')).toBe('bafyGallery')
  })

  it('replaces the entry when the same folder publishes again', () => {
    rememberPublishedEntity('/p/gallery', 'boedo.dcl.eth', 'bafyOne')
    rememberPublishedEntity('/p/gallery', 'boedo.dcl.eth', 'bafyTwo')
    expect(lastPublishedEntity('/p/gallery', 'boedo.dcl.eth')).toBe('bafyTwo')
  })

  it('ignores an empty entity id rather than remembering a lie', () => {
    rememberPublishedEntity('/p/gallery', 'boedo.dcl.eth', '')
    expect(lastPublishedEntity('/p/gallery', 'boedo.dcl.eth')).toBeNull()
  })

  it('forgets the oldest entries instead of growing without bound', () => {
    for (let i = 0; i < 205; i++) rememberPublishedEntity(`/p/${i}`, 'boedo.dcl.eth', `bafy${i}`)
    expect(lastPublishedEntity('/p/0', 'boedo.dcl.eth')).toBeNull()
    expect(lastPublishedEntity('/p/204', 'boedo.dcl.eth')).toBe('bafy204')
    expect(lastPublishedEntity('/p/5', 'boedo.dcl.eth')).toBe('bafy5')
  })

  it('answers "I do not know" for a corrupt or wrongly-shaped value', () => {
    localStorage.setItem(KEY, 'not json')
    expect(lastPublishedEntity('/p/gallery', 'boedo.dcl.eth')).toBeNull()
    localStorage.setItem(KEY, '["bafyGallery"]')
    expect(lastPublishedEntity('/p/gallery', 'boedo.dcl.eth')).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ '/p/gallery\nboedo.dcl.eth': 7 }))
    expect(lastPublishedEntity('/p/gallery', 'boedo.dcl.eth')).toBeNull()
  })

  it('survives storage that throws on read and on write', () => {
    fakeStorage({
      getItem: () => {
        throw new Error('denied')
      }
    })
    expect(lastPublishedEntity('/p/gallery', 'boedo.dcl.eth')).toBeNull()
    fakeStorage({
      setItem: () => {
        throw new Error('quota')
      }
    })
    expect(() => rememberPublishedEntity('/p/gallery', 'boedo.dcl.eth', 'bafyGallery')).not.toThrow()
  })
})
