// Server storage manager: env keys, shared data and per-player data — all
// paginated, with full value inspect/copy/edit/create and two-step deletes.
import { useEffect, useState } from 'react'
import { Button, ConfirmButton, copyText, Modal, Pager, PanelState, Segmented, useLoad, usePageClamp } from '../../ds'
import {
  clearStorage,
  deleteEnvKey,
  deleteStorageValue,
  getStorageValue,
  listEnvKeys,
  listStoragePlayers,
  listStorageValues,
  putEnvKey,
  putStorageValue,
  type WorldDeployment
} from '../../worlds'
import { PublishFirst } from './common'

// ---- server storage: a full manager for env keys, shared data and per-player
// data. Everything is paginated; values can be inspected in full, copied,
// edited and created. One ValueManager serves both the world's shared /values
// and a single player's /players/{addr}/values (the `player` prop).
export function StorageTab(props: { realm: string; d: WorldDeployment | null }): JSX.Element {
  const [sub, setSub] = useState<'values' | 'players' | 'env'>('values')
  const [player, setPlayer] = useState<string | null>(null)
  if (props.d === null) return <PublishFirst what="Server storage" />
  if (!props.d.authoritativeMultiplayer) {
    return (
      <section className="eui-world-block">
        <h2>Server storage</h2>
        <p className="eui-world-hint">
          Server storage is available for scenes running server-authoritative multiplayer — set
          {' '}<code>"authoritativeMultiplayer": true</code> in the scene's scene.json and publish again.
        </p>
      </section>
    )
  }
  return (
    <section className="eui-world-block eui-storage">
      <div className="eui-world-subtabs">
        <h2>Server storage</h2>
        <Segmented
          value={sub}
          onChange={(v) => {
            setSub(v)
            setPlayer(null)
          }}
          options={[
            { value: 'values', label: 'Data' },
            { value: 'players', label: 'Players' },
            { value: 'env', label: 'Env keys' }
          ]}
        />
      </div>
      {sub === 'values' && <ValueManager realm={props.realm} />}
      {sub === 'players' &&
        (player === null ? (
          <PlayersManager realm={props.realm} onPick={setPlayer} />
        ) : (
          <>
            <button className="eui-back" onClick={() => setPlayer(null)}>← All players</button>
            <p className="eui-world-hint">
              Data your scene stored for <span className="eui-mono">{player}</span>.
            </p>
            <ValueManager realm={props.realm} player={player} />
          </>
        ))}
      {sub === 'env' && <EnvManager realm={props.realm} />}
    </section>
  )
}

const prettyJson = (v: unknown): string => JSON.stringify(v, null, 2) ?? ''

const inlineJson = (v: unknown): string => JSON.stringify(v) ?? ''

// what a value "is", at a glance
function valueHint(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return `array · ${v.length} item${v.length === 1 ? '' : 's'}`
  if (typeof v === 'object') return `object · ${Object.keys(v).length} field${Object.keys(v).length === 1 ? '' : 's'}`
  if (typeof v === 'string') return `text · ${v.length} chars`
  return typeof v
}

// Parse creator input leniently: valid JSON is taken as JSON, anything else is
// stored as a plain string — so `hello` works without quotes but `{"a":1}`
// still becomes an object.
function parseLoose(input: string): unknown {
  const t = input.trim()
  if (t === '') return ''
  try {
    return JSON.parse(t)
  } catch {
    return input
  }
}

// value editor: multiline, JSON-or-text, Save/Cancel
// A real place to edit JSON: modal with a large mono editor. `keyEditable` is
// the add-new flow. Saving parses leniently — valid JSON is stored as JSON,
// anything else as a plain string.
function ValueEditModal(props: {
  title: string
  initialKey?: string
  keyEditable?: boolean
  initialValue: string
  busy: boolean
  error: string | null
  onSave: (key: string, value: unknown) => void
  onClose: () => void
}): JSX.Element {
  const [key, setKey] = useState(props.initialKey ?? '')
  const [text, setText] = useState(props.initialValue)
  const [keyErr, setKeyErr] = useState(false)
  return (
    <Modal
      title={props.title}
      className="eui-value-modal"
      onClose={props.onClose}
      scrimClose={false}
      closeX
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={props.onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={props.busy}
            onClick={() => {
              if (props.keyEditable === true && key.trim() === '') {
                setKeyErr(true)
                return
              }
              props.onSave(key.trim(), parseLoose(text))
            }}
          >
            {props.busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {props.keyEditable === true ? (
        <input
          className="eui-input key"
          placeholder="key"
          value={key}
          autoFocus
          spellCheck={false}
          onChange={(e) => {
            setKey(e.target.value)
            setKeyErr(false)
          }}
        />
      ) : (
        <div className="eui-value-modal-key">{key}</div>
      )}
      <textarea
        className="eui-input body"
        value={text}
        spellCheck={false}
        autoFocus={props.keyEditable !== true}
        placeholder='{ "any": "JSON" } — or plain text'
        onChange={(e) => setText(e.target.value)}
      />
      <span className="eui-world-hint">JSON or plain text — invalid JSON is stored as a string.</span>
      {keyErr && <p className="eui-perm-err">Give the value a key</p>}
      {props.error !== null && <p className="eui-perm-err">{props.error}</p>}
    </Modal>
  )
}

// one data row: key + type hint, expandable to the full pretty-printed value
// with copy / edit / delete
function ValueRow(props: {
  realm: string
  player?: string
  itemKey: string
  value: unknown
  onChanged: () => void
  onError: (m: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editErr, setEditErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<'key' | 'value' | null>(null)
  const [full, setFull] = useState<unknown>(props.value)
  // the list payload already carries the value, but re-read on expand so what
  // you inspect is authoritative (another session may have written since)
  useEffect(() => {
    if (!open) return
    let live = true
    getStorageValue(props.realm, props.itemKey, props.player)
      .then((v) => live && setFull(v))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [open])
  const run = (fn: Promise<void>): void => {
    setBusy(true)
    fn.then(() => {
      setEditing(false)
      props.onChanged()
    })
      .catch((e: unknown) => props.onError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }
  const flagCopied = (what: 'key' | 'value'): void => {
    setCopied(what)
    setTimeout(() => setCopied(null), 1400)
  }
  return (
    <div className={`eui-value-row ${open ? 'open' : ''}`}>
      <button className="eui-value-head" onClick={() => setOpen((v) => !v)}>
        <span className="tw">{open ? '▾' : '▸'}</span>
        <span className="ky">{props.itemKey}</span>
        <span className="hint">{valueHint(open ? full : props.value)}</span>
        {!open && <span className="pv">{inlineJson(props.value).slice(0, 60)}</span>}
      </button>
      {editing && (
        <ValueEditModal
          title={`Edit value`}
          initialKey={props.itemKey}
          initialValue={prettyJson(full)}
          busy={busy}
          error={editErr}
          onSave={(_k, v) => {
            setBusy(true)
            setEditErr(null)
            putStorageValue(props.realm, props.itemKey, v, props.player)
              .then(() => {
                setEditing(false)
                setFull(v)
                props.onChanged()
              })
              .catch((e: unknown) => setEditErr(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false))
          }}
          onClose={() => setEditing(false)}
        />
      )}
      {open && (
        <div className="eui-value-body">
          {(
            <>
              <pre>{prettyJson(full)}</pre>
              <div className="eui-value-actions">
                <Button variant="ghost" size="sm" onClick={() => copyText(props.itemKey, () => flagCopied('key'))}>
                  {copied === 'key' ? 'Copied ✓' : 'Copy key'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => copyText(prettyJson(full), () => flagCopied('value'))}>
                  {copied === 'value' ? 'Copied ✓' : 'Copy value'}
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(true)}>Edit</Button>
                <ConfirmButton
                  label="Delete"
                  confirm="Delete for real?"
                  disabled={busy}
                  onConfirm={() => run(deleteStorageValue(props.realm, props.itemKey, props.player))}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// the paginated key-value manager (world data, or one player's data)
function ValueManager(props: { realm: string; player?: string }): JSX.Element {
  const [offset, setOffset] = useState(0)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actErr, setActErr] = useState<string | null>(null)
  const { data, err, reload } = useLoad(
    () => listStorageValues(props.realm, offset, props.player),
    [props.realm, props.player, offset]
  )
  usePageClamp(data, offset, setOffset)
  const onErr = (m: string): void => setActErr(m)
  const changed = (): void => {
    setActErr(null)
    reload()
  }
  return (
    <>
      {props.player === undefined && (
        <p className="eui-world-hint">Shared key-value data your scene stores on the server.</p>
      )}
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data?.items.map((it) => (
        <ValueRow
          key={it.key}
          realm={props.realm}
          player={props.player}
          itemKey={it.key}
          value={it.value}
          onChanged={changed}
          onError={onErr}
        />
      ))}
      {data !== undefined && data.total === 0 && <p className="eui-world-hint">Nothing stored yet.</p>}
      <Pager page={data} onOffset={setOffset} />
      {adding && (
        <ValueEditModal
          title="Add value"
          keyEditable
          initialValue=""
          busy={busy}
          error={actErr}
          onSave={(k, v) => {
            setBusy(true)
            setActErr(null)
            putStorageValue(props.realm, k, v, props.player)
              .then(() => {
                setAdding(false)
                reload()
              })
              .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false))
          }}
          onClose={() => {
            setAdding(false)
            setActErr(null)
          }}
        />
      )}
      {(
        <div className="eui-signin-row">
          <Button size="sm" onClick={() => setAdding(true)}>+ Add value</Button>
          {data !== undefined && data.total > 0 && (
            <ConfirmButton
              label={props.player !== undefined ? "Clear this player's data" : 'Delete all data'}
              confirm="Delete everything?"
              onConfirm={() => {
                setActErr(null)
                clearStorage(props.realm, props.player !== undefined ? { player: props.player } : 'values')
                  .then(reload)
                  .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
              }}
            />
          )}
        </div>
      )}
      {actErr !== null && <p className="eui-perm-err">{actErr}</p>}
    </>
  )
}

// paginated players list; picking one drills into their ValueManager
function PlayersManager(props: { realm: string; onPick: (address: string) => void }): JSX.Element {
  const [offset, setOffset] = useState(0)
  const [actErr, setActErr] = useState<string | null>(null)
  const { data, err, reload } = useLoad(() => listStoragePlayers(props.realm, offset), [props.realm, offset])
  usePageClamp(data, offset, setOffset)
  return (
    <>
      <p className="eui-world-hint">Players your scene stored data for — open one to inspect and manage it.</p>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data?.items.map((addr) => (
        <button key={addr} className="eui-value-head eui-player-row" onClick={() => props.onPick(addr)}>
          <span className="ky eui-mono">{addr}</span>
          <span className="tw">›</span>
        </button>
      ))}
      {data !== undefined && data.total === 0 && <p className="eui-world-hint">No player data stored yet.</p>}
      <Pager page={data} onOffset={setOffset} />
      {data !== undefined && data.total > 0 && (
        <div className="eui-signin-row">
          <ConfirmButton
            label="Delete every player's data"
            confirm="Delete everything?"
            onConfirm={() => {
              setActErr(null)
              clearStorage(props.realm, 'players')
                .then(reload)
                .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
            }}
          />
        </div>
      )}
      {actErr !== null && <p className="eui-perm-err">{actErr}</p>}
    </>
  )
}

// env keys: write-only secrets — list, set (create/overwrite), delete, wipe
function EnvManager(props: { realm: string }): JSX.Element {
  const [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState(false)
  const [actErr, setActErr] = useState<string | null>(null)
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  const { data, err, reload } = useLoad(() => listEnvKeys(props.realm, offset), [props.realm, offset])
  usePageClamp(data, offset, setOffset)
  const run = (fn: Promise<void>): void => {
    setBusy(true)
    setActErr(null)
    fn.then(reload)
      .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <p className="eui-world-hint">
        Secrets your scene's server code reads at runtime (API keys etc.) — values can be set but never read back.
      </p>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data?.items.map((key) => (
        <div key={key} className="eui-perm-row">
          {/* values are write-only: overwriting means setting the same key again */}
          <button className="eui-link mono" data-tip="Overwrite: prefills the key below" onClick={() => setK(key)}>
            {key}
          </button>
          <span style={{ flex: 1 }} />
          <ConfirmButton label="Delete" disabled={busy} onConfirm={() => run(deleteEnvKey(props.realm, key))} />
        </div>
      ))}
      {data !== undefined && data.total === 0 && <p className="eui-world-hint">No env keys yet.</p>}
      <Pager page={data} onOffset={setOffset} />
      <div className="eui-perm-add">
        <input className="eui-input" placeholder="KEY" value={k} spellCheck={false} onChange={(e) => setK(e.target.value)} />
        <input className="eui-input" placeholder="value" value={v} spellCheck={false} onChange={(e) => setV(e.target.value)} />
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || k.trim() === '' || v === ''}
          onClick={() => {
            setBusy(true)
            setActErr(null)
            putEnvKey(props.realm, k.trim(), v)
              .then(() => {
                // clear only on success — a 413/429 must not eat the typed value
                setK('')
                setV('')
                reload()
              })
              .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? '…' : 'Set'}
        </Button>
      </div>
      {data !== undefined && data.total > 0 && (
        <ConfirmButton
          label="Delete all env keys"
          confirm="Delete everything?"
          disabled={busy}
          onConfirm={() => run(clearStorage(props.realm, 'env'))}
        />
      )}
      {actErr !== null && <p className="eui-perm-err">{actErr}</p>}
    </>
  )
}
