// Small status chip: role/status tags on cards, permission modes, etc.
import type { ReactNode } from 'react'
import css from './Chip.css?inline'
import { registerCss } from './styles/registry'

registerCss('ds/Chip', 'primitives', css)

export function Chip(props: { tone?: 'default' | 'live' | 'soon' | 'primary'; tip?: string; children: ReactNode }): JSX.Element {
  const tone = props.tone ?? 'default'
  return (
    <span className={`eui-ds-chip ${tone === 'default' ? '' : tone}`} data-tip={props.tip}>
      {props.children}
    </span>
  )
}
