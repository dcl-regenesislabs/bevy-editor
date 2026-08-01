// The one modal shell. Promoted from panels/Dialogs.tsx and extended for the
// publish flow: `scrimClose` (turn off backdrop-click while a job runs) and an
// optional header ✕ whose close is always allowed (hide ≠ cancel).
import { useEffect, useRef, type ReactNode } from 'react'
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
  /** escape hatch for bodies that own their own scroll/padding (asset picker) */
  bodyClassName?: string
  footer?: ReactNode
  children: ReactNode
}): JSX.Element {
  const { onClose } = props
  const box = useRef<HTMLDivElement>(null)
  // Focus moves into the dialog on open: without it the engine iframe can still
  // hold focus and every key (Escape included) goes to the engine, never here.
  useEffect(() => {
    box.current?.focus()
  }, [])
  // Registered ONCE and kept alive through a ref, never re-subscribed per
  // render. A caller's `onClose` is usually an inline arrow, so a dep on it
  // re-subscribed constantly — and an earlier Escape listener (shortcuts.ts
  // clears the selection) re-renders the owner DURING dispatch, which removed
  // this listener before the event reached it. The DOM skips listeners removed
  // mid-dispatch, so Escape silently stopped closing dialogs.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || closeRef.current === undefined) return
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const scrim = props.onClose !== undefined && props.scrimClose !== false
  return (
    <div className="eui-modal-backdrop" onClick={scrim ? props.onClose : undefined}>
      <div
        ref={box}
        tabIndex={-1}
        className={`eui-modal ${props.className ?? ''}`}
        onClick={(e) => e.stopPropagation()}
      >
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
        <div className={`eui-modal-body ${props.bodyClassName ?? ''}`}>{props.children}</div>
        {props.footer !== undefined && <div className="eui-modal-foot">{props.footer}</div>}
      </div>
    </div>
  )
}
