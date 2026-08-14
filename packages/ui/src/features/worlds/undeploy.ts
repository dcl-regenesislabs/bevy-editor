// Removing ONE scene from a world, addressed by the parcel it sits on.
//
// The whole-world endpoint (DELETE /entities/{world}) undeploys everything in the
// world at once. It is not used here and must not be used anywhere in this app:
// there is no undo, and the scenes it would take down belong to project folders
// this machine may not even have. The scene-scoped endpoint below is the only
// removal Studio performs.
//
// The result is a value, never a throw, so the caller can report a failure inline
// next to the scene it failed on without contradicting the rest of the screen —
// and `reason` separates "someone else's world" from "already gone" from "no
// network", which want three different next moves.
import { parseCoords } from '../../lib/parse-coords'
import { worldsServer } from './endpoints'
import { SIGN_IN_REQUIRED, signedFetch } from './signed-fetch'

export type UndeployReason = 'signed-out' | 'not-allowed' | 'gone' | 'unreachable' | 'bad-coordinate' | 'server'

export type UndeployResult = { ok: true } | { ok: false; reason: UndeployReason; message: string }

function undeployError(reason: UndeployReason, status: number): string {
  switch (reason) {
    case 'signed-out':
      return SIGN_IN_REQUIRED
    case 'not-allowed':
      return 'This wallet is not allowed to remove scenes from this world.'
    case 'gone':
      return 'There is no scene on those parcels any more.'
    case 'unreachable':
      return "Couldn't reach the worlds server — check your connection."
    case 'bad-coordinate':
      return 'That scene has no readable parcel, so it cannot be addressed.'
    default:
      return `The worlds server refused the removal (${status}).`
  }
}

function fail(reason: UndeployReason, status = 0): UndeployResult {
  return { ok: false, reason, message: undeployError(reason, status) }
}

// `coordinate` is passed in rather than derived: the server addresses the scene
// by a parcel of its footprint, and which parcel the caller holds (the base it
// read from the deployment, or the one the creator clicked) is the caller's
// business — this module must not invent one.
export async function undeployScene(world: string, coordinate: string): Promise<UndeployResult> {
  if (parseCoords(coordinate) === null) return fail('bad-coordinate')
  const url = `${worldsServer()}/world/${encodeURIComponent(world.toLowerCase())}/scenes/${encodeURIComponent(coordinate)}`
  let res: Response
  try {
    res = await signedFetch(url, { method: 'DELETE' })
  } catch (e) {
    if (e instanceof Error && e.message === SIGN_IN_REQUIRED) return fail('signed-out')
    return fail('unreachable')
  }
  if (res.ok) return { ok: true }
  if (res.status === 401 || res.status === 403) return fail('not-allowed', res.status)
  if (res.status === 404) return fail('gone', res.status)
  return fail('server', res.status)
}
