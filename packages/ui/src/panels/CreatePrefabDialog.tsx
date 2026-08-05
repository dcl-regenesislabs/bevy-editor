import { useEffect, useState } from 'react'
import { state, topLevelSelected, type Snapshot } from '@scene/state'
import { uiCreatePrefabFromSelection } from '../actions/prefabs'
import { useStore } from '../core/store'
import { consumerStore, ensureConsumersLoaded } from '../prefabs/consumers'
import type { PrefabData, PrefabSpawnable } from '../prefabs/format'
import { defaultKeepAnchor, type PlacementMode } from '../prefabs/placement'
import { clampMax, DEFAULT_MAX, keptPlacement, MAX_MAX, MIN_MAX } from '../prefabs/spawnable-draft'
import { INSTANCING_LINE, maxLine } from '../prefabs/copy'
import {
  CAPTURE_TAIL,
  CREATE_LEAD,
  defaultPrefabName,
  KEEP_EDITING_NOTE,
  KEEP_SERVER_NOTE,
  MULTI_ROOT_NOTE,
  NO_SELECTION,
  PREFAB_ONLY_NOTE,
  selectionLead,
  selectionScriptTexts,
  STAYS_PUT
} from './create-prefab'
import { Button, Modal, NumberField, PropRow, Segmented, TextInput } from '../ds'
import { registerCss } from '../ds/styles/registry'
import css from './create-prefab.css?inline'

registerCss('panels/create-prefab', 'features', css)

type Instancing = 'onDemand' | 'perPlayer'

const INSTANCING_OPTIONS: ReadonlyArray<{ value: Instancing; label: string }> = [
  { value: 'onDemand', label: 'On demand' },
  { value: 'perPlayer', label: 'One per player' }
]

const KEEP_OPTIONS: ReadonlyArray<{ value: 'keep' | 'only'; label: string }> = [
  { value: 'keep', label: 'Keep it here' },
  { value: 'only', label: 'Prefab only' }
]

export function CreatePrefabDialog(props: { spawnable: boolean; onClose: () => void }): JSX.Element {
  const snapshot = useStore(() => state.snapshot) as Snapshot
  const scripts = useStore(() => consumerStore.scripts)
  const scriptsRead = useStore(() => consumerStore.loaded)
  const roots = topLevelSelected(snapshot)
  const [name, setName] = useState(() => defaultPrefabName(snapshot, roots))
  const [max, setMax] = useState(DEFAULT_MAX)
  const [instancing, setInstancing] = useState<Instancing>('onDemand')
  const [keepChoice, setKeepChoice] = useState(false)
  const [touched, setTouched] = useState(false)
  useEffect(ensureConsumersLoaded, [])

  const clamped = clampMax(max)
  const draft: PrefabSpawnable = { max: clamped, instancing }
  const single = roots.length === 1
  const draftData: PrefabData = { id: '', name, category: 'custom', tags: [], spawnable: draft }
  const keep = !single || (touched ? keepChoice : defaultKeepAnchor(draftData))
  const placement: PlacementMode = keep
    ? keptPlacement(draftData, draft, scriptsRead, selectionScriptTexts(snapshot, roots, scripts))
    : 'unplaced'

  const blocked = name.trim() === '' || roots.length === 0
  const create = (): void => {
    if (blocked) return
    props.onClose()
    void uiCreatePrefabFromSelection(name.trim(), props.spawnable ? { spawnable: draft, placement } : {})
  }

  const submitLabel = props.spawnable ? 'Create spawnable prefab' : 'Create prefab'

  return (
    <Modal
      title={submitLabel}
      onClose={props.onClose}
      footer={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" disabled={blocked} onClick={create}>
            {submitLabel}
          </Button>
        </>
      }
    >
      {props.spawnable && <p className="eui-create-lead">{CREATE_LEAD}</p>}
      <TextInput
        autoFocus
        placeholder="Prefab name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') create()
        }}
      />
      {roots.length === 0 ? (
        <p>{NO_SELECTION}</p>
      ) : props.spawnable ? (
        <div className="eui-create-form">
          <PropRow label="Max alive" wrapLabel>
            <NumberField
              value={Number.isFinite(max) ? max : ''}
              min={MIN_MAX}
              max={MAX_MAX}
              aria-label="Max alive"
              onChange={(e) => setMax(e.currentTarget.value === '' ? NaN : Number(e.currentTarget.value))}
              onBlur={() => setMax(clamped)}
            />
          </PropRow>
          <p className="eui-create-note">{maxLine(instancing, clamped, name)}</p>
          <PropRow label="Copies are made" wrapLabel>
            <Segmented
              className="eui-create-seg"
              value={instancing}
              options={INSTANCING_OPTIONS}
              aria-label="Copies are made"
              onChange={setInstancing}
            />
          </PropRow>
          <p className="eui-create-note">{INSTANCING_LINE[instancing]}</p>
          {single ? (
            <>
              <PropRow label="This one in the scene" wrapLabel>
                <Segmented
                  className="eui-create-seg"
                  value={keep ? 'keep' : 'only'}
                  options={KEEP_OPTIONS}
                  aria-label="This one in the scene"
                  onChange={(v) => {
                    setTouched(true)
                    setKeepChoice(v === 'keep')
                  }}
                />
              </PropRow>
              <p className="eui-create-note">
                {!keep ? PREFAB_ONLY_NOTE : placement === 'editorAndPlay' ? KEEP_SERVER_NOTE : KEEP_EDITING_NOTE}
              </p>
            </>
          ) : (
            <p className="eui-create-note">{MULTI_ROOT_NOTE}</p>
          )}
        </div>
      ) : (
        <>
          <p>
            {selectionLead(snapshot, roots)} {CAPTURE_TAIL}
          </p>
          {single && <p style={{ opacity: 0.8 }}>{STAYS_PUT}</p>}
        </>
      )}
    </Modal>
  )
}
