import { useState } from 'react'
import { state } from '../../../scene/src/state'
import { Button, ConfirmButton, Modal, Spinner } from '../ds'
import { updatePrefabCopy } from '../prefabs/update'
import type { OutdatedPrefab } from '../prefabs/outdated'
import { refreshPrefabs } from './prefab-store'

export function PrefabUpdateDialog(props: {
  id: string
  name: string
  info: OutdatedPrefab
  onClose: () => void
}): JSX.Element {
  const { info } = props
  const [busy, setBusy] = useState(false)
  const [modified, setModified] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (force: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await updatePrefabCopy(props.id, { force })
      if (result.updated) {
        await refreshPrefabs()
        state.saveStatus = `Updated ${props.name} to v${info.masterVersion}`
        props.onClose()
      } else if (!result.verified) {
        await run(true)
      } else {
        setModified(result.modified)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Update ${props.name}?`}
      onClose={busy ? undefined : props.onClose}
      footer={
        <>
          <Button disabled={busy} onClick={props.onClose}>
            Cancel
          </Button>
          {modified === null ? (
            <Button variant="primary" disabled={busy} onClick={() => void run(false)}>
              Update
            </Button>
          ) : (
            <ConfirmButton
              label="Overwrite and update"
              confirm="Your edits to these files are lost — sure?"
              disabled={busy}
              onConfirm={() => void run(true)}
            />
          )}
        </>
      }
    >
      <p className="eui-prefab-update-versions">
        v{info.copyVersion} <span className="arrow">→</span> v{info.masterVersion}
      </p>
      {info.notes.length > 0 ? (
        <ul className="eui-prefab-update-notes">
          {info.notes.map((entry) => (
            <li key={entry.version}>
              <code>v{entry.version}</code> {entry.notes}
            </li>
          ))}
        </ul>
      ) : (
        <p>No changelog entries between these versions.</p>
      )}
      <p className="eui-prefab-update-keeps">
        Your work is safe: everything you placed stays where it is, with the settings you gave it.
      </p>
      {modified !== null && (
        <div className="eui-prefab-import-warn">
          <p>
            You changed this prefab&apos;s code in this project. Updating replaces your version
            with the new one.
          </p>
          <ul className="eui-prefab-update-modified">
            {modified.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {busy && (
        <div className="eui-prefab-import-busy">
          <Spinner size={14} /> Updating…
        </div>
      )}
      {error !== null && <p className="eui-prefab-import-error">{error}</p>}
    </Modal>
  )
}
