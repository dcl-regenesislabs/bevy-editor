// Scene settings — the editable subset of scene.json: details (name,
// description, contact), the navmap thumbnail, the parcel layout (clickable
// grid + base selector) and spawn points. Loads through the shell, saves as
// one merge-write that preserves everything the editor doesn't model.
import { useEffect, useState } from 'react'
import { state } from '@scene/state'
import type { SceneSettings, SpawnPointSetting } from '@dcl-editor/contract'
import { Button, Checkbox, FieldLabel, Modal, NumberField, ParcelMap, Select, Spinner, TextArea, TextInput } from '../../ds'
import css from './scene-settings.css?inline'
import { registerCss } from '../../ds/styles/registry'

registerCss('features/scene-settings', 'features', css)

// what of the layout feeds the ENGINE's launch (parcels/base → position,
// spawn points → the overlay + Stop's respawn) — the caller relaunches the
// scene when this changed, since a running engine can't re-derive it
const layoutSig = (s: SceneSettings): string => JSON.stringify([s.parcels, s.base, s.spawnPoints])

export function SceneSettingsModal(props: {
  dir: string
  onClose: () => void
  onSaved?: (layoutChanged: boolean) => void
}): JSX.Element {
  const shell = window.editorShell
  const [s, setS] = useState<SceneSettings | null>(null)
  const [loadedSig, setLoadedSig] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void shell?.sceneSettings?.(props.dir)
      .then((loaded) => {
        setLoadedSig(layoutSig(loaded))
        setS(loaded)
      })
      .catch((e) => setErr(String(e)))
  }, [props.dir])

  const save = async (): Promise<void> => {
    if (s === null || shell?.saveSceneSettings === undefined) return
    setBusy(true)
    setErr(null)
    try {
      const problem = await shell.saveSceneSettings(props.dir, s)
      if (problem !== null) {
        setErr(problem)
        setBusy(false)
        return
      }
      // state.scene mirrors what the ENGINE loaded, so it keeps the old title
      // until the scene reloads — the topbar and the hierarchy's scene row both
      // read it, and both sat stale after a rename. Patch what we just wrote.
      if (state.scene !== undefined && s.title !== state.scene.title) {
        state.scene = { ...state.scene, title: s.title }
      }
      props.onSaved?.(layoutSig(s) !== loadedSig)
      props.onClose()
    } catch (e) {
      setErr(String(e))
      setBusy(false)
    }
  }

  const patch = (p: Partial<SceneSettings>): void => setS((cur) => (cur === null ? cur : { ...cur, ...p }))

  return (
    <Modal
      title="Scene settings"
      className="eui-scene-settings"
      onClose={props.onClose}
      scrimClose={!busy}
      footer={
        <div className="eui-ss-footer">
          {err !== null && <span className="err">{err}</span>}
          <span style={{ flex: 1 }} />
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" disabled={s === null || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      {s === null ? (
        <div className="eui-ss-loading">{err ?? <Spinner size="md" />}</div>
      ) : (
        <div className="eui-ss-body">
          <section>
            <div className="eui-ss-head">Details</div>
            <FieldLabel>Name</FieldLabel>
            <TextInput className="fld" value={s.title} onChange={(e) => patch({ title: e.target.value })} />
            <FieldLabel>Description</FieldLabel>
            <TextArea className="fld" rows={3} value={s.description} onChange={(e) => patch({ description: e.target.value })} />
            <div className="eui-ss-two">
              <div>
                <FieldLabel>Contact name</FieldLabel>
                <TextInput className="fld" value={s.contactName} onChange={(e) => patch({ contactName: e.target.value })} />
              </div>
              <div>
                <FieldLabel>Contact email</FieldLabel>
                <TextInput className="fld" value={s.contactEmail} onChange={(e) => patch({ contactEmail: e.target.value })} />
              </div>
            </div>
          </section>

          <section>
            <div className="eui-ss-head">Thumbnail</div>
            <div className="eui-ss-thumb">
              {s.thumbnail !== null ? <img src={s.thumbnail} alt="" /> : <span className="none">No thumbnail</span>}
            </div>
            <Button
              onClick={() =>
                void shell?.pickSceneThumbnail?.(props.dir).then((r) => {
                  if (r !== null && r !== undefined) patch({ thumbnailPath: r.path, thumbnail: r.dataUrl })
                })
              }
            >
              Change thumbnail…
            </Button>
          </section>

          <section>
            <div className="eui-ss-head">Parcels</div>
            <ParcelMap
              regions={[{ key: 'scene', parcels: s.parcels, base: s.base, label: 'This scene', tone: 0 }]}
              onToggle={(coord) => {
                const next = s.parcels.includes(coord)
                  ? s.parcels.filter((p) => p !== coord)
                  : [...s.parcels, coord]
                patch({ parcels: next, base: next.includes(s.base) ? s.base : (next[0] ?? '') })
              }}
            />
            <div className="eui-ss-two">
              <div>
                <FieldLabel sublabel={`${s.parcels.length} parcel${s.parcels.length === 1 ? '' : 's'}`}>
                  Base parcel
                </FieldLabel>
                <Select
                  value={s.base}
                  options={s.parcels.map((p) => ({ value: p, label: p }))}
                  onChange={(base) => patch({ base })}
                  aria-label="Base parcel"
                />
              </div>
            </div>
          </section>

          <section>
            <div className="eui-ss-head">Spawn points</div>
            {s.spawnPoints.map((sp, i) => (
              <SpawnRow
                key={i}
                sp={sp}
                onChange={(next) => patch({ spawnPoints: s.spawnPoints.map((p, j) => (j === i ? next : p)) })}
                onRemove={() => patch({ spawnPoints: s.spawnPoints.filter((_, j) => j !== i) })}
              />
            ))}
            <Button
              onClick={() =>
                patch({
                  spawnPoints: [
                    ...s.spawnPoints,
                    {
                      name: `Spawn Point ${s.spawnPoints.length + 1}`,
                      default: s.spawnPoints.length === 0,
                      position: { x: 8, y: 0, z: 8 }
                    }
                  ]
                })
              }
            >
              + Add spawn point
            </Button>
          </section>
        </div>
      )}
    </Modal>
  )
}

function SpawnRow(props: {
  sp: SpawnPointSetting
  onChange: (sp: SpawnPointSetting) => void
  onRemove: () => void
}): JSX.Element {
  const { sp } = props
  const pos = (k: 'x' | 'y' | 'z', v: number): void =>
    props.onChange({ ...sp, position: { ...sp.position, [k]: v } })
  const cam = (k: 'x' | 'y' | 'z', v: number): void =>
    props.onChange({ ...sp, cameraTarget: { x: 0, y: 0, z: 0, ...(sp.cameraTarget ?? {}), [k]: v } })
  return (
    <div className="eui-ss-spawn">
      <div className="line">
        <TextInput className="nm fld" value={sp.name} onChange={(e) => props.onChange({ ...sp, name: e.target.value })} />
        <Checkbox checked={sp.default} onChange={(on) => props.onChange({ ...sp, default: on })}>
          default
        </Checkbox>
        <button className="eui-link" onClick={props.onRemove}>Remove</button>
      </div>
      <div className="line">
        <span className="lbl">Position</span>
        {(['x', 'y', 'z'] as const).map((k) => (
          <label key={k} className="axis">
            <span>{k}</span>
            <NumberField className="n" value={sp.position[k]} step={0.5} aria-label={`position ${k}`}
              onChange={(e) => pos(k, Number(e.target.value))} />
          </label>
        ))}
      </div>
      <div className="line">
        <span className="lbl">Camera target</span>
        {sp.cameraTarget !== undefined ? (
          <>
            {(['x', 'y', 'z'] as const).map((k) => (
              <label key={k} className="axis">
                <span>{k}</span>
                <NumberField className="n" value={sp.cameraTarget?.[k] ?? 0} step={0.5} aria-label={`camera target ${k}`}
                  onChange={(e) => cam(k, Number(e.target.value))} />
              </label>
            ))}
            <button className="eui-link" onClick={() => props.onChange({ ...sp, cameraTarget: undefined })}>✕</button>
          </>
        ) : (
          <button className="eui-link" onClick={() => props.onChange({ ...sp, cameraTarget: { x: sp.position.x, y: sp.position.y, z: sp.position.z + 1 } })}>
            Set
          </button>
        )}
      </div>
    </div>
  )
}
