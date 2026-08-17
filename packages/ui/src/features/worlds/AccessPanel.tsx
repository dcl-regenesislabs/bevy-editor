// World permissions: the deployment/access/streaming gates.
import { useEffect, useState } from 'react'
import { Button, Chip, ConfirmButton, Modal, ParcelMap, Spinner, TextInput, type ParcelRegion } from '../../ds'
import {
  fetchWorldPermissions,
  narrowedScope,
  PERMISSION_KINDS,
  scopeKey,
  setWorldPermission,
  type GrantScope,
  type WorldPermission,
  type WorldPermissionKind,
  type WorldPermissions,
  type WorldScene
} from './inventory'
import { plural } from '../../lib/format'
import { ADDRESS_RE, shortAddr } from './common'
import { orderScenesByCoordinate } from './scene-label'

const PERMISSION_COPY: Record<WorldPermissionKind, { title: string; hint: string; act: string; verb: string }> = {
  deployment: {
    title: 'Who can publish',
    hint: 'Wallets allowed to publish scenes to this world (the owner always can).',
    act: 'publish scenes to this world',
    verb: 'publish'
  },
  access: {
    title: 'Who can visit',
    hint: 'Who can enter the world.',
    act: 'enter this world',
    verb: 'enter'
  },
  streaming: {
    title: 'Who can stream',
    hint: 'Wallets allowed to stream video/audio inside the world.',
    act: 'stream inside this world',
    verb: 'stream'
  }
}

function gateChip(kind: WorldPermissionKind, entry: WorldPermission): string {
  switch (entry.type) {
    case 'allow-list':
      return kind !== 'access' && entry.wallets.length === 0 ? 'Only the owner' : `Allow list (${entry.wallets.length})`
    case 'unrestricted':
      return 'Everyone'
    case 'shared-secret':
      return 'Password'
    case 'nft-ownership':
      return 'NFT holders'
    default:
      return entry.raw
  }
}

function gateLine(kind: WorldPermissionKind, entry: WorldPermission): string {
  const act = PERMISSION_COPY[kind].act
  switch (entry.type) {
    case 'unrestricted':
      return `Anyone can ${act}.`
    case 'shared-secret':
      return `Only people who know the password can ${act}. The password is set outside Decentraland Studio.`
    case 'nft-ownership':
      return `Only wallets holding a particular NFT can ${act}. That rule is set outside Decentraland Studio.`
    default:
      return `This world uses a rule Decentraland Studio doesn't recognise (“${entry.raw}”), so it can't be changed here.`
  }
}

export function AccessPanel(props: { world: string; wallet: string; scenes?: WorldScene[] }): JSX.Element {
  const [perms, setPerms] = useState<WorldPermissions | null | 'loading'>('loading')
  const load = (): void => {
    void fetchWorldPermissions(props.world).then(setPerms)
  }
  useEffect(load, [props.world])

  if (perms === 'loading') {
    return (
      <section className="eui-world-block">
        <h2>Permissions</h2>
        <div className="eui-world-hint">
          <Spinner size="sm" /> Loading…
        </div>
      </section>
    )
  }
  if (perms === null) {
    return (
      <section className="eui-world-block">
        <h2>Permissions</h2>
        <p className="eui-world-hint">
          Couldn't load this world's permissions.{' '}
          <button className="eui-link" onClick={load}>
            Retry
          </button>
        </p>
      </section>
    )
  }
  const isOwner = perms.owner === props.wallet.toLowerCase()
  return (
    <section className="eui-world-block">
      <h2>Permissions</h2>
      {PERMISSION_KINDS.map((kind) => (
        <PermissionList
          key={kind}
          kind={kind}
          world={props.world}
          entry={perms[kind]}
          scopes={perms.scopes}
          scenes={props.scenes ?? []}
          isOwner={isOwner}
          onChanged={load}
        />
      ))}
      {!isOwner && <p className="eui-world-hint">Only the world owner can change permissions.</p>}
    </section>
  )
}

function PermissionList(props: {
  kind: WorldPermissionKind
  world: string
  entry: WorldPermission
  scopes: Map<string, GrantScope>
  scenes: WorldScene[]
  isOwner: boolean
  onChanged: () => void
}): JSX.Element {
  const { entry, kind } = props
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [scoped, setScoped] = useState<string | null>(null)
  const isList = entry.type === 'allow-list'
  const copy = PERMISSION_COPY[kind]
  const typed = adding.trim()
  const scopeOf = (address: string): GrantScope | null => narrowedScope(props.scopes.get(scopeKey(kind, address)))
  const widensExisting = scopeOf(typed) !== null
  const hasNarrowed = entry.wallets.some((w) => scopeOf(w) !== null)
  const scopedGrant = scoped === null ? null : scopeOf(scoped)

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
        <Chip>{gateChip(kind, entry)}</Chip>
      </div>
      <p className="eui-world-hint">{isList ? copy.hint : gateLine(kind, entry)}</p>
      {isList && (
        <>
          {entry.wallets.map((a) => {
            const narrowed = scopeOf(a)
            const remove = (): void => run(() => setWorldPermission(props.world, kind, a, false))
            return (
              <div key={a} className="eui-perm-row">
                <span className="wa">{a}</span>
                {narrowed !== null && <ScopeChip scope={narrowed} onOpen={() => setScoped(a)} />}
                {props.isOwner && narrowed === null && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={remove}>
                    Remove
                  </Button>
                )}
                {props.isOwner && narrowed !== null && (
                  <ConfirmButton
                    label="Remove"
                    confirm="Remove — can't be re-granted here"
                    disabled={busy}
                    onConfirm={remove}
                  />
                )}
              </div>
            )
          })}
          {hasNarrowed && (
            <p className="eui-world-hint">
              A wallet limited to some parcels can only be granted that way outside Decentraland Studio. Adding it back
              here would let it {copy.verb} anywhere in this world, on every scene.
            </p>
          )}
          {entry.communities.length > 0 && (
            <>
              <p className="eui-world-hint">
                Members of {plural(entry.communities.length, 'community', 'communities')} can also {copy.act}.
                Communities are added to this list outside Decentraland Studio.
              </p>
              {entry.communities.map((c) => (
                <div key={c} className="eui-perm-row">
                  <span className="wa">{c}</span>
                </div>
              ))}
            </>
          )}
          {props.isOwner && (
            <div className="eui-perm-add">
              <TextInput
                className="fld"
                placeholder="0x wallet address"
                value={adding}
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
          {typed.toLowerCase()} is already limited to some parcels here. Adding it would widen that to the whole world —
          change it outside Decentraland Studio instead.
        </p>
      )}
      {err !== null && <p className="eui-perm-err">{err}</p>}
      {scoped !== null && scopedGrant !== null && (
        <ScopeModal
          world={props.world}
          address={scoped}
          kind={kind}
          scope={scopedGrant}
          scenes={props.scenes}
          onClose={() => setScoped(null)}
        />
      )}
    </div>
  )
}

function scopeLabel(scope: GrantScope): string {
  return scope.parcelCount !== null ? plural(scope.parcelCount, 'parcel') : 'Some parcels'
}

function ScopeChip(props: { scope: GrantScope; onOpen: () => void }): JSX.Element {
  if (props.scope.parcels.length === 0) return <Chip>{scopeLabel(props.scope)}</Chip>
  return (
    <button className="eui-link" onClick={props.onOpen}>
      <Chip tip="See which parcels this grant covers">{scopeLabel(props.scope)}</Chip>
    </button>
  )
}

function ScopeModal(props: {
  world: string
  address: string
  kind: WorldPermissionKind
  scope: GrantScope
  scenes: WorldScene[]
  onClose: () => void
}): JSX.Element {
  const copy = PERMISSION_COPY[props.kind]
  const ordered = orderScenesByCoordinate(props.scenes)
  const regions: ParcelRegion[] = [
    ...ordered.map((s) => ({
      key: `scene:${s.x},${s.y}`,
      parcels: s.parcels,
      base: `${s.x},${s.y}`,
      label: props.world,
      tone: 'staying' as const
    })),
    {
      key: 'granted',
      parcels: props.scope.parcels,
      label: `Granted to ${shortAddr(props.address)}`,
      tone: 'mine' as const
    }
  ]
  return (
    <Modal
      title={`Where ${shortAddr(props.address)} can ${copy.verb}`}
      onClose={props.onClose}
      closeX
      closeTip="Close"
      footer={
        <Button variant="ghost" size="sm" onClick={props.onClose}>
          Close
        </Button>
      }
    >
      <p className="eui-world-hint">
        {shortAddr(props.address)} can {copy.verb} on the {plural(props.scope.parcels.length, 'lit parcel')} and nowhere
        else in {props.world}. This is set outside Decentraland Studio and can only be read here.
      </p>
      <ParcelMap regions={regions} cell={14} />
      {ordered.length > 0 && (
        <p className="eui-world-hint">The grey parcels are the ground {props.world}'s scenes stand on.</p>
      )}
    </Modal>
  )
}
