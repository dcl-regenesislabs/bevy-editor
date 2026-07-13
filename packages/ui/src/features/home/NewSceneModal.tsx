import { useEffect, useState } from 'react'
import type { EditorShell, SceneTemplate } from '@dcl-editor/contract'
import { Button, Modal } from '../../ds'
import { FolderIcon } from './SceneCard'

const PlusIcon = (): JSX.Element => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

// Add-a-scene modal, two steps: choose (create new | open existing), then the
// create form (template + name + location).
export function NewSceneModal(props: {
  shell: EditorShell
  onClose: () => void
  onCreated: (dir: string) => void
  onOpenExisting?: () => void
}): JSX.Element {
  const { shell } = props
  const [step, setStep] = useState<'choose' | 'create'>(props.onOpenExisting !== undefined ? 'choose' : 'create')
  const [templates, setTemplates] = useState<SceneTemplate[]>([])
  const [template, setTemplate] = useState('blank')
  const [name, setName] = useState('My Scene')
  const [parent, setParent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    void shell.sceneTemplates?.().then((t) => {
      setTemplates(t)
      if (t[0] !== undefined) setTemplate(t[0].id)
    })
  }, [])
  const create = async (): Promise<void> => {
    if (parent === null || name.trim() === '') return
    setBusy(true)
    setErr(null)
    try {
      const dir = await shell.createScene?.(parent, name, template)
      if (dir === null || dir === undefined) throw new Error('could not create the scene')
      props.onCreated(dir)
    } catch (e) {
      setErr(String(e))
      setBusy(false)
    }
  }

  if (step === 'choose') {
    return (
      <Modal title="Add a scene" className="eui-home-modal" onClose={props.onClose}>
        <div className="eui-choice-grid">
          <button className="eui-choice-card" onClick={() => setStep('create')}>
            <span className="ic"><PlusIcon /></span>
            <span className="nm">Create a new scene</span>
            <span className="ds">Start from a template — a blank parcel or a small SDK7 example.</span>
          </button>
          <button className="eui-choice-card" onClick={props.onOpenExisting}>
            <span className="ic"><FolderIcon /></span>
            <span className="nm">Open an existing scene</span>
            <span className="ds">Pick a folder on this computer that already contains a scene.</span>
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="New scene"
      className="eui-home-modal"
      onClose={props.onClose}
      footer={
        <>
          {props.onOpenExisting !== undefined && (
            <Button variant="ghost" size="sm" onClick={() => setStep('choose')}>‹ Back</Button>
          )}
          <span style={{ flex: 1 }} />
          <Button
            variant="primary"
            size="sm"
            disabled={busy || parent === null || name.trim() === '' || templates.length === 0}
            onClick={() => void create()}
          >
            {busy ? 'Creating…' : 'Create scene'}
          </Button>
        </>
      }
    >
      <>
        <div className="eui-home-field">
          <label className="eui-home-flabel">Template</label>
          <div className="eui-tpl-grid">
            {templates.map((t) => (
              <button key={t.id} className={`eui-tpl-card ${t.id === template ? 'on' : ''}`} onClick={() => setTemplate(t.id)}>
                <span className="nm">{t.name}</span>
                <span className="ds">{t.description}</span>
              </button>
            ))}
            {templates.length === 0 && <div className="eui-home-empty">No templates bundled.</div>}
          </div>
        </div>
        <div className="eui-home-field">
          <label className="eui-home-flabel">Name</label>
          <input className="eui-input" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
        </div>
        <div className="eui-home-field">
          <label className="eui-home-flabel">Location</label>
          {/* the whole row is the picker — no floating side button */}
          <button
            className={`eui-loc-btn ${parent === null ? 'ph' : ''}`}
            onClick={() => void shell.pickFolder?.().then((d) => d !== null && d !== undefined && setParent(d))}
          >
            <FolderIcon />
            <span className="path">{parent ?? 'Choose where to create it…'}</span>
            <span className="act">{parent === null ? 'Browse' : 'Change'}</span>
          </button>
        </div>
        {err !== null && <div className="eui-script-err">{err}</div>}
      </>
    </Modal>
  )
}
