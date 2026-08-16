// What publishing is about to do to a world, as sentences.
//
// They live here rather than in the modal because they are the product of the
// pre-flight, not of a layout: "1 scene" vs "n scenes", "replaces it" vs
// "replaces them", and whether the scene standing on our parcels is ours. A
// sentence in a .tsx is a sentence nothing can test.
import { formatAgo, plural, sceneTitle } from '../../lib/format'
import type { WorldEntry } from '../worlds/inventory'
import { newestScene } from '../worlds/scene-label'
import type { Footprint, OccupyingScene } from './publish-conflict'

export const NEEDS_DESKTOP = 'Publishing needs the desktop app'
export const SIGN_IN_TO_PUBLISH = 'Sign in to publish'
export const SIGN_IN_NOTE = 'Publishing proves the world is yours — sign in with Decentraland first.'
export const CONFLICT_HEADING = 'A scene is already on these parcels'
export const MOVE_UNAVAILABLE = "Couldn't find free parcels for this scene."
// `npm i @dcl/sdk@latest` — the documented way to update a scene's SDK.
export const SDK_DOCS_URL = 'https://docs.decentraland.org/creator/scenes-sdk7/getting-started/using-the-cli/'

// ---- headlines ----
//
// Every state of the dialog owns exactly one headline, because the shared body
// (ds StateBlock) requires one. Before that, the refusals — the most
// consequential screens in the flow — had none, and read as a stray dim
// sentence floating under an exclamation mark. The words are the approved
// messages' own rather than written fresh, so no new product vocabulary enters
// through a layout fix.
//
// Taken OUT of those messages, not copied from them: a headline and a note that
// both open with the same clause put one sentence on screen twice, in two type
// sizes, a line apart. Each note below carries only what its headline does not.
export const SDK_TOO_OLD_HEADING = "This scene's Decentraland SDK can't publish next to other scenes"
export const NO_NAME_HEADING = "You don't own a Decentraland NAME yet"
export const NO_NAME_NOTE = 'A NAME is the world you publish to.'
export const WORLDS_FAILED_HEADING = "Couldn't load your worlds"

export function sceneHeadline(title: string): string {
  return `Publishing “${title}”`
}

export function unreadableWorldHeading(world: string): string {
  return `Couldn't check what's in ${world}`
}

// The pre-flight had no rendering of its own: confirming a move dropped the
// review and left `checking` falling through to the world picker, so the dialog
// appeared to rewind to the start. It is a step of the same job as building and
// uploading, and now says so.
export function checkingHeadline(world: string): string {
  return `Checking ${world}`
}
export const CHECKING_NOTE = "Reading what's already on your parcels."
export const BUILDING_NOTE = 'Bundling code and assets — this can take a minute the first time.'
export const UPLOADING_NOTE = 'Sending your scene to Decentraland. Almost there…'

export function publishingHeadline(world: string): string {
  return `Publishing to ${world}`
}

// The ✕ hides a running publish rather than stopping it. That consequence is
// taught twice in copy — the ✕'s own tooltip and this caption — and never with a
// second button that does what the ✕ already does.
export const KEEPS_PUBLISHING = 'Publishing continues if you close this.'
export const STOP_PUBLISHING = 'Stop publishing?'
// A disclosure header is a label, not a verb: "Show details" was the string that
// made a collapsible section read as a call to action beside the real ones.
export const BUILD_LOG = 'Build log'

export function pickTimeLine(world: string, total: number, at: string | null): string {
  const has = `${world} already has ${plural(total, 'scene')}.`
  return at === null ? has : `${has} Yours goes to ${at}.`
}

// `title` is null when the job on screen belongs to a DIFFERENT scene folder
// than the one that opened the dialog — publishing is a module singleton, so the
// modal can legitimately be showing someone else's job, and naming this scene in
// its sentence would be a lie. The named form is unchanged.
export function conflictConsequence(title: string | null, world: string, count: number): string {
  const what = count === 1 ? 'it' : 'them'
  if (title === null) return `Publishing your scene to ${world} replaces ${what}.`
  return `Publishing “${title}” to ${world} replaces ${what}.`
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

export function successLine(title: string | null, at: string, world: string, total: number): string {
  const lead = title === null ? 'Your scene is' : `“${title}” is`
  return `${lead} live at ${at}. ${world} now has ${total} scenes.`
}

// The success sentence for a world we could not count: it says what changed for
// visitors instead of where the scene landed.
export function successFallbackLine(title: string | null): string {
  const lead = title === null ? 'Your scene is' : `“${title}” is`
  return `${lead} now what visitors see at your world.`
}

// The rest of `unreadableWorldHeading`'s sentence: publishing is still allowed,
// and this is what it does when we could not read the world first.
export const UNREADABLE_CONSEQUENCE = 'Publishing adds your scene without removing anything already there.'

export function leaseChangedMessage(world: string): string {
  return `${world} changed while you were reviewing it. Nothing was published. Take another look.`
}

// What a block costs, given that SDK_TOO_OLD_HEADING has already said what it
// is. `block()` records one of these as the block's message, so the sentence a
// creator reads has one definition and the dialog states the refusal once.
export function oldSdkNote(world: string): string {
  return `Publishing it now would remove everything else in ${world}.`
}

export function offlineOldSdkNote(world: string): string {
  return `${unreadableWorldHeading(world)}. Try again when you're back online.`
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
// by any one of them — that sentence read as "publishing replaces this", which
// with --multi-scene is only ever true of the parcels we land on. Where one
// scene IS named it is the newest, never the head of the list: the scenes arrive
// created_at ASC, so the head is the world's oldest scene.
export function worldRowLine(w: WorldEntry): string {
  if (!w.sceneCount.known) return "Couldn't read this world"
  if (w.sceneCount.total === 0) return 'Empty'
  const newest = newestScene(w.scenes)
  // formatAgo(null) is the empty string, and "3 scenes · updated " reads as a
  // sentence someone forgot to finish.
  const ago = formatAgo(newest?.timestamp ?? null)
  if (w.sceneCount.total === 1 && newest !== null) {
    const name = sceneTitle(newest.title)
    return ago === '' ? `Live: ${name}` : `Live: ${name} · ${ago}`
  }
  const count = plural(w.sceneCount.total, 'scene')
  return ago === '' ? count : `${count} · updated ${ago}`
}
