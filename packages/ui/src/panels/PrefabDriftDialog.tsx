import { useEffect, useState } from 'react'
import { Button, Chip, ConfirmButton, Modal, Spinner } from '../ds'
import { instanceDriftFor, uiSaveOverPrefab, uiUpdateInstanceFromPrefab } from '../actions/drift'
import type { DriftEntry, DriftResult } from '../prefabs/drift'

const LISTED = 8

const COMPONENT_WORDS: Record<string, string> = {
  'core::GltfContainer': 'the 3D model',
  'core::Transform': 'position, rotation or size',
  'core::Material': 'the material',
  'core::VisibilityComponent': 'visibility',
  'core::MeshRenderer': 'the shape',
  'core::MeshCollider': 'the collider',
  'core::Animator': 'animations',
  'core::AudioSource': 'the sound',
  'core::PointerEvents': 'the click',
  'core::TextShape': 'the text',
  'core::VideoPlayer': 'the video',
  'core::LightSource': 'the light',
  'core::TriggerArea': 'the trigger area',
  'asset-packs::Script': 'a script or its settings',
  'core-schema::Name': 'the name'
}

function describeChange(entry: DriftEntry): string {
  return COMPONENT_WORDS[entry.component] ?? entry.component.replace(/^.*::/, '')
}

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
          <li key={`${entry.localId}/${entry.component}`}>{describeChange(entry)}</li>
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
                confirm="Lose this copy's changes?"
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
          <Spinner size="sm" /> Comparing this copy with its prefab…
        </p>
      )}

      {drift?.status === 'clean' && (
        <p>Nothing on this copy differs from the prefab.</p>
      )}

      {drift?.status === 'unknown' && (
        <p>
          This copy cannot be compared with its prefab — it is arranged differently than the prefab
          describes. You can still use the buttons below, but they change the prefab&apos;s shape.
        </p>
      )}

      {drift !== null && drift.status !== 'clean' && (
        <>
          <DriftList title="added to this copy" entries={drift.added} />
          <DriftList title="changed on this copy" entries={drift.changed} />
          <DriftList title="removed from this copy" entries={drift.removed} />
          <p>
            This copy and its prefab no longer match. The copies your game spawns always come from
            the prefab, so pick which version is the real one:
          </p>
          <p>
            <strong>Save over prefab</strong> — this copy is the one you want. The prefab becomes
            exactly this, and everything spawned from now on matches it.
          </p>
          <p>
            <strong>Update from prefab</strong> — the prefab is the one you want. This copy is
            replaced with the prefab&apos;s version, keeping its position and name. Changes you
            made only on this copy are lost.
          </p>
        </>
      )}

      {busy && (
        <p className="eui-prefab-drift-busy" role="status">
          <Spinner size="sm" /> Working…
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
