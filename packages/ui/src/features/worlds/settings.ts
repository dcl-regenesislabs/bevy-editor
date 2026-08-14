// A world's own settings — the title, description and thumbnail visitors see
// for the world itself. They live on the world, not on any scene deployed to
// it: a world can host many scenes, each with its own scene.json title, but it
// has a single face of its own.
//   GET  /world/{name}/settings — public; 404 means nothing has been set yet
//   PUT  /world/{name}/settings — signed, multipart; a field left out of the
//        form keeps its current value (the server upserts with COALESCE), so a
//        partial form is a partial update and nothing can be blanked.
import { worldsServer } from './endpoints'
import { signedFetch } from './signed-fetch'

export interface WorldSettings {
  title: string | null
  description: string | null
  thumbnail: string | null // absolute /contents URL, ready to put in an <img>
}

export const EMPTY_SETTINGS: WorldSettings = { title: null, description: null, thumbnail: null }

// mirrors of the worlds-content-server limits, so a creator hits them here
// instead of after a round trip
export const TITLE_MIN = 3
export const TITLE_MAX = 100
export const DESCRIPTION_MIN = 3
export const DESCRIPTION_MAX = 1000
export const THUMBNAIL_MAX_BYTES = 1024 * 1024
export const THUMBNAIL_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

interface SettingsBody {
  title?: string | null
  description?: string | null
  thumbnail_hash?: string | null
}

export function parseSettings(body: SettingsBody): WorldSettings {
  const hash = body.thumbnail_hash ?? null
  return {
    title: body.title ?? null,
    description: body.description ?? null,
    thumbnail: hash !== null && hash !== '' ? `${worldsServer()}/contents/${hash}` : null
  }
}

export async function fetchWorldSettings(name: string): Promise<WorldSettings> {
  const res = await fetch(`${worldsServer()}/world/${encodeURIComponent(name.toLowerCase())}/settings`)
  if (res.status === 404) return EMPTY_SETTINGS // nothing set on this world yet
  if (!res.ok) throw new Error(`Couldn't load this world's settings (${res.status})`)
  return parseSettings((await res.json()) as SettingsBody)
}

export interface WorldSettingsEdit {
  title?: string
  description?: string
  thumbnail?: File
}

export function buildSettingsForm(edit: WorldSettingsEdit): FormData {
  const form = new FormData()
  if (edit.title !== undefined) form.append('title', edit.title)
  if (edit.description !== undefined) form.append('description', edit.description)
  if (edit.thumbnail !== undefined) form.append('thumbnail', edit.thumbnail, edit.thumbnail.name)
  return form
}

export async function saveWorldSettings(name: string, edit: WorldSettingsEdit): Promise<WorldSettings> {
  const res = await signedFetch(`${worldsServer()}/world/${encodeURIComponent(name.toLowerCase())}/settings`, {
    method: 'PUT',
    body: buildSettingsForm(edit)
  })
  if (res.status === 403) throw new Error('Only the world owner, or someone allowed to publish anywhere in it, can change this')
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error !== undefined && body.error !== '' ? body.error : `Couldn't save (${res.status})`)
  }
  const body = (await res.json()) as { settings?: SettingsBody }
  return parseSettings(body.settings ?? {})
}

// `previous` is what the world already has: the server can't blank a field it
// once stored, so clearing one is a dead end we say out loud rather than a save
// that silently does nothing.
export function textError(field: 'title' | 'description', value: string, previous: string | null): string | null {
  const v = value.trim()
  const min = field === 'title' ? TITLE_MIN : DESCRIPTION_MIN
  const max = field === 'title' ? TITLE_MAX : DESCRIPTION_MAX
  if (v === '') return previous !== null ? `The ${field} can't be emptied once set — write a new one instead.` : null
  if (v.length < min) return `Use at least ${min} characters.`
  if (v.length > max) return `Keep it to ${max} characters.`
  return null
}

export function thumbnailError(file: File): string | null {
  if (!THUMBNAIL_TYPES.includes(file.type)) return 'Use a PNG, JPG, GIF or WebP image.'
  if (file.size > THUMBNAIL_MAX_BYTES) return 'Images have to be 1 MB or smaller.'
  return null
}
