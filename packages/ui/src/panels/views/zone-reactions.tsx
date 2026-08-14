import type { ReactNode } from 'react'
import { canAskAssistant, prefillAssistant } from '../ai-store'
import { ZONE_ASKS, listenerWhere, zonePrompt, type ZoneListener } from './zone-listeners'

export function ZoneReactions(props: {
  zoneName: string
  listeners: ZoneListener[]
  /** Reactions on this entity — rendered as `children`, counted here. */
  localCount: number
  busy: boolean
  onAdd: () => void
  children?: ReactNode
}): JSX.Element {
  const { zoneName, listeners, localCount, busy, onAdd, children } = props
  // Reactions living HERE are the children above; re-listing them would print the
  // same filename twice. Only reactions on other entities need reporting, because
  // nothing else in this inspector shows them.
  const elsewhere = listeners.filter((l) => !l.here)
  const total = localCount + elsewhere.length

  if (total === 0) {
    return (
      <div className="eui-zone-none">
        <p className="eui-zone-hint">Nothing reacts to this area yet.</p>
        <AddReaction label="+ Add a reaction" busy={busy} onClick={onAdd} />
        {canAskAssistant() && (
          <>
            <p className="eui-zone-hint">or describe it:</p>
            <div className="eui-zone-asks">
              {ZONE_ASKS.map((ask) => (
                <button
                  key={ask.label}
                  className="eui-zone-ask"
                  onClick={() => prefillAssistant(zonePrompt(ask, zoneName))}
                >
                  {ask.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="eui-zone-head">
        <span className="eui-group-label">Reactions</span>
        <span className="n">{total}</span>
      </div>
      {children}
      {elsewhere.map((l) => (
        <div key={`${l.entityId}:${l.script}`} className="eui-zone-listener">
          <span className="name">{l.script}</span>
          <span className="where">{listenerWhere(l)}</span>
        </div>
      ))}
      <AddReaction label="+ Add another reaction" busy={busy} onClick={onAdd} />
    </>
  )
}

function AddReaction(props: { label: string; busy: boolean; onClick: () => void }): JSX.Element {
  return (
    <button className="eui-btn eui-script-btn" disabled={props.busy} onClick={props.onClick}>
      {props.busy ? 'Adding…' : props.label}
    </button>
  )
}
