// The CLAIM_AIRDROP flow from @dcl/asset-packs src/actions.ts (~line 1544), as a
// standalone module: read the dispenser's asset-packs::Rewards config, look the
// campaign up by dispenser key, and either claim straight away or hand the caller
// a captcha to solve first. Test mode short-circuits, like the Hub's interpreter.
import type { Entity } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'
import { loadRealm } from '../../api'
import { Rewards } from '../../components'
import {
  claimReward,
  fetchCampaigns,
  fetchCaptcha,
  isCaptchaRequired,
  type RewardCaptcha
} from './api'

export const CLAIM_AIRDROP_ACTION = 'claim_airdrop'

export interface PendingCaptcha {
  campaignId: string
  dispenserKey: string
  captcha: RewardCaptcha
}

export type ClaimOutcome =
  | { kind: 'claimed'; message: string }
  | { kind: 'captcha'; pending: PendingCaptcha }
  | { kind: 'test-mode' }
  | { kind: 'error'; message: string }

function failed(message: string): ClaimOutcome {
  return { kind: 'error', message }
}

function beneficiary(): string {
  const player = getPlayer()
  if (player === null || player.isGuest) return ''
  return player.userId.toLowerCase()
}

async function catalyst(): Promise<string> {
  const realm = await loadRealm()
  return realm?.baseUrl ?? ''
}

async function promptCaptcha(campaignId: string, dispenserKey: string): Promise<ClaimOutcome> {
  const [error, captcha] = await fetchCaptcha()
  if (error !== null) return failed(error)
  return { kind: 'captcha', pending: { campaignId, dispenserKey, captcha } }
}

async function claim(
  campaignId: string,
  dispenserKey: string,
  captcha?: { id: string; value: string }
): Promise<ClaimOutcome> {
  const [error, summary] = await claimReward({
    dispenserKey,
    beneficiary: beneficiary(),
    catalyst: await catalyst(),
    captchaId: captcha?.id,
    captchaValue: captcha?.value
  })

  if (error !== null) {
    // The dispenser may demand a captcha even when the campaign flag says
    // otherwise — the newer Hub dispenser script reads the same signal.
    if (captcha === undefined && isCaptchaRequired(error)) return promptCaptcha(campaignId, dispenserKey)
    return failed(error)
  }
  const reward = summary.count === 1 ? 'reward' : 'rewards'
  return { kind: 'claimed', message: `Airdrop released — ${summary.count} ${reward} ${summary.status}.` }
}

/** Runs the airdrop claim for a dispenser entity carrying asset-packs::Rewards. */
export async function releaseAirdrop(entity: Entity): Promise<ClaimOutcome> {
  const rewards = Rewards.getOrNull(entity)
  if (rewards === null) return failed('This item has no Rewards configuration.')

  const { campaignId, dispenserKey, testMode } = rewards
  if (testMode) return { kind: 'test-mode' }
  if (dispenserKey === '') return failed('This item has no dispenser key set.')

  const [error, campaigns] = await fetchCampaigns(dispenserKey)
  if (error !== null) return failed(error)

  const campaign = campaigns.find((entry) => entry.campaignId === campaignId)
  if (campaign === undefined) return failed('No campaign matches this dispenser key.')
  if (!campaign.enabled) return failed('This campaign is disabled on rewards.decentraland.org.')
  if (campaign.requiresCaptcha) return promptCaptcha(campaignId, dispenserKey)

  return claim(campaignId, dispenserKey)
}

export async function submitCaptcha(pending: PendingCaptcha, value: string): Promise<ClaimOutcome> {
  const answer = value.trim()
  if (answer === '') return failed('Enter the captcha to continue.')
  return claim(pending.campaignId, pending.dispenserKey, { id: pending.captcha.id, value: answer })
}
