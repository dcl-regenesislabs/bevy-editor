// The comms-gatekeeper calls this tab needs on top of scripts/api.ts. The host and
// the signedFetch wrapper come from there; only the request shapes the shared module
// does not expose (admin-by-NAME, the /scene-bans writes) are declared here.
import { ENDPOINTS, request, type Result } from '../../api'

export type AdminRef = { admin: string } | { name: string }
export type BanRef = { banned_address: string } | { banned_name: string }

export async function postSceneAdmin(ref: AdminRef): Promise<Result<unknown>> {
  return request({
    url: ENDPOINTS.sceneAdmin(),
    init: { method: 'POST', headers: {}, body: JSON.stringify(ref) }
  })
}

export async function deleteSceneAdmin(address: string): Promise<Result<unknown>> {
  return request({
    url: ENDPOINTS.sceneAdmin(),
    init: { method: 'DELETE', headers: {}, body: JSON.stringify({ admin: address }) }
  })
}

export async function postSceneBan(ref: BanRef): Promise<Result<unknown>> {
  return request({
    url: ENDPOINTS.sceneBans(),
    init: { method: 'POST', headers: {}, body: JSON.stringify(ref) }
  })
}

export async function deleteSceneBan(address: string): Promise<Result<unknown>> {
  return request({
    url: ENDPOINTS.sceneBans(),
    init: { method: 'DELETE', headers: {}, body: JSON.stringify({ banned_address: address }) }
  })
}
