// What publishing is about to do to a world, as sentences.
//
// They live here rather than in the modal because they are the product of the
// pre-flight, not of a layout: "1 scene" vs "n scenes", "replaces it" vs
// "replaces them", and whether the scene standing on our parcels is ours. A
// sentence in a .tsx is a sentence nothing can test.
import { formatAgo, plural, sceneTitle } from '../../lib/format'
import type { WorldEntry } from '../worlds/inventory'
import type { Footprint, OccupyingScene } from './publish-conflict'

export const NEEDS_DESKTOP = 'Publishing needs the desktop app'
export const SIGN_IN_TO_PUBLISH = 'Sign in to publish'
export const CONFLICT_HEADING = 'A scene is already on these parcels'
export const MOVE_UNAVAILABLE = "Couldn't find free parcels for this scene."
// `npm i @dcl/sdk@latest` — the documented way to update a scene's SDK.
export const SDK_DOCS_URL = 'https://docs.decentraland.org/creator/scenes-sdk7/getting-started/using-the-cli/'

export function pickTimeLine(world: string, total: number, at: string | null): string {
  const has = `${world} already has ${plural(total, 'scene')}.`
  return at === null ? has : `${has} Yours goes to ${at}.`
}

export function conflictConsequence(title: string, world: string, count: number): string {
  return `Publishing “${title}” to ${world} replaces ${count === 1 ? 'it' : 'them'}.`
}

export function scopeLine(world: string): string {
  return `The rest of ${world} stays live. Only scenes on the same parcels are replaced.`
}

export function recoveryLine(scenes: OccupyingScene[]): string {
  const first = scenes[0]
  if (scenes.length === 1 && first !== undefined) {
    return `To bring “${sceneTitle(first.title)}” back you'd publish it again from its own project folder.`
  }
  return "To bring them back you'd publish each again from its own project folder."
}

export function moveLine(to: Footprint): string {
  return `Your scene moves to ${to.base} · ${plural(to.parcels.length, 'parcel')}. This is saved in scene.json.`
}

// A move has to land on ground we know is free, and a world we could not read
// has no free ground we can name. Saying so beats proposing the parcels the
// scene is already colliding on.
export function moveUnreadableLine(world: string): string {
  return `Couldn't read what's in ${world}, so there's nowhere safe to move to. Try again in a moment.`
}

export function successLine(title: string, at: string, world: string, total: number): string {
  return `“${title}” is live at ${at}. ${world} now has ${total} scenes.`
}

export function unreadableWorldLine(world: string): string {
  return `Couldn't check what's in ${world}. Publishing adds your scene without removing anything already there.`
}

export function leaseChangedMessage(world: string): string {
  return `${world} changed while you were reviewing it. Nothing was published. Take another look.`
}

export function oldSdkMessage(world: string): string {
  return `This scene uses an older Decentraland SDK that can't publish next to other scenes. Publishing it now would remove everything else in ${world}.`
}

export function offlineOldSdkMessage(world: string): string {
  return `Couldn't check what's in ${world}, and this scene's Decentraland SDK is too old to publish next to other scenes. Try again when you're back online.`
}

export function parcelPermissionMessage(world: string, parcel: string): string {
  return `This wallet can't publish to ${parcel} in ${world}. Ask the world owner for permission on those parcels.`
}

export function worldPermissionMessage(world: string): string {
  return `You don't have permission to publish to ${world} — ask the world owner to add your wallet to its deployment list.`
}

// 0x1234…abcd — long enough to recognise a wallet, short enough to read.
function shortWallet(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export interface ConflictRow {
  key: string
  line: string
  by: string | null // set only when someone else published it
}

export function conflictRows(scenes: OccupyingScene[], wallet: string | null): ConflictRow[] {
  const mine = wallet?.toLowerCase() ?? null
  return scenes.map((s, i) => {
    const ago = s.timestamp !== null ? ` · published ${formatAgo(s.timestamp)}` : ''
    const by = s.deployer?.toLowerCase() ?? null
    return {
      key: s.entityId ?? `${s.base ?? 'scene'}-${i}`,
      line: `“${sceneTitle(s.title)}” · ${plural(s.parcels.length, 'parcel')}${ago}`,
      by: by !== null && by !== mine ? `Published by ${shortWallet(by)} — not you.` : null
    }
  })
}

// A world's line in the picker. A world holding several scenes is not described
// by its newest one — that sentence read as "publishing replaces this", which
// with --multi-scene is only ever true of the parcels we land on.
export function worldRowLine(w: WorldEntry): string {
  if (!w.sceneCount.known) return "Couldn't read this world"
  if (w.sceneCount.total === 0 || w.deployment === null) return 'Empty'
  if (w.sceneCount.total === 1) return `Live: ${w.deployment.title} · ${formatAgo(w.deployment.timestamp)}`
  const newest = w.scenes.reduce<number | null>(
    (max, s) => (s.timestamp !== null && (max === null || s.timestamp > max) ? s.timestamp : max),
    w.deployment.timestamp
  )
  // formatAgo(null) is the empty string, and "3 scenes · updated " reads as a
  // sentence someone forgot to finish.
  const ago = formatAgo(newest)
  return ago === '' ? `${w.sceneCount.total} scenes` : `${w.sceneCount.total} scenes · updated ${ago}`
}
