import { useState } from 'react'
import { state, topLevelSelected, type Snapshot } from '@scene/state'
import { uiCreatePrefabFromSelection } from '../actions/prefabs'
import { useStore } from '../core/store'
import {
  CAPTURE_TAIL,
  CREATE_LEAD,
  defaultPrefabName,
  KEEP_NOTE,
  MULTI_ROOT_NOTE,
  NO_SELECTION,
  PREFAB_ONLY_NOTE,
  selectionLead
} from './create-prefab'
import { Button, Modal, PropRow, Segmented, TextInput } from '../ds'
import { registerCss } from '../ds/styles/registry'
import css from './create-prefab.css?inline'

registerCss('panels/create-prefab', 'features', css)

const KEEP_OPTIONS: ReadonlyArray<{ value: 'keep' | 'only'; label: string }> = [
  { value: 'keep', label: 'From the start' },
  { value: 'only', label: 'When spawned' }
]

export function CreatePrefabDialog(props: { onClose: () => void }): JSX.Element {
  const snapshot = useStore(() => state.snapshot) as Snapshot
  const roots = topLevelSelected(snapshot)
  const [name, setName] = useState(() => defaultPrefabName(snapshot, roots))
  const [keepChoice, setKeepChoice] = useState(true)

  const single = roots.length === 1
  const keep = !single || keepChoice

  const blocked = name.trim() === '' || roots.length === 0
  const create = (): void => {
    if (blocked) return
    props.onClose()
    void uiCreatePrefabFromSelection(name.trim(), { spawnedOnly: !keep })
  }

  const submitLabel = 'Create prefab'

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
      <p className="eui-create-lead">{CREATE_LEAD}</p>
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
      ) : (
        <div className="eui-create-form">
          <p>
            {selectionLead(snapshot, roots)} {CAPTURE_TAIL}
          </p>
          {single ? (
            <>
              <PropRow label="Appears" wrapLabel>
                <Segmented
                  className="eui-create-seg"
                  value={keep ? 'keep' : 'only'}
                  options={KEEP_OPTIONS}
                  aria-label="Appears"
                  onChange={(v) => setKeepChoice(v === 'keep')}
                />
              </PropRow>
              <p className="eui-create-note">{!keep ? PREFAB_ONLY_NOTE : KEEP_NOTE}</p>
            </>
          ) : (
            <p className="eui-create-note">{MULTI_ROOT_NOTE}</p>
          )}
        </div>
      )}
    </Modal>
  )
}
