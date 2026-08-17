import { useState } from 'react'
import type { PrefabImportInspect, PrefabImportPreview } from '@dcl-editor/contract'
import { Button, Modal, Spinner, TextInput } from '../ds'
import { uiCommitPrefabImport } from '../actions/prefabs'
import {
  cancelPrefabImport,
  importPrefabFromGithub,
  pickPrefabImport,
  unknownComponents
} from '../prefabs/library'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function carriesLine(scripts: number, guides: number): string {
  const runs =
    scripts === 0
      ? 'It carries no scripts'
      : `It carries ${scripts} script${scripts === 1 ? '' : 's'} that run in your scene`
  if (guides === 0) return `${runs}.`
  const guide = guides === 1 ? 'an AI guide' : `${guides} AI guides`
  return `${runs}, and ${guide} the in-app assistant reads as instructions.`
}

export function PrefabImportDialog(props: { onClose: () => void }): JSX.Element {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PrefabImportPreview | null>(null)

  const stage = async (run: () => Promise<PrefabImportInspect | null>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await run()
      if (result === null) return
      if (result.ok) setPreview(result.preview)
      else setError(result.reason)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const close = (): void => {
    if (preview !== null) cancelPrefabImport(preview.token)
    props.onClose()
  }

  const confirm = (): void => {
    if (preview === null) return
    const token = preview.token
    setPreview(null)
    props.onClose()
    void uiCommitPrefabImport(token)
  }

  if (preview !== null) {
    return (
      <PrefabImportPreviewModal preview={preview} onCancel={close} onConfirm={confirm} />
    )
  }

  return (
    <Modal
      title="Import a prefab"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || url.trim() === ''}
            onClick={() => void stage(() => importPrefabFromGithub(url.trim()))}
          >
            Fetch from GitHub
          </Button>
        </>
      }
    >
      <p>
        A prefab is a folder with a <code>data.json</code> and a <code>composite.json</code>.
        Imported prefabs go into your library, not straight into this scene.
      </p>
      <div className="eui-prefab-import-sources">
        <Button disabled={busy} onClick={() => void stage(() => pickPrefabImport('folder'))}>
          Choose a folder…
        </Button>
        <Button disabled={busy} onClick={() => void stage(() => pickPrefabImport('zip'))}>
          Choose a .zip…
        </Button>
      </div>
      <TextInput
        placeholder="https://github.com/owner/repo/tree/main/prefabs/door"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && url.trim() !== '') void stage(() => importPrefabFromGithub(url.trim()))
        }}
      />
      <p style={{ opacity: 0.8 }}>
        A GitHub import is pinned to the commit it was fetched at, so it never changes under you.
      </p>
      {busy && (
        <div className="eui-prefab-import-busy">
          <Spinner size="sm" /> Reading the prefab…
        </div>
      )}
      {error !== null && <p className="eui-prefab-import-error">{error}</p>}
    </Modal>
  )
}

function PrefabImportPreviewModal(props: {
  preview: PrefabImportPreview
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  const { preview } = props
  const [open, setOpen] = useState<string | null>(null)
  const unknown = unknownComponents(preview.components)
  const guides = preview.scripts.filter((file) => file.kind === 'guide')
  const scripts = preview.scripts.filter((file) => file.kind === 'script')

  return (
    <Modal
      title={`Import ${preview.name}?`}
      onClose={props.onCancel}
      footer={
        <>
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button variant="primary" disabled={unknown.length > 0} onClick={props.onConfirm}>
            Add to my library
          </Button>
        </>
      }
    >
      <div className="eui-prefab-import-meta">
        <span>
          {preview.entities} entit{preview.entities === 1 ? 'y' : 'ies'}
        </span>
        <span>{preview.files.length} files</span>
        <span>
          {preview.origin.source === 'github'
            ? `${preview.origin.url ?? 'GitHub'}${preview.origin.commit === undefined ? '' : ` @ ${preview.origin.commit.slice(0, 7)}`}`
            : (preview.origin.url ?? 'local folder')}
        </span>
      </div>

      {preview.requiredPermissions.length > 0 && (
        <p className="eui-prefab-import-warn">
          It asks the scene for {preview.requiredPermissions.join(', ')} — those permissions are
          added to <code>scene.json</code> when you place it.
        </p>
      )}
      {unknown.length > 0 && (
        <p className="eui-prefab-import-warn">
          This prefab cannot be imported: it is built on components this editor does not know (
          {unknown.join(', ')}). Placing it would drop them and leave the prefab broken.
        </p>
      )}

      {preview.scripts.length === 0 ? (
        <p>This prefab carries no scripts — it is models and components only.</p>
      ) : (
        <>
          <p>
            <strong>{carriesLine(scripts.length, guides.length)}</strong> Read them before importing —
            this is someone else&apos;s code.
          </p>
          <ul className="eui-prefab-import-scripts">
            {preview.scripts.map((script) => (
              <li key={script.path}>
                <button
                  className="eui-prefab-import-script"
                  onClick={() => setOpen(open === script.path ? null : script.path)}
                >
                  <code>{script.path}</code>
                  <span>{formatSize(script.size)}</span>
                </button>
                {open === script.path && (
                  <pre className="eui-prefab-import-code">
                    {script.text}
                    {script.truncated ? '\n\n… truncated' : ''}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}
