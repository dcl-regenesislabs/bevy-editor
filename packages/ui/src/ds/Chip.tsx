// Small status chip: role/status tags on cards, permission modes, row markers.
import type { ReactNode } from 'react'
import css from './Chip.css?inline'
import { registerCss } from './styles/registry'

registerCss('ds/Chip', 'primitives', css)

// Both axes are closed sets, asserted against the CSS by ds-contract.test.ts R5b
// — the density drift the contract exists to stop would otherwise walk straight
// back in through `size`.
// 'server' (green) and 'client' (blue) are the global client/server colour
// language (docs/MULTIPLAYER-PLAN.md §8), not free-form decoration: a green chip
// means the value is server-owned, a blue one means the client decides it.
export const CHIP_TONES = ['default', 'live', 'soon', 'primary', 'danger', 'info', 'server', 'client'] as const
export const CHIP_SIZES = ['md', 'xs'] as const
export type ChipTone = (typeof CHIP_TONES)[number]
export type ChipSize = (typeof CHIP_SIZES)[number]

export function Chip(props: {
  tone?: ChipTone
  /** md = card scale (default); xs = tree-row scale. */
  size?: ChipSize
  icon?: ReactNode
  tip?: string
  children: ReactNode
}): JSX.Element {
  const tone = props.tone ?? 'default'
  const size = props.size ?? 'md'
  const cls = ['eui-ds-chip', tone === 'default' ? '' : tone, size === 'xs' ? 'xs' : ''].filter(Boolean).join(' ')
  return (
    <span className={cls} data-tip={props.tip}>
      {props.icon !== undefined && <span className="ico">{props.icon}</span>}
      <span className="txt">{props.children}</span>
    </span>
  )
}
