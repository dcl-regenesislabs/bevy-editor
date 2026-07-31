// Video-tab endpoints: the stream key lifecycle (/scene-stream-access) and the
// DCL Cast room (/cast/*), both on comms-gatekeeper. Port of @dcl/asset-packs
// src/admin-toolkit-ui/VideoControl/api.ts.
//
// The gatekeeper answers in snake_case; the Hub runs every body through a generic
// toCamelCase. Reading both spellings per field keeps the payload typed instead of
// pushing an `any` through a key rewriter.
import { getActiveVideoStreams } from '~system/CommsApi'
import { ENDPOINTS, request, type Result } from '../../api'

export interface StreamKey {
  streamingUrl: string
  streamingKey: string
  createdAt: number
  endsAt: number
}

export interface CastRoom {
  streamLink: string
  watcherLink: string
  streamingKey: string
  placeId: string
  placeName: string
  expiresAt: number
  expiresInDays: number
}

export interface CastTrack {
  sid: string
  identity: string
  sourceType: number
  name: string
}

export interface CastParticipant {
  identity: string
  name: string
  tracks: CastTrack[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function readNumber(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

function toStreamKey(body: unknown): StreamKey {
  const source = isRecord(body) ? body : {}
  return {
    streamingUrl: readString(source, 'streamingUrl', 'streaming_url'),
    streamingKey: readString(source, 'streamingKey', 'streaming_key'),
    createdAt: readNumber(source, 'createdAt', 'created_at'),
    endsAt: readNumber(source, 'endsAt', 'ends_at')
  }
}

function toCastRoom(body: unknown): CastRoom {
  const source = isRecord(body) ? body : {}
  return {
    streamLink: readString(source, 'streamLink', 'stream_link'),
    watcherLink: readString(source, 'watcherLink', 'watcher_link'),
    streamingKey: readString(source, 'streamingKey', 'streaming_key'),
    placeId: readString(source, 'placeId', 'place_id'),
    placeName: readString(source, 'placeName', 'place_name'),
    expiresAt: readNumber(source, 'expiresAt', 'expires_at'),
    expiresInDays: readNumber(source, 'expiresInDays', 'expires_in_days')
  }
}

async function streamKeyRequest(method?: string): Promise<Result<StreamKey>> {
  const init = method === undefined ? undefined : { method, headers: {} }
  const [error, body] = await request<unknown>({ url: ENDPOINTS.streamAccess(), init })
  return error === null ? [null, toStreamKey(body)] : [error, null]
}

export async function getStreamKey(): Promise<Result<StreamKey>> {
  return streamKeyRequest()
}

export async function generateStreamKey(): Promise<Result<StreamKey>> {
  return streamKeyRequest('POST')
}

export async function revokeStreamKey(): Promise<Result<StreamKey>> {
  return streamKeyRequest('DELETE')
}

export async function resetStreamKey(): Promise<Result<StreamKey>> {
  return streamKeyRequest('PUT')
}

export async function getCastRoom(): Promise<Result<CastRoom>> {
  const [error, body] = await request<unknown>({ url: ENDPOINTS.castStreamLink() })
  return error === null ? [null, toCastRoom(body)] : [error, null]
}

export async function getPresenters(): Promise<Result<string[]>> {
  const [error, body] = await request<unknown>({ url: ENDPOINTS.castPresenters() })
  if (error !== null) return [error, null]
  const list = Array.isArray(body) ? body : isRecord(body) ? body.addresses : undefined
  if (!Array.isArray(list)) return [null, []]
  return [null, list.filter((item): item is string => typeof item === 'string')]
}

export async function promotePresenter(address: string): Promise<Result<unknown>> {
  return request({
    url: `${ENDPOINTS.castPresenters()}/${address}`,
    init: { method: 'PUT', headers: {} }
  })
}

// A cast admin has to hold the presenter role before their browser tab can push a
// track into the room; the Hub promotes silently on every mount.
export async function ensurePresenterRole(address: string): Promise<void> {
  const [error, presenters] = await getPresenters()
  if (error !== null) return
  const lower = address.toLowerCase()
  if (presenters.some((presenter) => presenter.toLowerCase() === lower)) return
  await promotePresenter(lower)
}

export const SOURCE_LABELS: Record<number, string> = {
  1: 'Camera',
  2: 'Screen',
  3: 'Presentation'
}

export function sourceLabel(sourceType: number): string {
  return SOURCE_LABELS[sourceType] ?? 'Unknown'
}

export function trackName(track: CastTrack): string {
  return `${track.name} - ${sourceLabel(track.sourceType)}`
}

export async function getActiveStreams(): Promise<CastTrack[]> {
  try {
    const response = await getActiveVideoStreams({})
    return response.streams.map((stream) => ({
      sid: stream.trackSid,
      identity: stream.identity,
      sourceType: stream.sourceType,
      name: stream.identity
    }))
  } catch {
    return []
  }
}

export function groupTracks(tracks: CastTrack[]): CastParticipant[] {
  const byIdentity = new Map<string, CastParticipant>()
  for (const track of tracks) {
    const existing = byIdentity.get(track.identity)
    if (existing !== undefined) existing.tracks.push(track)
    else byIdentity.set(track.identity, { identity: track.identity, name: track.name, tracks: [track] })
  }
  return Array.from(byIdentity.values())
}
