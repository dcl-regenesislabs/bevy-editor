import { useState } from 'react'
import { state, topLevelSelected, type Snapshot } from '../../../scene/src/state'
import { entityName } from '../../../scene/src/custom-components'
import { uiAddEntity, uiCreatePrefabFromSelection } from '../actions'
import { dismissPlayEditWarning } from '../autosave'
import { useStore } from '../store'
import { Button, Checkbox, Modal, TextInput } from '../ds'

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
      <Checkbox checked={dontShow} onChange={setDontShow}>
        Don’t show this again
      </Checkbox>
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

// --- create prefab ---

function defaultPrefabName(snapshot: Snapshot, roots: string[]): string {
  if (roots.length !== 1) return 'Prefab'
  return entityName(snapshot, roots[0]) ?? 'Prefab'
}

export function CreatePrefabDialog(props: { onClose: () => void }): JSX.Element {
  const snapshot = useStore(() => state.snapshot) as Snapshot
  const roots = topLevelSelected(snapshot)
  const [name, setName] = useState(() => defaultPrefabName(snapshot, roots))

  const create = (): void => {
    props.onClose()
    void uiCreatePrefabFromSelection(name.trim())
  }

  return (
    <Modal
      title="Save as prefab"
      onClose={props.onClose}
      footer={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" disabled={name.trim() === '' || roots.length === 0} onClick={create}>
            Create
          </Button>
        </>
      }
    >
      <TextInput
        autoFocus
        placeholder="Prefab name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim() !== '' && roots.length > 0) create()
        }}
      />
      {roots.length === 0 ? (
        <p>Select an entity in the scene first — a prefab is a copy of what you have selected.</p>
      ) : (
        <p>
          {roots.length === 1
            ? `“${entityName(snapshot, roots[0]) ?? roots[0]}” and everything under it`
            : `${roots.length} selected entities and everything under them`}{' '}
          are copied into <code>custom/</code> — models, scripts and textures included — so the
          prefab can be placed again in this scene or shared as a folder.
        </p>
      )}
      {roots.length === 1 && (
        <p style={{ opacity: 0.8 }}>
          The selection stays exactly where it is and becomes an instance of the new prefab.
        </p>
      )}
    </Modal>
  )
}
