// rewards.decentraland.<domain> calls behind the CLAIM_AIRDROP flow, ported from
// @dcl/asset-packs src/actions.ts (fetchCampaignsByDispenserKey / fetchCaptcha /
// requestToken). Every response comes wrapped in an `{ ok, data }` envelope that
// the shared signedFetch helper does not unwrap, so it is narrowed here.
import { ENDPOINTS, request, type Result } from '../../api'

export interface RewardCampaign {
  campaignId: string
  enabled: boolean
  requiresCaptcha: boolean
}

export interface RewardCaptcha {
  id: string
  image: string
  width: number
  height: number
}

export interface ClaimSummary {
  status: string
  count: number
}

export interface ClaimRequest {
  dispenserKey: string
  beneficiary: string
  catalyst: string
  captchaId?: string
  captchaValue?: string
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function envelopeError(json: Record<string, unknown>): string {
  const message = asString(json.error) !== '' ? asString(json.error) : asString(json.message)
  if (message !== '') return message
  const code = asString(json.code)
  return code !== '' ? code : 'the rewards server rejected the request'
}

function unwrap(body: unknown): Result<unknown> {
  const json = asRecord(body)
  if (json.ok === false) return [envelopeError(json), null]
  return [null, json.data]
}

function toCampaign(value: unknown): RewardCampaign | null {
  const json = asRecord(value)
  const campaignId = asString(json.campaign_id)
  if (campaignId === '') return null
  return {
    campaignId,
    enabled: asBoolean(json.enabled, true),
    requiresCaptcha: asBoolean(json.requires_captcha, false)
  }
}

export async function fetchCampaigns(dispenserKey: string): Promise<Result<RewardCampaign[]>> {
  const url = `${ENDPOINTS.rewardsCampaignKeys()}?campaign_key=${encodeURIComponent(dispenserKey)}`
  const [failure, body] = await request<unknown>({ url })
  if (failure !== null) return [failure, null]
  const [invalid, data] = unwrap(body)
  if (invalid !== null) return [invalid, null]
  if (!Array.isArray(data)) return ['the rewards server returned no campaigns for this key', null]
  const campaigns: RewardCampaign[] = []
  for (const entry of data) {
    const campaign = toCampaign(entry)
    if (campaign !== null) campaigns.push(campaign)
  }
  return [null, campaigns]
}

export async function fetchCaptcha(): Promise<Result<RewardCaptcha>> {
  const [failure, body] = await request<unknown>({
    url: ENDPOINTS.rewardsCaptcha(),
    init: { method: 'POST', headers: JSON_HEADERS }
  })
  if (failure !== null) return [failure, null]
  const [invalid, data] = unwrap(body)
  if (invalid !== null) return [invalid, null]
  const json = asRecord(data)
  const id = asString(json.id)
  const image = asString(json.image)
  if (id === '' || image === '') return ['the captcha could not be loaded, try again', null]
  return [null, { id, image, width: asNumber(json.width, 250), height: asNumber(json.height, 100) }]
}

function toSummary(data: unknown): ClaimSummary {
  if (Array.isArray(data)) {
    const first = asRecord(data[0])
    return { status: asString(first.status, 'assigned'), count: data.length }
  }
  const json = asRecord(data)
  return { status: asString(json.status, 'assigned'), count: Object.keys(json).length > 0 ? 1 : 0 }
}

/** True when the server is asking for a captcha rather than reporting a real failure. */
export function isCaptchaRequired(message: string): boolean {
  return message.toLowerCase().includes('captcha')
}

export async function claimReward(claim: ClaimRequest): Promise<Result<ClaimSummary>> {
  const body: Record<string, string> = {
    campaign_key: claim.dispenserKey,
    beneficiary: claim.beneficiary,
    catalyst: claim.catalyst
  }
  if (claim.captchaId !== undefined && claim.captchaValue !== undefined) {
    body.captcha_id = claim.captchaId
    body.captcha_value = claim.captchaValue
  }

  const [failure, response] = await request<unknown>({
    url: ENDPOINTS.rewardsAssign(),
    init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }
  })
  if (failure !== null) return [failure, null]
  const [invalid, data] = unwrap(response)
  if (invalid !== null) return [invalid, null]
  return [null, toSummary(data)]
}
