// A container row in the tree: caret, folder glyph, label, count.
//
// It looks like a row because it is one — the folder glyph is the only thing
// separating it from an entity, which is how Roblox's Explorer distinguishes a
// service from a part. Open/closed lives in the same expanded set the entity
// rows use, keyed by a synthetic string, so nothing new has to track it.
import type { ReactNode } from 'react'
import { state, toggleEntity } from '@scene/state'
import { useStore } from '../core/store'
import { IconEye, IconEyeOff, IconFolder } from '../icons'
import { TreeCaret } from './TreeCaret'
import { registerCss } from '../ds/styles/registry'
import css from './tree-folder.css?inline'

registerCss('panels/tree-folder', 'features', css)

export function TreeFolder(props: {
  /** synthetic expanded-set key; present means collapsed, so folders open by default */
  foldKey: string
  label: string
  count: number
  tip: string
  /** a search hit lives inside: a collapsed folder would hide it */
  forceOpen?: boolean
  /** shows an eye that hides this folder's entities in the editor viewport */
  hidden?: boolean
  onToggleHidden?: () => void
  hiddenTip?: string
  children: ReactNode
}): JSX.Element {
  const expanded = useStore(() => state.expandedEntities)
  const empty = props.count === 0
  const open = !empty && (props.forceOpen === true || !expanded.has(props.foldKey))
  return (
    <>
      <div
        className="eui-row eui-tree-folder"
        data-tip={props.tip}
        onClick={(e) => {
          e.stopPropagation()
          if (!empty) toggleEntity(props.foldKey)
        }}
      >
        <span className={`twisty ${open ? 'open' : ''}`}>{!empty && <TreeCaret />}</span>
        <span className="label">
          <span className="glyph">
            <IconFolder />
          </span>
          {props.label}
        </span>
        <span className="row-marks">
          <span className="count">{props.count}</span>
        </span>
        {props.onToggleHidden !== undefined && !empty && (
          <span className="row-flags">
            <button
              className={`flag ${props.hidden === true ? 'on' : ''}`}
              aria-label={props.hiddenTip}
              data-tip={props.hiddenTip}
              onClick={(e) => {
                e.stopPropagation()
                props.onToggleHidden?.()
              }}
            >
              {props.hidden === true ? <IconEyeOff /> : <IconEye />}
            </button>
          </span>
        )}
      </div>
      {open && props.children}
    </>
  )
}
