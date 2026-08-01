// The single floating surface for every option list / menu in the app.
// Pickers stay separate components (single-select closes on pick, multi-select
// stays open, menus carry their own rows) but they all render their rows in
// here, so the surface can never drift apart again -- see ds-contract.test.ts R8.
import type { ReactNode } from 'react'
import css from './Popover.css?inline'
import { registerCss } from './styles/registry'

registerCss('ds/Popover', 'primitives', css)

export type PopoverDensity = 'default' | 'compact'

export function Popover(props: {
  density?: PopoverDensity
  role?: 'listbox' | 'menu' | 'group'
  className?: string
  children: ReactNode
}): JSX.Element {
  const density = props.density ?? 'default'
  return (
    <div
      className={['eui-ds-pop', props.className].filter(Boolean).join(' ')}
      data-density={density === 'compact' ? 'compact' : undefined}
      role={props.role}
    >
      {props.children}
    </div>
  )
}
