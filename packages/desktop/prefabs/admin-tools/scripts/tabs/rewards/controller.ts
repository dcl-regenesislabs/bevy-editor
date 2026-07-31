// What the Release / Clear / Submit buttons do. Same contract as the Creator Hub's
// RewardsControl: Release runs the dispenser's "Airdrop" action and Clear runs its
// "Invisible" one. The names are the Hub's convention, so an action of the matching
// *type* is accepted as a fallback for items authored with different labels.
import type { Entity } from '@dcl/sdk/ecs'
import { ActionType, getActions, runAction } from '../../actions'
import type { ActionEntry, RewardItemRef } from '../../components'
import { Rewards } from '../../components'
import { CLAIM_AIRDROP_ACTION, releaseAirdrop, submitCaptcha, type ClaimOutcome } from './claim'
import { clearCaptcha, rewardsTabState, setStatus } from './state'

export const RELEASE_ACTION = 'Airdrop'
export const CLEAR_ACTION = 'Invisible'

export function selectedEntity(
  items: readonly RewardItemRef[],
  index: number | undefined
): Entity | null {
  if (index === undefined || index < 0 || index >= items.length) return null
  return items[index].entity as Entity
}

function findAction(entity: Entity, name: string, type: string): ActionEntry | undefined {
  const actions = getActions(entity)
  return actions.find((action) => action.name === name) ?? actions.find((action) => action.type === type)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function applyOutcome(outcome: ClaimOutcome): void {
  switch (outcome.kind) {
    case 'claimed':
      clearCaptcha()
      setStatus(outcome.message, 'success')
      break
    case 'captcha':
      rewardsTabState.pending = outcome.pending
      rewardsTabState.answer = ''
      setStatus('Solve the captcha to release this airdrop.')
      break
    case 'test-mode':
      clearCaptcha()
      setStatus('Test mode is on for this item — nothing was assigned.')
      break
    case 'error':
      setStatus(outcome.message, 'error')
      break
  }
}

async function run(task: Promise<ClaimOutcome>): Promise<void> {
  rewardsTabState.busy = true
  try {
    applyOutcome(await task)
  } catch (error) {
    setStatus(describe(error), 'error')
  } finally {
    rewardsTabState.busy = false
  }
}

export function release(entity: Entity): void {
  if (rewardsTabState.busy) return
  const action = findAction(entity, RELEASE_ACTION, CLAIM_AIRDROP_ACTION)

  if (action !== undefined && action.type !== CLAIM_AIRDROP_ACTION) {
    runAction(entity, action)
    clearCaptcha()
    setStatus(`Ran "${action.name}" on this item.`, 'success')
    return
  }

  clearCaptcha()
  setStatus('Releasing airdrop…')
  void run(releaseAirdrop(entity))
}

export function clear(entity: Entity): void {
  if (rewardsTabState.busy) return
  if (Rewards.getOrNull(entity) === null) {
    setStatus('This item has no Rewards configuration.', 'error')
    return
  }

  const action = findAction(entity, CLEAR_ACTION, ActionType.SET_VISIBILITY)
  if (action === undefined) {
    setStatus(`This item has no "${CLEAR_ACTION}" action to clear it with.`, 'error')
    return
  }

  runAction(entity, action)
  clearCaptcha()
  setStatus('Airdrop cleared.', 'success')
}

export function submit(): void {
  const pending = rewardsTabState.pending
  if (pending === null || rewardsTabState.busy) return
  setStatus('Checking the captcha…')
  void run(submitCaptcha(pending, rewardsTabState.answer))
}
