// The ONE inline message block inside a panel body ("start here", "something to
// clean up"). A <div>, not a <p>: it holds action rows. It owns its own margins —
// see Notice.css for why.
import type { ReactNode } from 'react'
import css from './Notice.css?inline'
import { registerCss } from './styles/registry'

registerCss('ds/Notice', 'primitives', css)

export const NOTICE_TONES = ['info', 'attention'] as const
export type NoticeTone = (typeof NOTICE_TONES)[number]

export function Notice(props: {
  /** info = quiet housekeeping (default); attention = accent-tinted, asks for a look. */
  tone?: NoticeTone
  /** renders a ✕. A suggestion the creator can't put away is a nag. */
  onDismiss?: () => void
  dismissTip?: string
  children: ReactNode
}): JSX.Element {
  const tone = props.tone ?? 'info'
  return (
    <div className={`eui-ds-notice${tone === 'info' ? '' : ` ${tone}`}`}>
      <div className="body">{props.children}</div>
      {props.onDismiss !== undefined && (
        <button className="x" data-tip={props.dismissTip ?? 'Dismiss'} onClick={props.onDismiss}>
          ✕
        </button>
      )}
    </div>
  )
}
