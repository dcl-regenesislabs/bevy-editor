import { Fragment } from 'react'
import { Button, ConfirmButton, Spinner } from '../../ds'
import { ACTION_SLOTS, type ActionSlot, type PublishAction, type PublishActions } from './publish-view'

const VARIANT: Record<ActionSlot, 'ghost' | 'danger' | 'primary'> = {
  secondary: 'ghost',
  destructive: 'danger',
  primary: 'primary'
}

export function PublishFooter(props: { actions: PublishActions }): JSX.Element {
  const filled: Array<readonly [ActionSlot, PublishAction]> = ACTION_SLOTS.flatMap((slot) => {
    const action = props.actions[slot]
    return action === undefined ? [] : [[slot, action] as const]
  })
  const holdsTrailingEdge = props.actions.primary === undefined
  return (
    <>
      {filled.map(([slot, action]) => {
        const control =
          slot === 'destructive' && action.confirm !== undefined ? (
            <ConfirmButton
              label={action.label}
              confirm={action.confirm}
              disabled={action.disabled}
              onConfirm={action.onClick}
            />
          ) : (
            <Button variant={VARIANT[slot]} disabled={action.disabled} onClick={action.onClick}>
              {action.busy === true ? (
                <span className="eui-publish-btn">
                  <Spinner size={12} />
                  {action.label}
                </span>
              ) : (
                action.label
              )}
            </Button>
          )
        return slot === 'destructive' && holdsTrailingEdge ? (
          <span key={slot} className="eui-publish-foot-lead">
            {control}
          </span>
        ) : (
          <Fragment key={slot}>{control}</Fragment>
        )
      })}
    </>
  )
}
