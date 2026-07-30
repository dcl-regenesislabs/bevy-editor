import ReactEcs, { Dropdown, Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { dispatchAction, getActions, SUPPORTED_ACTIONS } from '../actions'
import type { ActionEntry } from '../components'
import { TabId } from '../state'
import type { TabComponent, TabProps, TabSpec } from '../types'
import { Card, CardHeader, TextButton, TEXT_DIM } from '../ui'
import {
  selectedItem,
  selectSmartItem,
  setVisible,
  smartItemList,
  smartItemsUi,
  uiStateFor,
  type SmartItemEntry
} from './smart-items/selection'

const MUTED = Color4.create(187 / 255, 187 / 255, 187 / 255, 1)

function FieldLabel(props: { value: string }): ReactEcs.JSX.Element {
  return (
    <Label
      value={`<b>${props.value}</b>`}
      fontSize={16}
      color={Color4.White()}
      textAlign="middle-left"
      uiTransform={{ width: '100%', height: 24, margin: { bottom: 12 } }}
    />
  )
}

function play(props: TabProps, item: SmartItemEntry, action: ActionEntry): void {
  const ran = dispatchAction(item.entity, action.name)
  smartItemsUi.lastPlayed = action.name
  smartItemsUi.lastPlayedFailed = !ran || !SUPPORTED_ACTIONS.includes(action.type)
  uiStateFor(props.state, item).selectedAction = action.name
}

export const SmartItemActions: TabComponent = (props: TabProps) => {
  const items = smartItemList(props.config, props.self)
  const item = selectedItem(props.state, items)
  const actions = item === undefined ? [] : getActions(item.entity)
  const ui = item === undefined ? undefined : uiStateFor(props.state, item)
  const actionIndex =
    ui === undefined ? -1 : actions.findIndex((action) => action.name === ui.selectedAction)
  const action = actionIndex >= 0 ? actions[actionIndex] : undefined
  const unsupported = action !== undefined && !SUPPORTED_ACTIONS.includes(action.type)

  return (
    <Card>
      <CardHeader icon={props.icons.headerSmartItems} title="SMART ITEM ACTIONS" />

      {items.length === 0 ? (
        <Label
          value="No smart items linked yet. Add them from the Admin Tools inspector."
          fontSize={14}
          color={TEXT_DIM}
          textAlign="middle-left"
          uiTransform={{ width: '100%', height: 'auto' }}
        />
      ) : (
        <UiEntity uiTransform={{ flexDirection: 'column', width: '100%' }}>
          <UiEntity uiTransform={{ flexDirection: 'column', margin: { bottom: 24 } }}>
            <FieldLabel value="Selected Smart Item" />
            <Dropdown
              key="smart-item-selector"
              acceptEmpty
              emptyLabel="Select Smart Item"
              options={items.map((entry) => entry.customName)}
              selectedIndex={props.state.smartItems.selectedIndex ?? -1}
              onChange={(index) => selectSmartItem(props.state, items, index)}
              textAlign="middle-left"
              fontSize={14}
              color={Color4.Black()}
              uiBackground={{ color: Color4.White() }}
              uiTransform={{ width: '100%', height: 40 }}
            />
          </UiEntity>

          <UiEntity uiTransform={{ flexDirection: 'column', margin: { bottom: 16 } }}>
            <FieldLabel value="Actions" />
            {actions.length === 0 ? (
              <Label
                value={
                  item === undefined
                    ? 'Pick a smart item to see its actions.'
                    : 'This smart item has no actions authored on it.'
                }
                fontSize={14}
                color={TEXT_DIM}
                textAlign="middle-left"
                uiTransform={{ width: '100%', height: 22 }}
              />
            ) : (
              <Dropdown
                key={`smart-item-actions-${item === undefined ? 'none' : (item.entity as number)}`}
                acceptEmpty
                emptyLabel="Select Action"
                options={actions.map((entry) => entry.name)}
                selectedIndex={actionIndex}
                disabled={item === undefined}
                onChange={(index) => {
                  if (item === undefined || index < 0 || index >= actions.length) return
                  uiStateFor(props.state, item).selectedAction = actions[index].name
                  smartItemsUi.lastPlayed = ''
                  smartItemsUi.lastPlayedFailed = false
                }}
                textAlign="middle-left"
                fontSize={14}
                color={Color4.Black()}
                uiBackground={{ color: item === undefined ? Color4.Gray() : Color4.White() }}
                uiTransform={{ width: '100%', height: 40 }}
              />
            )}
          </UiEntity>

          <UiEntity uiTransform={{ flexDirection: 'row', height: 40 }}>
            <TextButton
              label="Play Action"
              disabled={item === undefined || action === undefined}
              onClick={() => {
                if (item !== undefined && action !== undefined) play(props, item, action)
              }}
            />
            <TextButton
              label={ui !== undefined && ui.visible ? 'Hide Entity' : 'Show Entity'}
              disabled={item === undefined}
              onClick={() => {
                if (item !== undefined && ui !== undefined) setVisible(props.state, item, !ui.visible)
              }}
            />
          </UiEntity>

          <UiEntity
            uiTransform={{
              width: '100%',
              minHeight: 24,
              margin: { top: 10 },
              display: unsupported || smartItemsUi.lastPlayed !== '' ? 'flex' : 'none'
            }}
          >
            <Label
              value={
                unsupported
                  ? `"${action?.type ?? ''}" is not one of the action types this panel can run.`
                  : smartItemsUi.lastPlayedFailed
                    ? `Could not play "${smartItemsUi.lastPlayed}".`
                    : `Played "${smartItemsUi.lastPlayed}".`
              }
              fontSize={13}
              color={MUTED}
              textAlign="middle-left"
              uiTransform={{ width: '100%', height: 'auto' }}
            />
          </UiEntity>
        </UiEntity>
      )}
    </Card>
  )
}

export const smartItemActionsTab: TabSpec = {
  id: TabId.SMART_ITEMS,
  icon: 'tabSmartItems',
  isEnabled: (config) => config.smartItemsControl.isEnabled,
  Component: SmartItemActions
}
