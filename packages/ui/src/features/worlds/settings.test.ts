import { describe, it, expect, vi, beforeEach } from 'vitest'

// The three contracts of the world-settings client that the worlds-content-server
// enforces on its side: a partial form is a partial update, a world with nothing
// set yet is empty rather than an error, and the server's own validation is
// echoed here so a creator sees it before the round trip.

const put = vi.fn()
vi.mock('./signed-fetch', () => ({ signedFetch: (url: string, init?: RequestInit) => put(url, init) }))

import {
  buildSettingsForm,
  EMPTY_SETTINGS,
  fetchWorldSettings,
  parseSettings,
  saveWorldSettings,
  textError,
  thumbnailError
} from './settings'

const png = (bytes = 10): File => new File([new Uint8Array(bytes)], 'cover.png', { type: 'image/png' })

beforeEach(() => {
  put.mockReset()
  vi.unstubAllGlobals()
  // endpoints.ts picks the stack from localStorage — this project runs in node
  vi.stubGlobal('localStorage', { getItem: () => null })
})

describe('parseSettings', () => {
  it('turns the thumbnail hash into a content URL and missing fields into null', () => {
    expect(parseSettings({ title: 'Arena', thumbnail_hash: 'abc123' })).toEqual({
      title: 'Arena',
      description: null,
      thumbnail: 'https://worlds-content-server.decentraland.org/contents/abc123'
    })
    expect(parseSettings({})).toEqual(EMPTY_SETTINGS)
  })
})

describe('fetchWorldSettings', () => {
  it('reads a world that has never been configured as empty, not as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expect(fetchWorldSettings('boedo.dcl.eth')).resolves.toEqual(EMPTY_SETTINGS)
  })

  it('surfaces any other failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    await expect(fetchWorldSettings('boedo.dcl.eth')).rejects.toThrow('500')
  })
})

describe('buildSettingsForm', () => {
  it('sends only the fields that changed — anything omitted keeps its value', () => {
    const form = buildSettingsForm({ title: 'Arena' })
    expect([...form.keys()]).toEqual(['title'])
    expect(form.get('title')).toBe('Arena')
  })

  it('carries the thumbnail as a file, which is how the server detects it', () => {
    const form = buildSettingsForm({ thumbnail: png() })
    expect(form.get('thumbnail')).toBeInstanceOf(File)
  })
})

describe('saveWorldSettings', () => {
  it('returns the settings the server stored', async () => {
    put.mockResolvedValue(
      new Response(JSON.stringify({ settings: { title: 'Arena', thumbnail_hash: 'h' } }), { status: 200 })
    )
    const saved = await saveWorldSettings('Boedo.dcl.eth', { title: 'Arena' })
    expect(saved.title).toBe('Arena')
    expect(put.mock.calls[0][0]).toContain('/world/boedo.dcl.eth/settings')
    expect(put.mock.calls[0][1].method).toBe('PUT')
  })

  it('repeats the validation message the server sent', async () => {
    put.mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid title: x' }), { status: 400 }))
    await expect(saveWorldSettings('boedo.dcl.eth', { title: 'x' })).rejects.toThrow('Invalid title: x')
  })

  it('explains a rejection instead of leaking the status code', async () => {
    put.mockResolvedValue(new Response('', { status: 403 }))
    await expect(saveWorldSettings('boedo.dcl.eth', { title: 'Arena' })).rejects.toThrow(/owner/)
  })
})

describe('validation', () => {
  it('blocks clearing a field the world already has, but not one it never had', () => {
    expect(textError('title', '  ', 'Arena')).toMatch(/can't be emptied/)
    expect(textError('title', '', null)).toBeNull()
  })

  it('mirrors the length limits', () => {
    expect(textError('title', 'ab', null)).toMatch(/at least 3/)
    expect(textError('title', 'a'.repeat(101), null)).toMatch(/100/)
    expect(textError('description', 'a'.repeat(1000), null)).toBeNull()
  })

  it('rejects thumbnails the server would reject', () => {
    expect(thumbnailError(png())).toBeNull()
    expect(thumbnailError(new File([''], 'a.svg', { type: 'image/svg+xml' }))).toMatch(/PNG/)
    expect(thumbnailError(png(1024 * 1024 + 1))).toMatch(/1 MB/)
  })
})
