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
  type PlacementInstance
} from '../prefabs/placement'
import { ensurePrefabsLoaded, prefabStore, revealPrefab, type PrefabEntry } from './prefab-store'
import { PrefabDriftDialog } from './PrefabDriftDialog'
import { instanceDriftFor } from '../actions/drift'
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
  const [drifted, setDrifted] = useState(false)
  useEffect(ensurePrefabsLoaded, [])
  const entry = items.find((p) => p.data.id === props.assetId)
  useEffect(() => {
    let alive = true
    setDrifted(false)
    if (entry === undefined || comparing) return
    void instanceDriftFor(entry.folder, props.rootId)
      .then((d) => {
        if (alive) setDrifted(d.status === 'drifted')
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [entry?.folder, props.rootId, comparing])
  const label = instanceLabel(entry, loaded)
  return (
    <div className="eui-prefab-instance">
      <IconPrefab />
      <span className="name">Copy of {label}</span>
      <PrefabUpdateBadge assetId={props.assetId} />
      {entry !== undefined && (
        <>
          {drifted && (
            <button
              className="eui-link"
              data-tip="This copy differs from its prefab — see what changed, then save your changes over the prefab, or take the prefab’s version back"
              onClick={() => setComparing(true)}
            >
              What changed…
            </button>
          )}
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
  /** a card for a copy this project owns; a library master has no placement or guarantees yet */
  inProject: boolean
}): JSX.Element | null {
  // Every prefab is spawnable, so saying so on every card says nothing. What a
  // card can usefully answer is how many copies are in the scene right now, and
  // whether the game hands one to each player.
  const count = instancesOf(props.data, props.instances).length
  return (
    <div className="eui-prefab-chips">
      {props.data.spawnable?.instancing === 'perPlayer' && (
        <Chip size="xs" tip="One copy per player, spawned when they join and removed when they leave.">
          Per player
        </Chip>
      )}
      {props.inProject && (
        <Chip
          size="xs"
          tone={count === 0 ? 'soon' : 'default'}
          tip={
            count === 0
              ? 'No copy of this is in your scene. Your game can still spawn it — drag it in if you want one from the start.'
              : 'Copies of this prefab that are in your scene right now.'
          }
        >
          {count === 0 ? 'Not in the scene' : `${count} in the scene`}
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

export function PrefabMark(props: { tip?: string } = {}): JSX.Element {
  return (
    <span
      className="eui-prefab-mark"
      data-tip={props.tip ?? 'Prefab instance — placed from the Prefabs library'}
    >
      <IconPrefab />
    </span>
  )
}
