// Prefab affordances small enough to be shared: the hierarchy's instance mark
// and update badge, the inspector's "instance of…" strip, and the runtime-state
// chips a Prefabs-tab card carries. They live here so those panels don't have to
// import the Prefabs panel (and with it the drag store, the import dialog and
// the SDK gate) to render a 12px chip.
import { useEffect, useState } from 'react'
import { Chip } from '../ds'
import { useStore } from '../core/store'
import { IconPrefab } from '../icons'
import type { PrefabData } from '../prefabs/format'
import type { GuaranteeChip } from '../prefabs/guarantees'
import type { OutdatedPrefab } from '../prefabs/outdated'
import {
  instancesOf,
  placementOf,
  PLACEMENT_LABEL,
  PLACEMENT_TIP,
  type PlacementInstance
} from '../prefabs/placement'
import { ensurePrefabsLoaded, prefabStore, revealPrefab, type PrefabEntry } from './prefab-store'
import { PrefabDriftDialog } from './PrefabDriftDialog'
import { PrefabUpdateDialog } from './PrefabUpdateDialog'

export function UpdateChip(props: { info: OutdatedPrefab; label?: string; onClick: () => void }): JSX.Element {
  return (
    <button
      className="eui-prefab-update-chip"
      data-tip={`v${props.info.copyVersion} → v${props.info.masterVersion} available — click to see what changed and update`}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick()
      }}
    >
      {props.label ?? 'Update'}
    </button>
  )
}

function instanceLabel(entry: PrefabEntry | undefined, loaded: boolean): string {
  if (entry !== undefined) return entry.data.name
  return loaded ? 'a prefab no longer in this project' : 'a prefab'
}

export function PrefabUpdateBadge(props: { assetId: string; label?: string }): JSX.Element | null {
  const items = useStore(() => prefabStore.items)
  const outdated = useStore(() => prefabStore.outdated)
  const [updating, setUpdating] = useState(false)
  useEffect(ensurePrefabsLoaded, [])
  const entry = items.find((p) => p.data.id === props.assetId)
  const info = outdated.get(props.assetId)
  if (entry === undefined || info === undefined) return null
  return (
    <>
      <UpdateChip
        info={info}
        label={props.label ?? 'Update available'}
        onClick={() => setUpdating(true)}
      />
      {updating && (
        <PrefabUpdateDialog
          id={props.assetId}
          name={entry.data.name}
          info={info}
          onClose={() => setUpdating(false)}
        />
      )}
    </>
  )
}

export function PrefabInstanceStrip(props: { assetId: string; rootId: string }): JSX.Element {
  const items = useStore(() => prefabStore.items)
  const loaded = useStore(() => prefabStore.loaded)
  const [comparing, setComparing] = useState(false)
  useEffect(ensurePrefabsLoaded, [])
  const entry = items.find((p) => p.data.id === props.assetId)
  const label = instanceLabel(entry, loaded)
  return (
    <div className="eui-prefab-instance">
      <IconPrefab />
      <span className="name">Instance of {label}</span>
      <PrefabUpdateBadge assetId={props.assetId} />
      {entry !== undefined && (
        <>
          <button
            className="eui-link"
            data-tip="See what this copy changed — then save your changes over the prefab, or take the prefab’s version back"
            onClick={() => setComparing(true)}
          >
            Compare…
          </button>
          <button className="eui-link" onClick={() => revealPrefab(entry.folder)}>
            Show
          </button>
        </>
      )}
      {comparing && entry !== undefined && (
        <PrefabDriftDialog
          folder={entry.folder}
          name={entry.data.name}
          rootId={props.rootId}
          onClose={() => setComparing(false)}
        />
      )}
    </div>
  )
}

export function PrefabRuntimeChips(props: {
  data: PrefabData
  /** every prefab instance in the scene, scanned once for the whole grid */
  instances: PlacementInstance[]
  guarantees: GuaranteeChip[]
  stale: boolean
  /** a card for a copy this project owns; a library master has no placement or guarantees yet */
  inProject: boolean
}): JSX.Element | null {
  const spawnable = props.data.spawnable
  if (spawnable === undefined) return null
  const mine = instancesOf(props.data, props.instances)
  const placement = placementOf(props.data, mine)
  const count = mine.length
  const placed = count === 1 ? '1 instance' : `${count} instances`
  return (
    <div className="eui-prefab-chips">
      <Chip
        size="xs"
        tone="primary"
        tip={`Your scripts can spawn copies of this while the game runs — up to ${spawnable.max} alive at once.`}
      >
        Spawnable ✓ {spawnable.max}
      </Chip>
      {spawnable.instancing === 'perPlayer' && (
        <Chip size="xs" tip="One copy per player in the scene, spawned when they join and removed when they leave.">
          Per player
        </Chip>
      )}
      {props.inProject && (
        <Chip
          size="xs"
          tone={placement === 'editorAndPlay' ? 'default' : 'soon'}
          tip={placement === 'unplaced' ? PLACEMENT_TIP.unplaced : `${PLACEMENT_TIP[placement]} (${placed})`}
        >
          {PLACEMENT_LABEL[placement]}
        </Chip>
      )}
      {props.stale && (
        <Chip
          size="xs"
          tone="danger"
          tip="The running scene was built before this change. Play reloads it once the rebuild finishes."
        >
          Rebuild pending
        </Chip>
      )}
      {props.inProject &&
        props.guarantees.map((chip) => (
          <Chip key={chip.label} size="xs" tone={chip.tone} tip={chip.tip}>
            {chip.label}
          </Chip>
        ))}
    </div>
  )
}

export function PrefabMark(): JSX.Element {
  return (
    <span className="eui-prefab-mark" data-tip="Prefab instance — placed from the Prefabs library">
      <IconPrefab />
    </span>
  )
}
