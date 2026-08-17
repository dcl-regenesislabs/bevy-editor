// The world's own title, description and thumbnail. Read fresh on mount (the
// worlds store's copy is for display), saved as a partial update.
import { useEffect, useRef, useState } from 'react'
import { Button, FieldLabel, Spinner, TextArea, TextInput, useLoad } from '../../ds'
import { GlobeIcon } from './common'
import {
  fetchWorldSettings,
  saveWorldSettings,
  textError,
  thumbnailError,
  THUMBNAIL_TYPES,
  TITLE_MAX,
  type WorldSettings,
  type WorldSettingsEdit
} from './settings'
import { patchWorldSettings } from './worlds-store'

export function SettingsTab(props: { world: string }): JSX.Element {
  const { data, err, reload } = useLoad(() => fetchWorldSettings(props.world), [props.world])
  return (
    <section className="eui-world-block">
      <h2>World settings</h2>
      <p className="eui-world-hint">
        How the world itself is presented — in Places, and anywhere it is listed. Scenes published here keep their own
        titles and thumbnails.
      </p>
      {err !== null ? (
        <p className="eui-world-hint">
          {err} <button className="eui-link" onClick={reload}>Retry</button>
        </p>
      ) : data === undefined ? (
        <p className="eui-world-hint"><Spinner size="sm" /> Loading…</p>
      ) : (
        <SettingsForm key={props.world} world={props.world} loaded={data} />
      )}
    </section>
  )
}

function SettingsForm(props: { world: string; loaded: WorldSettings }): JSX.Element {
  const [current, setCurrent] = useState(props.loaded)
  const [title, setTitle] = useState(current.title ?? '')
  const [description, setDescription] = useState(current.description ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (file === null) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const titleErr = textError('title', title, current.title)
  const descErr = textError('description', description, current.description)
  const edit: WorldSettingsEdit = {}
  if (titleErr === null && title.trim() !== '' && title.trim() !== current.title) edit.title = title.trim()
  if (descErr === null && description.trim() !== '' && description.trim() !== current.description) {
    edit.description = description.trim()
  }
  if (file !== null) edit.thumbnail = file
  const dirty = Object.keys(edit).length > 0
  const blocked = titleErr !== null || descErr !== null

  const save = (): void => {
    setBusy(true)
    setErr(null)
    saveWorldSettings(props.world, edit)
      .then((next) => {
        patchWorldSettings(props.world, next)
        setCurrent(next)
        setTitle(next.title ?? '')
        setDescription(next.description ?? '')
        setFile(null)
        setPreview(null)
        setSaved(true)
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }

  const shown = preview ?? current.thumbnail

  return (
    <div className="eui-worldset">
      <div className="eui-worldset-field">
        <FieldLabel sublabel="PNG, JPG, GIF or WebP, up to 1 MB. 16:9 looks best.">Thumbnail</FieldLabel>
        <div className="eui-worldset-thumb">
          {shown !== null ? (
            <img src={shown} alt="" crossOrigin="anonymous" />
          ) : (
            <div className="ph"><GlobeIcon size={22} /></div>
          )}
          <div className="pick">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => picker.current?.click()}>
              {shown !== null ? 'Replace image' : 'Choose image'}
            </Button>
            {file !== null && <span className="fn">{file.name}</span>}
          </div>
          <input
            ref={picker}
            type="file"
            accept={THUMBNAIL_TYPES.join(',')}
            style={{ display: 'none' }}
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null
              e.target.value = ''
              if (picked === null) return
              const bad = thumbnailError(picked)
              setErr(bad)
              setSaved(false)
              setFile(bad === null ? picked : null)
            }}
          />
        </div>
      </div>

      <div className="eui-worldset-field">
        <FieldLabel htmlFor="worldset-title" sublabel={`Shown instead of ${props.world}. Up to ${TITLE_MAX} characters.`}>
          Title
        </FieldLabel>
        <TextInput
          id="worldset-title"
          value={title}
          placeholder={props.world}
          disabled={busy}
          onChange={(e) => {
            setTitle(e.target.value)
            setSaved(false)
          }}
        />
        {titleErr !== null && <p className="eui-worldset-err">{titleErr}</p>}
      </div>

      <div className="eui-worldset-field">
        <FieldLabel htmlFor="worldset-desc">Description</FieldLabel>
        <TextArea
          id="worldset-desc"
          value={description}
          placeholder="What visitors will find here"
          disabled={busy}
          onChange={(e) => {
            setDescription(e.target.value)
            setSaved(false)
          }}
        />
        {descErr !== null && <p className="eui-worldset-err">{descErr}</p>}
      </div>

      {err !== null && <p className="eui-worldset-err">{err}</p>}

      <div className="eui-worldset-actions">
        <Button variant="primary" size="md" disabled={busy || blocked || !dirty} onClick={save}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
        {saved && !dirty && <span className="eui-worldset-ok">Saved — live for visitors now.</span>}
      </div>
    </div>
  )
}
