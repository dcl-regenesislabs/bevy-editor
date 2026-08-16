import type { ReactNode } from 'react'
import css from './StateBlock.css?inline'
import { registerCss } from './styles/registry'

registerCss('ds/StateBlock', 'primitives', css)

export const STATE_TONES = ['neutral', 'success', 'error'] as const
export type StateTone = (typeof STATE_TONES)[number]

export function StateBlock(props: {
  tone?: StateTone
  icon?: ReactNode
  headline: string
  note?: ReactNode
  align?: 'center' | 'start'
  children?: ReactNode
}): JSX.Element {
  const tone = props.tone ?? 'neutral'
  const cls = ['eui-ds-state', props.align === 'start' ? 'start' : ''].filter(Boolean).join(' ')
  const iconCls = ['eui-ds-state-icon', tone === 'neutral' ? '' : tone].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      {props.icon !== undefined && <div className={iconCls}>{props.icon}</div>}
      <p className="eui-ds-state-t">{props.headline}</p>
      {props.note !== undefined && <p className="eui-ds-state-note">{props.note}</p>}
      {props.children}
    </div>
  )
}
