// Prefab affordances that appear OUTSIDE the Prefabs panel — the hierarchy's
// instance mark and update badge, the inspector's "instance of…" strip. They
// live here so those panels don't have to import the Prefabs panel (and with it
// the drag store, the import dialog and the SDK gate) to render a 12px chip.
import { useEffect, useState } from 'react'
import { useStore } from '../core/store'
import { IconPrefab } from '../icons'
import type { OutdatedPrefab } from '../prefabs/outdated'
import { ensurePrefabsLoaded, prefabStore, revealPrefab, type PrefabEntry } from './prefab-store'
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

export function PrefabInstanceStrip(props: { assetId: string }): JSX.Element {
  const items = useStore(() => prefabStore.items)
  const loaded = useStore(() => prefabStore.loaded)
  useEffect(ensurePrefabsLoaded, [])
  const entry = items.find((p) => p.data.id === props.assetId)
  const label = instanceLabel(entry, loaded)
  return (
    <div className="eui-prefab-instance">
      <IconPrefab />
      <span className="name">Instance of {label}</span>
      <PrefabUpdateBadge assetId={props.assetId} />
      {entry !== undefined && (
        <button className="eui-link" onClick={() => revealPrefab(entry.folder)}>
          Show
        </button>
      )}
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
