import { useEffect, useMemo, useState } from 'react'
import { state } from '@scene/state'
import { Button, Chip, Modal, NumberField, PropRow, Segmented, Select, Toggle } from '../ds'
import { useStore } from '../core/store'
import { uiSetPlacement } from '../actions/ghost'
import { uiSetSpawnable } from '../actions/spawnables'
import { consumerStore, ensureConsumersLoaded, sceneLayouts } from '../prefabs/consumers'
import { guaranteeChips } from '../prefabs/guarantees'
import type { PrefabData, PrefabSpawnable } from '../prefabs/format'
import {
  defaultPlacement,
  instancesOf,
  placementOf,
  sceneInstances,
  PLACEMENT_LABEL,
  PLACEMENT_MODES,
  PLACEMENT_TIP,
  type PlacementMode
} from '../prefabs/placement'

const DEFAULT_MAX = 8
const MIN_MAX = 1
const MAX_MAX = 1024

const INSTANCING_OPTIONS = [
  { value: 'onDemand', label: 'On demand' },
  { value: 'perPlayer', label: 'One per player' }
]

const INSTANCING_TIP: Record<string, string> = {
  onDemand: 'Code decides when to spawn and release. The cap is the only limit.',
  perPlayer: 'One clone per connected player, opened at join and released when they leave.'
}

function folderScriptTexts(folder: string, scripts: Record<string, string>): string[] {
  return Object.entries(scripts)
    .filter(([path]) => path.startsWith(`${folder}/`))
    .map(([, text]) => text)
}

export function PrefabSheet(props: { folder: string; data: PrefabData; onClose: () => void }): JSX.Element {
  const { data } = props
  const snapshot = useStore(() => state.snapshot)
  const scripts = useStore(() => consumerStore.scripts)
  const busy = useStore(() => state.assetBusy)
  useEffect(ensureConsumersLoaded, [])

  const spawnable = data.spawnable
  const [max, setMax] = useState(spawnable?.max ?? DEFAULT_MAX)
  const [instancing, setInstancing] = useState<'onDemand' | 'perPlayer'>(
    spawnable?.instancing ?? 'onDemand'
  )
  const [asking, setAsking] = useState(false)
  const [unplacing, setUnplacing] = useState(false)

  const instances = useMemo(() => instancesOf(data, sceneInstances(snapshot)), [data, snapshot])
  const placement = placementOf(data, instances)
  const layouts = useMemo(() => sceneLayouts(), [snapshot])
  const chips = useMemo(
    () => guaranteeChips({ data, scripts, layouts }),
    [data, scripts, layouts]
  )

  const clamp = (n: number): number => Math.min(MAX_MAX, Math.max(MIN_MAX, Math.round(n)))
  const draft = (): PrefabSpawnable => ({ max: clamp(max), instancing })

  const applySpawnable = async (next: PrefabSpawnable | null): Promise<void> => {
    await uiSetSpawnable(props.folder, next)
  }

  const turnOn = (): void => {
    setAsking(true)
  }

  const finishTurnOn = async (keepAnchor: boolean): Promise<void> => {
    setAsking(false)
    const next = draft()
    await applySpawnable(next)
    if (!keepAnchor) return
    const target = defaultPlacement(
      { ...data, spawnable: next },
      folderScriptTexts(props.folder, scripts)
    )
    await uiSetPlacement(props.folder, data, target === 'unplaced' ? 'editorAndPlay' : target)
  }

  const changePlacement = (target: PlacementMode): void => {
    if (target === placement) return
    if (target === 'unplaced' && instances.length > 0) {
      setUnplacing(true)
      return
    }
    void uiSetPlacement(props.folder, data, target)
  }

  if (asking) {
    const suggested = defaultPlacement(
      { ...data, spawnable: draft() },
      folderScriptTexts(props.folder, scripts)
    )
    return (
      <Modal
        title={`Keep a placed ${data.name}?`}
        onClose={() => setAsking(false)}
        footer={
          <>
            <Button onClick={() => void finishTurnOn(false)}>No anchor</Button>
            <Button variant="primary" onClick={() => void finishTurnOn(true)}>
              {suggested === 'editingOnly' ? 'Keep it, editing only' : 'Keep it in the scene'}
            </Button>
          </>
        }
      >
        <p className="eui-prefab-sheet-ask">
          Clones spawn from the prefab folder, so {data.name} does not need to be in the scene at all.
          A placed copy is an anchor: somewhere to edit it in place, and where a script that branches
          on <code>isServer()</code> actually runs.
        </p>
        <p className="eui-prefab-sheet-ask dim">
          {suggested === 'unplaced'
            ? `Up to ${clamp(max)} at once — a pool this size is usually left unplaced.`
            : suggested === 'editorAndPlay'
              ? 'This prefab has a server half, so its anchor has to exist in the built scene too.'
              : 'The anchor can be editing-only: you edit it in place and the running game never sees it.'}
        </p>
      </Modal>
    )
  }

  if (unplacing) {
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
              Remove {instances.length === 1 ? 'it' : `all ${instances.length}`}
            </Button>
          </>
        }
      >
        <p className="eui-prefab-sheet-ask">
          {instances.length === 1 ? 'The placed copy is' : `All ${instances.length} placed copies are`}{' '}
          deleted. The prefab folder is untouched and clones still spawn from it — but anything you
          changed on the anchor and never saved over the prefab goes with it.
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      title={data.name}
      onClose={props.onClose}
      footer={<Button onClick={props.onClose}>Done</Button>}
    >
      <div className="eui-prefab-sheet">
        <PropRow label="Placement">
          <Segmented
            value={placement}
            options={PLACEMENT_MODES.map((mode) => ({ value: mode, label: PLACEMENT_LABEL[mode] }))}
            onChange={changePlacement}
          />
        </PropRow>
        <p className="eui-prefab-sheet-note">{PLACEMENT_TIP[placement]}</p>

        <PropRow label="Spawnable">
          <Toggle
            checked={spawnable !== undefined}
            disabled={busy}
            aria-label="Spawnable"
            tip="Let runtime code clone this prefab through src/scripts/spawnables.ts."
            onChange={(on) => {
              if (on) turnOn()
              else void applySpawnable(null)
            }}
          />
        </PropRow>

        {spawnable !== undefined && (
          <>
            <PropRow label="Max alive">
              <NumberField
                value={max}
                min={MIN_MAX}
                max={MAX_MAX}
                disabled={busy}
                onChange={(e) => setMax(Number(e.currentTarget.value))}
                onBlur={() => {
                  if (clamp(max) === spawnable.max) return
                  void applySpawnable(draft())
                }}
              />
            </PropRow>
            <PropRow label="Instancing">
              <Select
                value={instancing}
                options={INSTANCING_OPTIONS}
                density="compact"
                disabled={busy}
                aria-label="Instancing"
                onChange={(value) => {
                  const next = value === 'perPlayer' ? 'perPlayer' : 'onDemand'
                  setInstancing(next)
                  void applySpawnable({ max: clamp(max), instancing: next })
                }}
              />
            </PropRow>
            <p className="eui-prefab-sheet-note">{INSTANCING_TIP[instancing]}</p>
          </>
        )}

        {chips.length > 0 && (
          <>
            <p className="eui-prefab-sheet-head">Guarantees</p>
            <div className="eui-prefab-chips">
              {chips.map((chip) => (
                <Chip key={chip.label} size="xs" tone={chip.tone} tip={chip.tip}>
                  {chip.label}
                </Chip>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
