import { state } from '@scene/state'
import { childCount } from '@scene/inspector'
import {
  uiAddEntity,
  uiClearParent,
  uiDeleteEntity,
  uiDeleteEntityRecursive,
  uiDeleteEntityReparent,
  uiDuplicateEntity,
  uiReparentToActive
} from '../actions/entities'
import { uiFocusEntity } from '../actions/selection'
import { useStore } from '../core/store'
import { IconBot, IconCamera, IconEdit, IconPlus, IconPrefab, IconTrash } from '../icons'
import { canAskAssistant, prefillAssistant } from './ai-store'
import {
  SUB_PREFAB,
  SUB_SPAWNABLE,
  TIP_CHILD,
  TIP_DELETE,
  TIP_DUP,
  TIP_PREFAB
} from './entity-menu'
import { ContextMenu, MenuItem } from '../ds'

export interface CtxMenu {
  x: number
  y: number
  id: string
}

export function EntityContextMenu(props: {
  ctx: CtxMenu
  isCode: boolean
  onClose: () => void
  onRename: (id: string) => void
  onCreatePrefab: () => void
  onCreateSpawnable: () => void
}): JSX.Element {
  const { ctx, isCode, onClose, onRename } = props
  const snapshot = useStore(() => state.snapshot)
  const selected = useStore(() => state.selected)
  const id = ctx.id
  const kids = childCount(id)
  const parented = (snapshot[id]?.Transform as { parent?: number } | undefined)?.parent !== 0
  const multi = selected.size >= 2

  const tip = (why: string): string | undefined => (isCode ? why : undefined)

  const act = (fn: () => void): (() => void) => () => {
    fn()
    onClose()
  }

  return (
    <ContextMenu x={ctx.x} y={ctx.y} onClose={onClose}>
      <MenuItem icon={<IconCamera />} onClick={act(() => uiFocusEntity(id))}>
        Focus camera
      </MenuItem>
      <MenuItem icon={<IconEdit />} onClick={act(() => onRename(id))}>
        Rename
      </MenuItem>
      {canAskAssistant() && (
        <MenuItem icon={<IconBot />} onClick={act(() => prefillAssistant('Make this '))}>
          Ask AI about this…
        </MenuItem>
      )}
      <div className="eui-menu-sep" />
      <MenuItem
        icon={<IconPrefab />}
        sub={SUB_PREFAB}
        disabled={isCode}
        tip={tip(TIP_PREFAB)}
        onClick={act(props.onCreatePrefab)}
      >
        Create prefab…
      </MenuItem>
      <MenuItem
        icon={<IconPrefab />}
        sub={SUB_SPAWNABLE}
        disabled={isCode}
        tip={tip(TIP_PREFAB)}
        onClick={act(props.onCreateSpawnable)}
      >
        Create spawnable prefab…
      </MenuItem>
      <div className="eui-menu-sep" />
      <MenuItem
        icon={<IconPlus />}
        disabled={isCode}
        tip={tip(TIP_CHILD)}
        onClick={act(() => void uiAddEntity('Entity', Number(id)))}
      >
        New child entity
      </MenuItem>
      <MenuItem icon={<IconPlus />} disabled={isCode} tip={tip(TIP_DUP)} onClick={act(() => void uiDuplicateEntity(id))}>
        Duplicate
      </MenuItem>
      {multi && <MenuItem onClick={act(() => void uiReparentToActive())}>Parent selection here</MenuItem>}
      {parented && <MenuItem onClick={act(() => void uiClearParent())}>Unparent</MenuItem>}
      <div className="eui-menu-sep" />
      {kids === 0 ? (
        <MenuItem
          icon={<IconTrash />}
          danger
          disabled={isCode}
          tip={tip(TIP_DELETE)}
          onClick={act(() => void uiDeleteEntity(id))}
        >
          Delete
        </MenuItem>
      ) : (
        <>
          <MenuItem
            icon={<IconTrash />}
            danger
            disabled={isCode}
            tip={tip(TIP_DELETE)}
            onClick={act(() => void uiDeleteEntityReparent(id))}
          >
            Delete, keep children
          </MenuItem>
          <MenuItem
            icon={<IconTrash />}
            danger
            disabled={isCode}
            tip={tip(TIP_DELETE)}
            onClick={act(() => void uiDeleteEntityRecursive(id))}
          >
            Delete with {kids} child{kids === 1 ? '' : 'ren'}
          </MenuItem>
        </>
      )}
    </ContextMenu>
  )
}
