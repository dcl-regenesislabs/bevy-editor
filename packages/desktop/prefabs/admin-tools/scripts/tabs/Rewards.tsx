import ReactEcs, { Dropdown, Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { TabId } from '../state'
import type { TabComponent, TabProps, TabSpec } from '../types'
import { Card, CardHeader, TEXT_DIM } from '../ui'
import { RewardsButton } from './rewards/Button'
import { CaptchaPrompt } from './rewards/Captcha'
import { clear, release, selectedEntity, submit } from './rewards/controller'
import { rewardsIcons } from './rewards/icons'
import { clearCaptcha, rewardsTabState, setStatus, type StatusTone } from './rewards/state'

const STATUS_COLOR: Record<StatusTone, Color4> = {
  info: TEXT_DIM,
  error: Color4.create(1, 100 / 255, 100 / 255, 1),
  success: Color4.create(120 / 255, 220 / 255, 150 / 255, 1)
}

export const Rewards: TabComponent = (props: TabProps) => {
  const items = props.config.rewardsControl.rewardItems ?? []
  const icons = rewardsIcons(props.assetBase)
  const selectedIndex = props.state.rewards.selectedIndex
  const entity = selectedEntity(items, selectedIndex)
  const pending = rewardsTabState.pending

  return (
    <Card>
      <CardHeader icon={props.icons.headerRewards} title="AIRDROPS" />

      {items.length === 0 ? (
        <Label
          value="No airdrops linked yet. Add reward dispensers from the Admin Tools inspector."
          fontSize={14}
          color={TEXT_DIM}
          textAlign="middle-left"
          uiTransform={{ width: '100%', height: 'auto' }}
        />
      ) : (
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'column' }}>
          <UiEntity
            uiTransform={{
              width: '100%',
              flexDirection: 'column',
              margin: { bottom: 24 }
            }}
          >
            <Label
              value="<b>Selected Airdrop</b>"
              fontSize={16}
              color={Color4.White()}
              textAlign="middle-left"
              uiTransform={{ margin: { bottom: 12 }, height: 'auto' }}
            />
            <Dropdown
              key="rewards-item-selector"
              acceptEmpty
              emptyLabel="Select your airdrop"
              options={items.map((item) => item.customName)}
              selectedIndex={selectedIndex ?? -1}
              onChange={(index) => {
                props.state.rewards.selectedIndex = index
                clearCaptcha()
                setStatus('')
              }}
              textAlign="middle-left"
              fontSize={14}
              uiTransform={{ width: '100%', height: 40 }}
              uiBackground={{ color: Color4.White() }}
              color={Color4.Black()}
            />
          </UiEntity>

          {pending !== null && entity !== null ? (
            <CaptchaPrompt
              captcha={pending.captcha}
              answer={rewardsTabState.answer}
              busy={rewardsTabState.busy}
              closeIcon={icons.close}
              onChange={(value) => {
                rewardsTabState.answer = value
              }}
              onSubmit={submit}
              onClose={() => {
                clearCaptcha()
                setStatus('Airdrop release cancelled.')
              }}
            />
          ) : (
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'column' }}>
              <Label
                value="<b>Actions</b>"
                fontSize={16}
                color={Color4.White()}
                textAlign="middle-left"
                uiTransform={{ margin: { bottom: 12 }, height: 'auto' }}
              />
              <UiEntity uiTransform={{ flexDirection: 'row' }}>
                <RewardsButton
                  label={rewardsTabState.busy ? 'Releasing…' : 'Release'}
                  icon={icons.send}
                  disabled={entity === null || rewardsTabState.busy}
                  onClick={() => {
                    if (entity !== null) release(entity)
                  }}
                />
                <RewardsButton
                  label="Clear"
                  disabled={entity === null || rewardsTabState.busy}
                  onClick={() => {
                    if (entity !== null) clear(entity)
                  }}
                />
              </UiEntity>
            </UiEntity>
          )}

          {rewardsTabState.status === '' ? null : (
            <Label
              value={rewardsTabState.status}
              fontSize={13}
              color={STATUS_COLOR[rewardsTabState.tone]}
              textAlign="middle-left"
              uiTransform={{ width: '100%', height: 'auto', margin: { top: 16 } }}
            />
          )}
        </UiEntity>
      )}
    </Card>
  )
}

export const rewardsTab: TabSpec = {
  id: TabId.REWARDS,
  icon: 'tabRewards',
  isEnabled: (config) => config.rewardsControl.isEnabled,
  Component: Rewards
}
