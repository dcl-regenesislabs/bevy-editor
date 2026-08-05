import { state } from '@scene/state'
import { childCount } from '@scene/inspector'
import { entityName } from '@scene/custom-components'
import {
  uiAddEntity,
  uiClearParent,
  uiDeleteEntity,
  uiDeleteEntityRecursive,
  uiDeleteEntityReparent,
  uiDuplicateEntity,
  uiReparentToActive
} from '../actions/entities'
import { uiCreatePrefabFromSelection } from '../actions/prefabs'
import { uiSetSpawnedOnly } from '../actions/spawned-only'
import { uiFocusEntity } from '../actions/selection'
import { useStore } from '../core/store'
import { IconBot, IconCamera, IconEdit, IconFolder, IconPlus, IconPrefab, IconTrash } from '../icons'
import { canAskAssistant, prefillAssistant } from './ai-store'
import { prefabStore } from './prefab-store'
import {
  SUB_FROM_START,
  SUB_PREFAB,
  SUB_SPAWNED_NEW,
  SUB_SPAWNED_ONLY,
  TIP_SPAWNED_ONLY,
  TIP_IS_INSTANCE,
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
  /** the prefab this entity was placed from, if it still carries the mark */
  assetId: string | null
  spawnedOnly: boolean
  onClose: () => void
  onRename: (id: string) => void
  onCreatePrefab: () => void
}): JSX.Element {
  const { ctx, isCode, assetId, spawnedOnly, onClose, onRename } = props
  const prefabs = useStore(() => prefabStore.items)
  // The mark alone does not make it an instance: a prefab can be deleted out
  // from under it, and a mark pointing at nothing must not stop the entity
  // becoming a prefab again — that stranded state is exactly when it needs to.
  const isInstance = assetId !== null && prefabs.some((item) => item.data.id === assetId)
  const snapshot = useStore(() => state.snapshot)
  const selected = useStore(() => state.selected)
  const id = ctx.id
  const kids = childCount(id)
  const parented = (snapshot[id]?.Transform as { parent?: number } | undefined)?.parent !== 0
  const multi = selected.size >= 2

  const tip = (why: string): string | undefined => (isCode ? why : undefined)

  // "When spawned" only means something if something CAN spawn it, and only a
  // prefab can be spawned — so an entity that is not one yet becomes one here,
  // in the same gesture. Anything else would quietly drop it out of the game.
  const moveToSpawned = async (): Promise<void> => {
    if (spawnedOnly) {
      await uiSetSpawnedOnly(id, false)
      return
    }
    if (isInstance) {
      await uiSetSpawnedOnly(id, true)
      return
    }
    await uiCreatePrefabFromSelection(entityName(snapshot, id) ?? 'Prefab', { spawnedOnly: true })
  }

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
        disabled={isCode || isInstance}
        tip={isInstance && !isCode ? TIP_IS_INSTANCE : tip(TIP_PREFAB)}
        onClick={act(props.onCreatePrefab)}
      >
        Create prefab…
      </MenuItem>
      <MenuItem
        icon={<IconFolder />}
        sub={spawnedOnly ? SUB_FROM_START : isInstance ? SUB_SPAWNED_ONLY : SUB_SPAWNED_NEW}
        disabled={isCode}
        tip={tip(TIP_SPAWNED_ONLY)}
        onClick={act(() => void moveToSpawned())}
      >
        {spawnedOnly ? 'Show from the start' : 'Only when spawned'}
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
