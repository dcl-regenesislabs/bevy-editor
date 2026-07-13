import { useState } from 'react'
import { state, type Snapshot } from '../../../scene/src/state'
import { entityName } from '../../../scene/src/custom-components'
import { uiAddEntity } from '../actions'
import { dismissPlayEditWarning } from '../autosave'
import { useStore } from '../store'
import { Button, Modal, TextInput } from '../ds'

export { Modal }

// --- play-mode edit warning ---

// Shown once (per the "don't show again" opt-out) the first time the user edits
// while the scene is playing, so the Unity-like "these changes won't persist"
// rule isn't a silent surprise.
export function PlayEditWarningDialog(): JSX.Element {
  const [dontShow, setDontShow] = useState(false)
  const close = (): void => dismissPlayEditWarning(dontShow)
  return (
    <Modal
      title="Editing while playing"
      onClose={close}
      footer={<Button variant="primary" onClick={close}>Got it</Button>}
    >
      <p>
        The scene is <strong>playing</strong>. Changes you make now are runtime only —
        they’re live in the scene but <strong>won’t be saved</strong>, and revert when you
        press <strong>Stop</strong>.
      </p>
      <p style={{ opacity: 0.8 }}>Stop the scene to make changes that persist to the project.</p>
      <label className="eui-check">
        <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
        Don’t show this again
      </label>
    </Modal>
  )
}

// --- new entity ---

export function NewEntityDialog(props: { onClose: () => void }): JSX.Element {
  const activeEntity = useStore(() => state.activeEntity)
  const snapshot = useStore(() => state.snapshot)
  const [name, setName] = useState('')
  const active = activeEntity
  const [parent, setParent] = useState<'root' | 'active'>(active !== null ? 'active' : 'root')

  const create = (): void => {
    const parentId = parent === 'active' && active !== null ? Number(active) : 0
    void uiAddEntity(name, parentId)
    props.onClose()
  }

  return (
    <Modal
      title="New entity"
      onClose={props.onClose}
      footer={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" onClick={create}>Create</Button>
        </>
      }
    >
      <TextInput
        autoFocus
        placeholder="Entity name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') create()
        }}
      />
      {active !== null && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button active={parent === 'root'} onClick={() => setParent('root')}>At scene root</Button>
          <Button active={parent === 'active'} onClick={() => setParent('active')}>
            Child of {entityName(snapshot as Snapshot, active) ?? active}
          </Button>
        </div>
      )}
    </Modal>
  )
}

