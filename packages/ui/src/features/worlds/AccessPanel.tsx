// World permissions: the deployment/access/streaming allow-lists.
import { useEffect, useState } from 'react'
import { Button, Chip, ConfirmButton, Spinner } from '../../ds'
import { fetchWorldPermissions, narrowedScope, setWorldPermission, type GrantScope, type WorldPermissionKind, type WorldPermissions } from './inventory'
import { plural } from '../../lib/format'
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
        <PermissionList key={kind} kind={kind} world={props.world} entry={perms[kind]} scopes={perms.scopes} isOwner={isOwner} onChanged={load} />
      ))}
      {!isOwner && <p className="eui-world-hint">Only the world owner can change permissions.</p>}
    </section>
  )
}

function PermissionList(props: {
  kind: WorldPermissionKind
  world: string
  entry: { type: string; wallets: string[] }
  scopes: Map<string, GrantScope>
  isOwner: boolean
  onChanged: () => void
}): JSX.Element {
  const { entry, kind } = props
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isList = entry.type === 'allow-list'
  const copy = PERMISSION_COPY[kind]
  const typed = adding.trim()
  const widensExisting = narrowedScope(props.scopes.get(typed.toLowerCase())) !== null
  const hasNarrowed = entry.wallets.some((w) => narrowedScope(props.scopes.get(w)) !== null)

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

  const canAdd = !busy && ADDRESS_RE.test(typed) && !widensExisting
  const add = (): void => run(() => setWorldPermission(props.world, kind, typed, true))

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
          {entry.wallets.map((a) => {
            const narrowed = narrowedScope(props.scopes.get(a))
            const remove = (): void => run(() => setWorldPermission(props.world, kind, a, false))
            return (
              <div key={a} className="eui-perm-row">
                <span className="wa">{a}</span>
                {narrowed !== null && (
                  <Chip>{narrowed.parcelCount !== null ? plural(narrowed.parcelCount, 'parcel') : 'Some parcels'}</Chip>
                )}
                {props.isOwner && narrowed === null && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={remove}>
                    Remove
                  </Button>
                )}
                {props.isOwner && narrowed !== null && (
                  <ConfirmButton label="Remove" confirm="Remove — can't be re-granted here" disabled={busy} onConfirm={remove} />
                )}
              </div>
            )
          })}
          {hasNarrowed && (
            <p className="eui-world-hint">
              A wallet limited to some parcels can only be granted that way outside Decentraland Studio. Adding it back
              here would let it {kind === 'streaming' ? 'stream in' : 'publish anywhere in'} this world, on every scene.
            </p>
          )}
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
                  if (e.key === 'Enter' && canAdd) add()
                }}
              />
              <Button variant="ghost" size="sm" disabled={!canAdd} onClick={add}>
                {busy ? '…' : 'Add'}
              </Button>
            </div>
          )}
        </>
      )}
      {widensExisting && (
        <p className="eui-perm-err">
          {typed.toLowerCase()} is already limited to some parcels here. Adding it would widen that to the whole
          world — change it outside Decentraland Studio instead.
        </p>
      )}
      {err !== null && <p className="eui-perm-err">{err}</p>}
    </div>
  )
}
