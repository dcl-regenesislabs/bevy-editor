import { useState } from 'react'
import { componentKey, setComponentExpanded, state } from '@scene/state'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
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
import { uiAddSpawnerFor, uiCreatePrefabFromSelection } from '../actions/prefabs'
import { PrefabDriftDialog } from './PrefabDriftDialog'
import { uiSetSpawnedOnly } from '../actions/spawned-only'
import { uiFocusEntity, uiSelectEntity } from '../actions/selection'
import { enterRecordDestination, recordableParam } from '../actions/record-destination'
import { setRightOpen } from '../core/chrome'
import { TIP_ADD_SCRIPT, focusScriptCreate, isAuthoredEntity } from './script-card'
import { FOLDER_COMPONENT, uiGroupIntoFolder, uiNewFolder, uiUngroupFolder } from '../actions/folders'
import { useStore } from '../core/store'
import { MOD, SHIFT, keyCombo } from '../lib/keys'
import {
  IconBot,
  IconCamera,
  IconCode,
  IconEdit,
  IconFolder,
  IconFolderPlus,
  IconMove,
  IconPlus,
  IconPrefab,
  IconTrash
} from '../icons'
import { canAskAssistant, prefillAssistant } from './ai-store'
import { prefabStore } from './prefab-store'
import {
  SUB_FROM_START,
  SUB_GROUP,
  SUB_NEW_FOLDER,
  SUB_PREFAB,
  SUB_SAVE_OVER,
  SUB_SPAWNED_NEW,
  SUB_SPAWNED_ONLY,
  SUB_SPAWNER,
  SUB_UNGROUP,
  SUB_UPDATE_FROM,
  TIP_SPAWNER_GROUP,
  TIP_SPAWNED_ONLY,
  TIP_IS_INSTANCE,
  TIP_CHILD,
  TIP_DELETE,
  TIP_DUP,
  TIP_GROUP,
  TIP_PREFAB,
  TIP_SPAWNER,
  TIP_SPAWNER_SPAWNED
} from './entity-menu'
import { ContextMenu, MenuItem } from '../ds'

export interface CtxMenu {
  x: number
  y: number
  id: string
}

function addScript(entityId: string): void {
  uiSelectEntity(entityId, false, false)
  setRightOpen(true)
  setComponentExpanded(componentKey(entityId, SCRIPT_COMPONENT), true)
  focusScriptCreate(entityId)
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
  const [comparing, setComparing] = useState(false)
  const prefabs = useStore(() => prefabStore.items)
  // The mark alone does not make it an instance: a prefab can be deleted out
  // from under it, and a mark pointing at nothing must not stop the entity
  // becoming a prefab again — that stranded state is exactly when it needs to.
  const prefabEntry = assetId === null ? undefined : prefabs.find((item) => item.data.id === assetId)
  const isInstance = prefabEntry !== undefined
  const snapshot = useStore(() => state.snapshot)
  const selected = useStore(() => state.selected)
  const id = ctx.id
  const kids = childCount(id)
  const comps = snapshot[id] ?? {}
  const bareGroup =
    kids > 0 && comps.GltfContainer === undefined && comps.MeshRenderer === undefined && comps.TriggerArea === undefined
  const parented = (snapshot[id]?.Transform as { parent?: number } | undefined)?.parent !== 0
  const multi = selected.size >= 2
  const isFolder = snapshot[id]?.[FOLDER_COMPONENT] !== undefined

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

  if (comparing && prefabEntry !== undefined) {
    return (
      <PrefabDriftDialog folder={prefabEntry.folder} name={prefabEntry.data.name} rootId={id} onClose={onClose} />
    )
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
        <MenuItem
          icon={<IconBot />}
          onClick={act(() =>
            prefillAssistant(
              `Make "${entityName(state.snapshot, id) ?? 'this entity'}" do something when a player clicks it`
            )
          )}
        >
          Ask the assistant…
        </MenuItem>
      )}
      <div className="eui-menu-sep" />
      {isAuthoredEntity(id) && (
        <MenuItem
          icon={<IconCode />}
          disabled={isCode}
          tip={tip(TIP_ADD_SCRIPT)}
          onClick={act(() => addScript(id))}
        >
          Add Script
        </MenuItem>
      )}
      {state.frozen && recordableParam(id) !== null && (
        <MenuItem icon={<IconMove />} onClick={act(() => void enterRecordDestination(id))}>
          Set end position
        </MenuItem>
      )}
      <MenuItem
        icon={<IconPrefab />}
        sub={SUB_PREFAB}
        disabled={isCode || isInstance}
        tip={isInstance && !isCode ? TIP_IS_INSTANCE : tip(TIP_PREFAB)}
        onClick={act(props.onCreatePrefab)}
      >
        Create prefab…
      </MenuItem>
      {prefabEntry !== undefined && (
        <>
          <MenuItem icon={<IconPrefab />} sub={SUB_UPDATE_FROM} disabled={isCode} onClick={() => setComparing(true)}>
            Update from prefab…
          </MenuItem>
          <MenuItem icon={<IconPrefab />} sub={SUB_SAVE_OVER} disabled={isCode} onClick={() => setComparing(true)}>
            Save over prefab…
          </MenuItem>
        </>
      )}
      <MenuItem
        icon={<IconPlus />}
        sub={SUB_SPAWNER}
        disabled={isCode || spawnedOnly || bareGroup}
        tip={isCode ? TIP_SPAWNER : spawnedOnly ? TIP_SPAWNER_SPAWNED : bareGroup ? TIP_SPAWNER_GROUP : undefined}
        onClick={act(() => void uiAddSpawnerFor(id))}
      >
        Add a spawner
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
      <div className="eui-menu-sep" />
      <MenuItem
        icon={<IconFolder />}
        sub={SUB_GROUP}
        hint={keyCombo(MOD, 'G')}
        disabled={isCode}
        tip={tip(TIP_GROUP)}
        onClick={act(() => void uiGroupIntoFolder())}
      >
        Group into a folder
      </MenuItem>
      {isFolder && (
        <MenuItem sub={SUB_UNGROUP} hint={keyCombo(MOD, SHIFT, 'G')} onClick={act(() => void uiUngroupFolder(id))}>
          Ungroup
        </MenuItem>
      )}
      <MenuItem
        icon={<IconFolderPlus />}
        sub={SUB_NEW_FOLDER}
        disabled={isCode}
        tip={tip(TIP_CHILD)}
        onClick={act(() => void uiNewFolder(Number(id)))}
      >
        New folder inside
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
          {!isFolder && (
            <MenuItem
              icon={<IconTrash />}
              danger
              disabled={isCode}
              tip={tip(TIP_DELETE)}
              onClick={act(() => void uiDeleteEntityReparent(id))}
            >
              Delete, keep children
            </MenuItem>
          )}
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
