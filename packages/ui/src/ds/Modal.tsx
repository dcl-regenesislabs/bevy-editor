// The one modal shell. Promoted from panels/Dialogs.tsx and extended for the
// publish flow: `scrimClose` (turn off backdrop-click while a job runs) and an
// optional header ✕ whose close is always allowed (hide ≠ cancel).
import { useEffect, type ReactNode } from 'react'
import css from './Modal.css?inline'
import { registerCss } from './styles/registry'

registerCss('ds/Modal', 'primitives', css)

export function Modal(props: {
  title?: ReactNode
  className?: string
  onClose?: () => void
  scrimClose?: boolean // default true; set false while busy
  closeX?: boolean // render a header ✕ (uses onClose)
  closeTip?: string
  footer?: ReactNode
  children: ReactNode
}): JSX.Element {
  const { onClose } = props
  useEffect(() => {
    if (onClose === undefined) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const scrim = props.onClose !== undefined && props.scrimClose !== false
  return (
    <div className="eui-modal-backdrop" onClick={scrim ? props.onClose : undefined}>
      <div className={`eui-modal ${props.className ?? ''}`} onClick={(e) => e.stopPropagation()}>
        {props.title !== undefined && (
          <div className="eui-modal-head">
            {props.title}
            {props.closeX === true && (
              <>
                <span style={{ flex: 1 }} />
                <button className="eui-modal-x" data-tip={props.closeTip} onClick={props.onClose}>
                  ✕
                </button>
              </>
            )}
          </div>
        )}
        <div className="eui-modal-body">{props.children}</div>
        {props.footer !== undefined && <div className="eui-modal-foot">{props.footer}</div>}
      </div>
    </div>
  )
}
