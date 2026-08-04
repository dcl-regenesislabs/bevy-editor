// World storage service (env keys / data / players).
// Only meaningful for scenes with authoritativeMultiplayer: true. Metadata
// carries the realm (world) name; ADR-44 signed like everything else.
import { storageUrl } from './endpoints'
import { signedFetch } from './signed-fetch'

function storageMetadata(realm: string): Record<string, unknown> {
  return { realm: { serverName: realm }, realmName: realm }
}

export const STORAGE_PAGE = 50

export interface StoragePage<T> {
  items: T[]
  total: number
  offset: number
}

// friendlier error mapping for the storage service specifically
function storageError(status: number): Error {
  if (status === 401 || status === 403) return new Error('Only the world owner can manage storage')
  if (status === 413) return new Error('That value is too large for the storage service')
  if (status === 429) return new Error('Slowing down — the storage service is rate-limiting, try again in a moment')
  return new Error(`The request failed (${status}) — try again`)
}

async function storageReq(realm: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await signedFetch(`${storageUrl()}${path}`, init, storageMetadata(realm))
  if (!res.ok) throw storageError(res.status)
  return res
}

async function storageList<T>(realm: string, path: string, offset: number, pick: (b: unknown) => T[]): Promise<StoragePage<T>> {
  const res = await storageReq(realm, `${path}?limit=${STORAGE_PAGE}&offset=${offset}`, { method: 'GET' })
  const body = (await res.json()) as { data?: unknown; pagination?: { total?: number; offset?: number } }
  const items = pick(body.data)
  return {
    items,
    // trust the server's echo over what we asked for — if it ignores offset the
    // pager stays honest instead of relabeling page 1 as page N
    total: body.pagination?.total ?? items.length,
    offset: body.pagination?.offset ?? offset
  }
}

const asStrings = (d: unknown): string[] => (Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string') : [])
const asKV = (d: unknown): Array<{ key: string; value: unknown }> =>
  Array.isArray(d) ? (d as Array<{ key: string; value: unknown }>).filter((x) => typeof x?.key === 'string') : []

// world-scoped `/values` or one player's `/players/{addr}/values`
const valuesBase = (player?: string): string =>
  player !== undefined ? `/players/${encodeURIComponent(player)}/values` : '/values'

export const listEnvKeys = (realm: string, offset = 0): Promise<StoragePage<string>> =>
  storageList(realm, '/env', offset, asStrings)
export const listStorageValues = (
  realm: string,
  offset = 0,
  player?: string
): Promise<StoragePage<{ key: string; value: unknown }>> => storageList(realm, valuesBase(player), offset, asKV)
export const listStoragePlayers = (realm: string, offset = 0): Promise<StoragePage<string>> =>
  storageList(realm, '/players', offset, asStrings)

// fetch ONE value in full (the list may carry it, but this is the authoritative read)
export async function getStorageValue(realm: string, key: string, player?: string): Promise<unknown> {
  const res = await storageReq(realm, `${valuesBase(player)}/${encodeURIComponent(key)}`, { method: 'GET' })
  const body = (await res.json()) as { value?: unknown }
  return body.value
}

// create or overwrite a data value (any JSON) — world- or player-scoped
export async function putStorageValue(realm: string, key: string, value: unknown, player?: string): Promise<void> {
  await storageReq(realm, `${valuesBase(player)}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  })
}

export async function deleteStorageValue(realm: string, key: string, player?: string): Promise<void> {
  await storageReq(realm, `${valuesBase(player)}/${encodeURIComponent(key)}`, { method: 'DELETE' })
}

export async function putEnvKey(realm: string, key: string, value: string): Promise<void> {
  await storageReq(realm, `/env/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  })
}

export async function deleteEnvKey(realm: string, key: string): Promise<void> {
  await storageReq(realm, `/env/${encodeURIComponent(key)}`, { method: 'DELETE' })
}

// wipe a whole collection: all env keys, all shared data, every player's data,
// or one player's data
export async function clearStorage(realm: string, target: 'env' | 'values' | 'players' | { player: string }): Promise<void> {
  const path = typeof target === 'string' ? `/${target}` : valuesBase(target.player)
  await storageReq(realm, path, { method: 'DELETE', headers: { 'X-Confirm-Delete-All': 'true' } })
}
