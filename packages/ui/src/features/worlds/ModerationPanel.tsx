// Scene admins + bans for the live scene (comms-gatekeeper).
import { useState } from 'react'
import { Button, PanelState, Segmented, useLoad } from '../../ds'
import {
  addSceneAdmin,
  listSceneAdmins,
  listSceneBans,
  removeSceneAdmin,
  setSceneBan,
  type SceneScope
} from '../../worlds'
import { ADDRESS_RE, PublishFirst, shortAddr } from './common'

// ---- moderation (scene admins + bans) ----
export function ModerationPanel(props: { scope: SceneScope | null }): JSX.Element {
  const [sub, setSub] = useState<'admins' | 'bans'>('admins')
  if (props.scope === null) return <PublishFirst what="Moderation" />
  return (
    <section className="eui-world-block">
      <div className="eui-world-subtabs">
        <h2>Moderation</h2>
        <Segmented
          value={sub}
          onChange={setSub}
          options={[
            { value: 'admins', label: 'Admins' },
            { value: 'bans', label: 'Bans' }
          ]}
        />
      </div>
      {sub === 'admins' ? <AdminsList scope={props.scope} /> : <BansList scope={props.scope} />}
    </section>
  )
}

// shared add-row: a wallet address or a DCL name, Enter or button to submit
function AddByAddressOrName(props: { placeholder: string; busy: boolean; onAdd: (v: string) => void }): JSX.Element {
  const [v, setV] = useState('')
  const submit = (): void => {
    const t = v.trim()
    if (t === '') return
    props.onAdd(t)
    setV('')
  }
  return (
    <div className="eui-perm-add">
      <input
        className="eui-input"
        placeholder={props.placeholder}
        value={v}
        spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <Button size="sm" disabled={props.busy || v.trim() === ''} onClick={submit}>
        {props.busy ? '…' : 'Add'}
      </Button>
    </div>
  )
}

function AdminsList(props: { scope: SceneScope }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [actErr, setActErr] = useState<string | null>(null)
  const { data, err, reload } = useLoad(() => listSceneAdmins(props.scope), [props.scope.sceneId])
  const run = (fn: Promise<void>): void => {
    setBusy(true)
    setActErr(null)
    fn.then(reload)
      .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <p className="eui-world-hint">Admins can moderate the world in-game: kick and ban visitors, manage streams.</p>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data?.map((a) => (
        <div key={a.admin} className="eui-perm-row">
          <span className="nm">{a.name !== '' ? a.name : shortAddr(a.admin)}</span>
          <span className="wa">{a.admin}</span>
          <span style={{ flex: 1 }} />
          {a.canBeRemoved ? (
            <button className="eui-link" disabled={busy} onClick={() => run(removeSceneAdmin(props.scope, a.admin))}>
              Remove
            </button>
          ) : (
            <span className="eui-world-chip">Owner</span>
          )}
        </div>
      ))}
      {data !== undefined && data.length === 0 && <p className="eui-world-hint">No extra admins yet.</p>}
      <AddByAddressOrName
        placeholder="0x address or DCL name"
        busy={busy}
        onAdd={(v) => run(addSceneAdmin(props.scope, ADDRESS_RE.test(v) ? { admin: v } : { name: v }))}
      />
      {actErr !== null && <p className="eui-perm-err">{actErr}</p>}
    </>
  )
}

function BansList(props: { scope: SceneScope }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [actErr, setActErr] = useState<string | null>(null)
  const { data, err, reload } = useLoad(() => listSceneBans(props.scope), [props.scope.sceneId])
  const run = (fn: Promise<void>): void => {
    setBusy(true)
    setActErr(null)
    fn.then(reload)
      .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <p className="eui-world-hint">People banned from entering this world.</p>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data?.bans.map((b) => (
        <div key={b.bannedAddress !== '' ? b.bannedAddress : b.name} className="eui-perm-row">
          <span className="nm">{b.name !== '' ? b.name : shortAddr(b.bannedAddress)}</span>
          <span className="wa">{b.bannedAddress}</span>
          <span style={{ flex: 1 }} />
          <button
            className="eui-link"
            disabled={busy}
            onClick={() =>
              run(setSceneBan(props.scope, b.bannedAddress !== '' ? { address: b.bannedAddress } : { name: b.name }, false))
            }
          >
            Unban
          </button>
        </div>
      ))}
      {data !== undefined && data.bans.length === 0 && <p className="eui-world-hint">Nobody is banned.</p>}
      {data !== undefined && data.total > data.bans.length && (
        <p className="eui-world-hint">Showing the first {data.bans.length} of {data.total}.</p>
      )}
      <AddByAddressOrName
        placeholder="0x address or DCL name to ban"
        busy={busy}
        onAdd={(v) => run(setSceneBan(props.scope, ADDRESS_RE.test(v) ? { address: v } : { name: v }, true))}
      />
      {actErr !== null && <p className="eui-perm-err">{actErr}</p>}
    </>
  )
}
