import { useEffect, useMemo, useState } from 'react'
import { state } from '@scene/state'
import { Button, Chip, Modal, NumberField, PropRow, Segmented } from '../ds'
import { useStore } from '../core/store'
import { uiSetPlacement } from '../actions/ghost'
import { uiSetSpawnable } from '../actions/spawnables'
import { consumerStore, ensureConsumersLoaded, sceneLayouts } from '../prefabs/consumers'
import { guaranteeChips, PENDING_EXPLAINER, PENDING_LABEL } from '../prefabs/guarantees'
import {
  INSTANCING_LINE,
  maxLine,
  ALWAYS_SPAWNABLE_LINE
} from '../prefabs/copy'
import type { PrefabData, PrefabSpawnable } from '../prefabs/format'
import { clampMax, DEFAULT_MAX, MAX_MAX, MIN_MAX } from '../prefabs/spawnable-draft'
import {
  instancesOf,
  placementOf,
  sceneInstances,
  PLACEMENT_LABEL,
  PLACEMENT_MODES,
  PLACEMENT_TIP,
  type PlacementMode
} from '../prefabs/placement'

type Instancing = 'onDemand' | 'perPlayer'

const INSTANCING_OPTIONS: ReadonlyArray<{ value: Instancing; label: string }> = [
  { value: 'onDemand', label: 'On demand' },
  { value: 'perPlayer', label: 'One per player' }
]

function folderScriptTexts(folder: string, scripts: Record<string, string>): string[] {
  return Object.entries(scripts)
    .filter(([path]) => path.startsWith(`${folder}/`))
    .map(([, text]) => text)
}

function placedSuffixFor(count: number): string {
  if (count === 0) return ''
  return count === 1 ? ' One copy is placed right now.' : ` ${count} copies are placed right now.`
}

function SpawnableFields(props: {
  name: string
  max: number
  clamped: number
  instancing: Instancing
  disabled: boolean
  onMax: (value: number) => void
  onSettleMax: () => void
  onInstancing: (value: Instancing) => void
}): JSX.Element {
  return (
    <>
      <PropRow label="Max alive" wrapLabel>
        <NumberField
          value={Number.isFinite(props.max) ? props.max : ''}
          min={MIN_MAX}
          max={MAX_MAX}
          disabled={props.disabled}
          aria-label="Max alive"
          onChange={(e) => props.onMax(e.currentTarget.value === '' ? NaN : Number(e.currentTarget.value))}
          onBlur={props.onSettleMax}
        />
      </PropRow>
      <p className="eui-prefab-sheet-note">{maxLine(props.instancing, props.clamped, props.name)}</p>
      <PropRow label="Copies are made" wrapLabel>
        <Segmented
          className="eui-prefab-sheet-seg"
          value={props.instancing}
          options={INSTANCING_OPTIONS}
          disabled={props.disabled}
          aria-label="Copies are made"
          onChange={props.onInstancing}
        />
      </PropRow>
      <p className="eui-prefab-sheet-note">{INSTANCING_LINE[props.instancing]}</p>
    </>
  )
}

export function PrefabSheet(props: { folder: string; data: PrefabData; onClose: () => void }): JSX.Element {
  const { data } = props
  const snapshot = useStore(() => state.snapshot)
  const scripts = useStore(() => consumerStore.scripts)
  const scriptsRead = useStore(() => consumerStore.loaded)
  const busy = useStore(() => state.assetBusy)
  useEffect(ensureConsumersLoaded, [])

  const spawnable = data.spawnable
  const [max, setMax] = useState(spawnable?.max ?? DEFAULT_MAX)
  const [instancing, setInstancing] = useState<Instancing>(spawnable?.instancing ?? 'onDemand')
  const [unplacing, setUnplacing] = useState(false)

  const instances = useMemo(() => instancesOf(data, sceneInstances(snapshot)), [data, snapshot])
  const placement = placementOf(data, instances)
  const layouts = useMemo(() => sceneLayouts(), [snapshot])
  const chips = useMemo(
    () => guaranteeChips({ data, scripts, layouts }),
    [data, scripts, layouts]
  )

  const clamp = (n: number): number => clampMax(n, spawnable?.max ?? DEFAULT_MAX)
  const applySpawnable = async (next: PrefabSpawnable | null): Promise<void> => {
    await uiSetSpawnable(props.folder, next)
  }

  const changePlacement = (target: PlacementMode): void => {
    if (target === placement) return
    if (target === 'unplaced' && instances.length > 0) {
      setUnplacing(true)
      return
    }
    void uiSetPlacement(props.folder, data, target)
  }

  if (unplacing) {
    const placed = instances.length
    const body =
      `${placed === 1 ? 'The placed copy is' : `All ${placed} placed copies are`} deleted from the scene. ` +
      'The prefab itself is untouched and copies still come from it — but anything you changed on the ' +
      'placed one and never saved back into the prefab goes with it.' +
      (placed === 1 ? ' Undo puts it back.' : '')
    return (
      <Modal
        title={`Remove the placed ${data.name}?`}
        onClose={() => setUnplacing(false)}
        footer={
          <>
            <Button onClick={() => setUnplacing(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setUnplacing(false)
                void uiSetPlacement(props.folder, data, 'unplaced')
              }}
            >
              Remove {placed === 1 ? 'it' : `all ${placed}`}
            </Button>
          </>
        }
      >
        <p className="eui-prefab-sheet-ask">{body}</p>
      </Modal>
    )
  }

  const pendingOnly = chips.length === 1 && chips[0].label === PENDING_LABEL

  return (
    <Modal
      title={`Placement & spawning — ${data.name}`}
      onClose={props.onClose}
      footer={<Button onClick={props.onClose}>Done</Button>}
    >
      <div className="eui-prefab-sheet">
        <p className="eui-prefab-sheet-lead">
          Where this prefab sits while you build, and whether your game can make copies of it while it runs.
        </p>

        <p className="eui-prefab-sheet-head">In the scene</p>
        <Segmented
          className="eui-prefab-sheet-seg"
          value={placement}
          options={PLACEMENT_MODES.map((mode) => ({ value: mode, label: PLACEMENT_LABEL[mode] }))}
          disabled={busy}
          aria-label="Placement"
          onChange={changePlacement}
        />
        <p className="eui-prefab-sheet-note">
          {PLACEMENT_TIP[placement]}
          {placedSuffixFor(instances.length)}
        </p>

        <p className="eui-prefab-sheet-head">While the game runs</p>
        <p className="eui-prefab-sheet-note">{ALWAYS_SPAWNABLE_LINE}</p>
        <SpawnableFields
          name={data.name}
          max={max}
          clamped={clamp(max)}
          instancing={instancing}
          disabled={busy}
          onMax={setMax}
          onSettleMax={() => {
            const next = clamp(max)
            setMax(next)
            if (next === (spawnable?.max ?? DEFAULT_MAX)) return
            void applySpawnable({ max: next, instancing })
          }}
          onInstancing={(next) => {
            setInstancing(next)
            void applySpawnable({ max: clamp(max), instancing: next })
          }}
        />

        {chips.length > 0 && (
          <>
            <p className="eui-prefab-sheet-head">What this promises in multiplayer</p>
            <div className="eui-prefab-chips">
              {chips.map((chip) => (
                <Chip key={chip.label} size="xs" tone={chip.tone} tip={chip.tip}>
                  {chip.label}
                </Chip>
              ))}
            </div>
            {pendingOnly && <p className="eui-prefab-sheet-note">{PENDING_EXPLAINER}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}
