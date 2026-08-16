// The questions asked BEFORE sdk-commands is spawned: where does this scene
// sit, what can this build of the CLI do, and may this wallet write there.
// Every one of them fails open except the capability probe — a check that
// blocks on its own failure would be a worse bug than the one it guards.
import type { DeployCapability } from '@dcl-editor/contract'
import { worldsServer } from '../worlds/endpoints'
import { fetchWorldPermissions, fetchWorldScenes } from '../worlds/inventory'
import { footprintOf, type Footprint } from './publish-conflict'
import { parcelPermissionMessage, worldPermissionMessage } from './publish-copy'

// The scene's own parcels, as scene.json holds them. Null when we can't read
// them: the collision question then can't be asked at all, and the pick-time
// line drops the sentence that would have named a destination.
export async function readLocalFootprint(dir: string): Promise<Footprint | null> {
  const read = window.editorShell?.sceneSettings
  if (read === undefined) return null
  try {
    const s = await read(dir)
    const parcels = footprintOf(s.parcels)
    if (parcels.length === 0) return null
    return { base: footprintOf([s.base])[0] ?? parcels[0], parcels }
  } catch {
    return null
  }
}

export async function readCapability(dir: string): Promise<DeployCapability> {
  const probe = window.editorShell?.deployCapability
  if (probe === undefined) return { kind: 'unknown' }
  try {
    return await probe(dir)
  } catch {
    return { kind: 'unknown' }
  }
}

// Advisory (the server re-checks authoritatively at upload). Passing
// --multi-scene is exactly what moves the server's gate from "may this wallet
// touch the world" to "may it touch THESE parcels", and a collaborator never
// sees the linker dapp's own check — so this is the only warning they get.
export async function deployDenial(world: string, wallet: string, parcels: string[]): Promise<string | null> {
  const p = await fetchWorldPermissions(world).catch(() => null)
  if (p === null) return null // can't tell — let the server decide
  if (p.owner === wallet || p.deployment.type === 'unrestricted') return null
  if (!p.deployment.wallets.includes(wallet)) return worldPermissionMessage(world)
  return await parcelDenial(world, wallet, parcels)
}

// The per-parcel list the linker dapp reads. Deliberately fail-open on every
// ambiguity — an unreachable endpoint, a shape we don't recognise, or an empty
// list is not proof of a denial, and refusing to publish on a guess is worse
// than letting the server answer.
async function parcelDenial(world: string, wallet: string, parcels: string[]): Promise<string | null> {
  if (parcels.length === 0) return null
  try {
    const url = `${worldsServer()}/world/${encodeURIComponent(world)}/permissions/deployment/address/${encodeURIComponent(wallet)}/parcels`
    const res = await fetch(url)
    if (!res.ok) return null
    const allowed = coordList(await res.json())
    if (allowed === null || allowed.length === 0) return null
    const free = new Set(allowed)
    const denied = footprintOf(parcels).find((c) => !free.has(c))
    return denied === undefined ? null : parcelPermissionMessage(world, denied)
  } catch {
    return null
  }
}

// Accepts the shapes such a list is served in — a bare array, `{parcels}` or
// `{allowed}`, of "x,y" strings or {x,y} pairs — and null for anything else.
function coordList(body: unknown): string[] | null {
  const wrapper = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  const raw = Array.isArray(body) ? body : (wrapper?.parcels ?? wrapper?.allowed)
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  for (const c of raw) {
    if (typeof c === 'string') out.push(c)
    else if (typeof c === 'object' && c !== null) {
      const p = c as { x?: unknown; y?: unknown }
      if (typeof p.x === 'number' && typeof p.y === 'number') out.push(`${p.x},${p.y}`)
    }
  }
  return footprintOf(out)
}

// Exactly what the CLI's own destructive branch triggers on. Its condition is
// three deep, not one: `isWorld && !multiScene && worldName`, THEN the world has
// to hold scenes, THEN `getScenesOnOtherParcels` has to be non-empty — deployed
// scenes this publish does not overlap. A build with no --multi-scene publishing
// into an empty world (or onto its own parcels) never warns, never prompts and
// never deletes, so blocking on the SDK version alone refuses a publish that was
// never at risk and offers "update your SDK" as the only way out.
//
// This mirrors that last condition, and it is the thing worth checking: the
// scenes such a build would remove.
export async function destructiveVerdict(world: string, parcels: string[]): Promise<'ok' | 'block' | 'unreadable'> {
  const { scenes, sceneCount } = await fetchWorldScenes(world)
  if (!sceneCount.known) return 'unreadable'
  const mine = new Set(footprintOf(parcels))
  const others = scenes.filter((s) => !footprintOf(s.parcels).some((c) => mine.has(c)))
  return others.length > 0 ? 'block' : 'ok'
}
