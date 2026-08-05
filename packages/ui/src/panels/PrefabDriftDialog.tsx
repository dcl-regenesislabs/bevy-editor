import { useEffect, useState } from 'react'
import { Button, Chip, ConfirmButton, Modal, Spinner } from '../ds'
import { instanceDriftFor, uiSaveOverPrefab, uiUpdateInstanceFromPrefab } from '../actions/drift'
import type { DriftEntry, DriftResult } from '../prefabs/drift'

const LISTED = 8

function DriftList(props: { title: string; entries: DriftEntry[] }): JSX.Element | null {
  if (props.entries.length === 0) return null
  const shown = props.entries.slice(0, LISTED)
  const rest = props.entries.length - shown.length
  return (
    <>
      <p className="eui-prefab-drift-head">
        <Chip size="xs">{props.entries.length}</Chip> {props.title}
      </p>
      <ul className="eui-prefab-drift-list">
        {shown.map((entry) => (
          <li key={`${entry.localId}/${entry.component}`}>
            <code>{entry.component}</code> on entity {entry.localId}
          </li>
        ))}
        {rest > 0 && <li>and {rest} more</li>}
      </ul>
    </>
  )
}

export function PrefabDriftDialog(props: {
  folder: string
  name: string
  rootId: string
  onClose: () => void
}): JSX.Element {
  const { folder, rootId } = props
  const [drift, setDrift] = useState<DriftResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    instanceDriftFor(folder, rootId)
      .then((result) => {
        if (live) setDrift(result)
      })
      .catch((e: unknown) => {
        if (live) setError(String(e))
      })
    return () => {
      live = false
    }
  }, [folder, rootId])

  const run = async (verb: (folder: string, rootId: string) => Promise<{ ok: boolean }>): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await verb(folder, rootId)
    setBusy(false)
    if (result.ok) props.onClose()
    else setError('That did not go through — the status bar has the details.')
  }

  const clean = drift?.status === 'clean'

  return (
    <Modal
      title={clean ? `${props.name} matches its prefab` : `${props.name} differs from its prefab`}
      onClose={busy ? undefined : props.onClose}
      scrimClose={!busy}
      footer={
        <>
          <Button disabled={busy} onClick={props.onClose}>
            Close
          </Button>
          {!clean && (
            <>
              <ConfirmButton
                label="Update from prefab"
                confirm="Lose this instance's changes?"
                disabled={busy || drift === null}
                onConfirm={() => void run(uiUpdateInstanceFromPrefab)}
              />
              <ConfirmButton
                label="Save over prefab"
                confirm="Make this the prefab?"
                disabled={busy || drift === null}
                onConfirm={() => void run(uiSaveOverPrefab)}
              />
            </>
          )}
        </>
      }
    >
      {drift === null && error === null && (
        <p className="eui-prefab-drift-busy" role="status">
          <Spinner size={14} /> Comparing this instance with {props.folder}…
        </p>
      )}

      {drift?.status === 'clean' && (
        <p>Nothing on this instance differs from the prefab folder.</p>
      )}

      {drift?.status === 'unknown' && (
        <p>
          This instance cannot be compared with its folder — a prefab with several roots is placed
          under a container the folder never described. Both verbs still work, but they reshape the
          prefab.
        </p>
      )}

      {drift !== null && drift.status !== 'clean' && (
        <>
          <DriftList title="added to this instance" entries={drift.added} />
          <DriftList title="changed on this instance" entries={drift.changed} />
          <DriftList title="removed from this instance" entries={drift.removed} />
          <p>
            There is no per-property apply yet: both verbs work on the whole subtree, and each one
            discards what the other would keep.
          </p>
          <p>
            <strong>Save over prefab</strong> makes this instance the prefab. Clones spawn from it
            from now on. Other placed instances keep what they have and will start showing as
            drifted themselves.
          </p>
          <p>
            <strong>Update from prefab</strong> replaces everything you changed here with the
            prefab&apos;s version — including customisations elsewhere in this subtree, which are
            lost wholesale. It does not undo in one step. Where the copy sits and how it is placed
            are kept: the same position, the same name, and still &ldquo;Editing only&rdquo; if it
            was.
          </p>
        </>
      )}

      {busy && (
        <p className="eui-prefab-drift-busy" role="status">
          <Spinner size={14} /> Working…
        </p>
      )}
      {error !== null && (
        <p className="eui-prefab-drift-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
