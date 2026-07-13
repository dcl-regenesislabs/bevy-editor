// World permissions: the deployment/access/streaming allow-lists.
import { useEffect, useState } from 'react'
import { Button, Chip, Spinner } from '../../ds'
import { fetchWorldPermissions, setWorldPermission, type WorldPermissionKind, type WorldPermissions } from '../../worlds'
import { ADDRESS_RE } from './common'

const PERMISSION_COPY: Record<WorldPermissionKind, { title: string; hint: string }> = {
  deployment: { title: 'Who can publish', hint: 'Wallets allowed to publish scenes to this world (the owner always can).' },
  access: { title: 'Who can visit', hint: 'Who can enter the world.' },
  streaming: { title: 'Who can stream', hint: 'Wallets allowed to stream video/audio inside the world.' }
}

export function AccessPanel(props: { world: string; wallet: string }): JSX.Element {
  const [perms, setPerms] = useState<WorldPermissions | null | 'loading'>('loading')
  const load = (): void => {
    void fetchWorldPermissions(props.world).then(setPerms)
  }
  useEffect(load, [props.world])

  if (perms === 'loading') {
    return (
      <section className="eui-world-block">
        <h2>Permissions</h2>
        <div className="eui-world-hint"><Spinner size={16} /> Loading…</div>
      </section>
    )
  }
  if (perms === null) {
    return (
      <section className="eui-world-block">
        <h2>Permissions</h2>
        <p className="eui-world-hint">Couldn't load this world's permissions. <button className="eui-link" onClick={load}>Retry</button></p>
      </section>
    )
  }
  const isOwner = perms.owner === props.wallet.toLowerCase()
  return (
    <section className="eui-world-block">
      <h2>Permissions</h2>
      {(['deployment', 'access', 'streaming'] as WorldPermissionKind[]).map((kind) => (
        <PermissionList key={kind} kind={kind} world={props.world} entry={perms[kind]} isOwner={isOwner} onChanged={load} />
      ))}
      {!isOwner && <p className="eui-world-hint">Only the world owner can change permissions.</p>}
    </section>
  )
}

function PermissionList(props: {
  kind: WorldPermissionKind
  world: string
  entry: { type: string; wallets: string[] }
  isOwner: boolean
  onChanged: () => void
}): JSX.Element {
  const { entry, kind } = props
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isList = entry.type === 'allow-list'
  const copy = PERMISSION_COPY[kind]

  const run = (fn: () => Promise<void>): void => {
    setBusy(true)
    setErr(null)
    fn()
      .then(() => {
        setAdding('')
        props.onChanged()
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="eui-perm">
      <div className="eui-perm-head">
        <span className="t">{copy.title}</span>
        <Chip>
          {isList ? (kind === 'access' ? `Allow list (${entry.wallets.length})` : entry.wallets.length === 0 ? 'Only the owner' : `Allow list (${entry.wallets.length})`) : entry.type === 'unrestricted' ? 'Everyone' : entry.type}
        </Chip>
      </div>
      <p className="eui-world-hint">{copy.hint}</p>
      {isList && (
        <>
          {entry.wallets.map((a) => (
            <div key={a} className="eui-perm-row">
              <span className="wa">{a}</span>
              {props.isOwner && (
                <button className="eui-link" disabled={busy} onClick={() => run(() => setWorldPermission(props.world, kind, a, false))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {props.isOwner && (
            <div className="eui-perm-add">
              <input
                className="eui-input"
                placeholder="0x wallet address"
                value={adding}
                spellCheck={false}
                onChange={(e) => {
                  setAdding(e.target.value)
                  setErr(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ADDRESS_RE.test(adding.trim())) {
                    run(() => setWorldPermission(props.world, kind, adding.trim(), true))
                  }
                }}
              />
              <Button
                size="sm"
                disabled={busy || !ADDRESS_RE.test(adding.trim())}
                onClick={() => run(() => setWorldPermission(props.world, kind, adding.trim(), true))}
              >
                {busy ? '…' : 'Add'}
              </Button>
            </div>
          )}
        </>
      )}
      {err !== null && <p className="eui-perm-err">{err}</p>}
    </div>
  )
}
