import { Fragment } from 'react'
import { Button, ConfirmButton, Spinner } from '../../ds'
import { ACTION_SLOTS, type ActionSlot, type PublishAction, type PublishActions } from './publish-view'

const VARIANT: Record<ActionSlot, 'ghost' | 'danger' | 'primary'> = {
  secondary: 'ghost',
  destructive: 'danger',
  primary: 'primary'
}

export function PublishFooter(props: { actions: PublishActions }): JSX.Element {
  const filled = ACTION_SLOTS.flatMap((slot) => {
    const action = props.actions[slot]
    return action === undefined ? [] : [{ slot, action }]
  })
  const destructiveLeads = props.actions.primary === undefined
  return (
    <>
      {filled.map(({ slot, action }) => {
        const control = <ActionControl slot={slot} action={action} />
        return (
          <Fragment key={slot}>
            {slot === 'destructive' && destructiveLeads ? (
              <span className="eui-publish-foot-lead">{control}</span>
            ) : (
              control
            )}
          </Fragment>
        )
      })}
    </>
  )
}

function ActionControl(props: { slot: ActionSlot; action: PublishAction }): JSX.Element {
  const { slot, action } = props
  if (slot === 'destructive' && action.confirm !== undefined) {
    return (
      <ConfirmButton
        label={action.label}
        confirm={action.confirm}
        disabled={action.disabled}
        onConfirm={action.onClick}
      />
    )
  }
  return (
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
}
