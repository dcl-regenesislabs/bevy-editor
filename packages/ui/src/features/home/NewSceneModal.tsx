import { useEffect, useState } from 'react'
import type { EditorShell, SceneTemplate } from '@dcl-editor/contract'
import { Button, Modal } from '../../ds'

// New-scene modal: pick a template + name + location, then scaffold from a
// bundled template folder and open it.
export function NewSceneModal(props: { shell: EditorShell; onClose: () => void; onCreated: (dir: string) => void }): JSX.Element {
  const { shell } = props
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
  return (
    <Modal
      title="New scene"
      className="eui-home-modal"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={props.onClose}>Cancel</Button>
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
            <div className="eui-home-loc">
              <span className={`path ${parent === null ? 'ph' : ''}`}>{parent ?? 'Choose a folder…'}</span>
              <Button variant="ghost" size="sm" onClick={() => void shell.pickFolder?.().then((d) => d !== null && d !== undefined && setParent(d))}>
                {parent === null ? 'Choose…' : 'Change…'}
              </Button>
            </div>
          </div>
          {err !== null && <div className="eui-script-err">{err}</div>}
      </>
    </Modal>
  )
}
