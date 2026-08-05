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
  defaultKeepAnchor,
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

type Instancing = 'onDemand' | 'perPlayer'

const INSTANCING_OPTIONS = [
  { value: 'onDemand', label: 'On demand' },
  { value: 'perPlayer', label: 'One per player' }
]

const INSTANCING_TIP: Record<string, string> = {
  onDemand: 'Your scripts decide when to spawn a copy and when to let it go. Max alive is the only limit.',
  perPlayer: 'One copy per player in the scene, spawned when they join and removed when they leave.'
}

function folderScriptTexts(folder: string, scripts: Record<string, string>): string[] {
  return Object.entries(scripts)
    .filter(([path]) => path.startsWith(`${folder}/`))
    .map(([, text]) => text)
}

// The two fields that describe the pool. They render twice — inside the anchor
// question, where they only stage (the write lands with the answer), and in the
// sheet, where each field writes through on settle. Rendering them in the
// question is what makes the anchor default reachable at all: it is computed
// from max and instancing, and before this the question was always asked with
// the untouched default of 8 · on demand.
function SpawnableFields(props: {
  max: number
  instancing: Instancing
  disabled: boolean
  onMax: (value: number) => void
  onSettleMax: () => void
  onInstancing: (value: Instancing) => void
}): JSX.Element {
  return (
    <>
      <PropRow label="Max alive">
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
      <PropRow label="Instancing">
        <Select
          value={props.instancing}
          options={INSTANCING_OPTIONS}
          density="compact"
          disabled={props.disabled}
          aria-label="Instancing"
          onChange={(value) => props.onInstancing(value === 'perPlayer' ? 'perPlayer' : 'onDemand')}
        />
      </PropRow>
      <p className="eui-prefab-sheet-note">{INSTANCING_TIP[props.instancing]}</p>
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
  const [asking, setAsking] = useState(false)
  const [unplacing, setUnplacing] = useState(false)

  const instances = useMemo(() => instancesOf(data, sceneInstances(snapshot)), [data, snapshot])
  const placement = placementOf(data, instances)
  const layouts = useMemo(() => sceneLayouts(), [snapshot])
  const chips = useMemo(
    () => guaranteeChips({ data, scripts, layouts }),
    [data, scripts, layouts]
  )

  // A cleared field stays cleared (NaN) instead of snapping to 0 under the
  // cursor, so it must never reach data.json: `JSON.stringify(NaN)` is `null`,
  // and a null max is a pool that opens with no cap at all.
  const clamp = (n: number): number =>
    Number.isFinite(n) ? Math.min(MAX_MAX, Math.max(MIN_MAX, Math.round(n))) : spawnable?.max ?? DEFAULT_MAX
  const draft = (): PrefabSpawnable => ({ max: clamp(max), instancing })

  // Until the project's scripts are read, `keepsServerHalf` cannot see an
  // isServer() branch — and guessing wrong ghosts an anchor the server needs.
  // Editor & Play is the safe side of that coin, so an unread project takes it.
  const anchorPlacement = (next: PrefabSpawnable): PlacementMode => {
    if (!scriptsRead) return 'editorAndPlay'
    const target = defaultPlacement({ ...data, spawnable: next }, folderScriptTexts(props.folder, scripts))
    return target === 'unplaced' ? 'editorAndPlay' : target
  }

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
    await uiSetPlacement(props.folder, data, anchorPlacement(next))
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
    const next = draft()
    // The spec's default: off for a pool this big, on where in-world editing
    // earns it (per-player). Whichever one it is leads as the primary button —
    // an always-primary "keep it" taught the opposite of what the model wants.
    const keepByDefault = defaultKeepAnchor({ ...data, spawnable: next })
    const willPlace = anchorPlacement(next)
    const suggested: PlacementMode = keepByDefault ? willPlace : 'unplaced'
    return (
      <Modal
        title={`Keep a placed ${data.name}?`}
        onClose={() => setAsking(false)}
        footer={
          <>
            <Button variant={keepByDefault ? 'default' : 'primary'} onClick={() => void finishTurnOn(false)}>
              Leave it unplaced
            </Button>
            <Button variant={keepByDefault ? 'primary' : 'default'} onClick={() => void finishTurnOn(true)}>
              {willPlace === 'editingOnly' ? 'Keep it, editing only' : 'Keep it in the scene'}
            </Button>
          </>
        }
      >
        <div className="eui-prefab-sheet">
          <SpawnableFields
            max={max}
            instancing={instancing}
            disabled={busy}
            onMax={setMax}
            onSettleMax={() => setMax(clamp(max))}
            onInstancing={setInstancing}
          />
        </div>
        <p className="eui-prefab-sheet-ask">
          Clones spawn from the prefab folder, so {data.name} does not need to be in the scene at all.
          A placed copy is an anchor: somewhere to edit it in place, and where a script that branches
          on <code>isServer()</code> actually runs.
        </p>
        <p className="eui-prefab-sheet-ask dim">
          {suggested === 'unplaced'
            ? `Up to ${clamp(max)} alive at once — that many copies are usually left unplaced.`
            : suggested === 'editorAndPlay'
              ? 'Part of this prefab runs on the server, so its placed copy has to be in the built scene too.'
              : 'This one can stay editing-only: you edit it in place and the running game never sees it.'}
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
            disabled={busy}
            aria-label="Placement"
            onChange={changePlacement}
          />
        </PropRow>
        <p className="eui-prefab-sheet-note">{PLACEMENT_TIP[placement]}</p>

        <PropRow label="Spawnable">
          <Toggle
            checked={spawnable !== undefined}
            disabled={busy}
            aria-label="Spawnable"
            tip="Let your scripts spawn copies of this prefab while the game runs, through src/scripts/spawnables.ts."
            onChange={(on) => {
              if (on) turnOn()
              else void applySpawnable(null)
            }}
          />
        </PropRow>

        {spawnable !== undefined && (
          <SpawnableFields
            max={max}
            instancing={instancing}
            disabled={busy}
            onMax={setMax}
            onSettleMax={() => {
              const next = clamp(max)
              setMax(next)
              if (next === spawnable.max) return
              void applySpawnable({ max: next, instancing })
            }}
            onInstancing={(next) => {
              setInstancing(next)
              void applySpawnable({ max: clamp(max), instancing: next })
            }}
          />
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
