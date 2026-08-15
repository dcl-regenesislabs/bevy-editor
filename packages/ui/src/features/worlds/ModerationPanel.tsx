import { useState } from 'react'
import { Button, Chip, Modal, PanelState, Segmented, useLoad } from '../../ds'
import {
  addSceneAdmin,
  isSceneNotIndexed,
  listSceneAdmins,
  listSceneBans,
  removeSceneAdmin,
  sceneScopeOf,
  setSceneBan,
  type SceneAdmin,
  type SceneScope
} from './gatekeeper'
import type { WorldEntry, WorldScene } from './inventory'
import { sceneLabelProse, sceneTotalOf } from './scene-label'
import { SceneSections } from './SceneSections'
import { ADDRESS_RE, shortAddr } from './common'

const NOT_INDEXED = "This scene isn't indexed yet — try again in a few minutes."

export type ModerationView = 'admins' | 'bans'

function actionError(e: unknown): string {
  if (isSceneNotIndexed(e)) return NOT_INDEXED
  return e instanceof Error ? e.message : String(e)
}

function readable<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    throw new Error(actionError(e))
  })
}

export function ModerationPanel(props: { w: WorldEntry }): JSX.Element {
  const { w } = props
  const [view, setView] = useState<ModerationView>('admins')
  return (
    <>
      <section className="eui-world-block">
        <div className="eui-world-subtabs">
          <h2>Moderation</h2>
          <Segmented
            value={view}
            onChange={setView}
            aria-label="Moderation lists"
            options={[
              { value: 'admins', label: 'Admins' },
              { value: 'bans', label: 'Bans' }
            ]}
          />
        </div>
        <p className="eui-world-hint">
          Admins and bans are kept per scene. A world holding several scenes holds several lists.
        </p>
        <p className="eui-world-hint">Who can enter the world at all is set under Permissions → Who can visit.</p>
      </section>
      <SceneSections
        w={w}
        publishFirst={`Moderation is set per scene. Publish a scene to ${w.name} first.`}
        render={(scene) => (
          <SceneModeration world={w} scene={scene} scope={sceneScopeOf(w.name, scene)} view={view} />
        )}
      />
    </>
  )
}

export function SceneModeration(props: {
  world: WorldEntry
  scene: WorldScene
  scope: SceneScope | null
  view: ModerationView
}): JSX.Element {
  const { scene, scope } = props
  const total = sceneTotalOf(props.world)
  const prose = sceneLabelProse(scene, total)
  const others = total > 1
  if (scope === null) {
    return (
      <p className="eui-world-hint">
        Admins and bans are kept per scene, and {prose} hasn't finished publishing — try again in a few minutes.
      </p>
    )
  }
  return (
    <div className="eui-wsec-body">
      {props.view === 'admins' ? (
        <AdminsList scope={scope} prose={prose} others={others} />
      ) : (
        <BansList scope={scope} prose={prose} others={others} />
      )}
    </div>
  )
}

function useAction(reload: () => void): { busy: boolean; err: string | null; run: (fn: Promise<void>) => void } {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = (fn: Promise<void>): void => {
    setBusy(true)
    setErr(null)
    fn.then(reload)
      .catch((e: unknown) => setErr(actionError(e)))
      .finally(() => setBusy(false))
  }
  return { busy, err, run }
}

const who = (name: string, address: string): string => (name !== '' ? name : shortAddr(address))

function AddByAddressOrName(props: { placeholder: string; busy: boolean; onAdd: (v: string) => void }): JSX.Element {
  const [v, setV] = useState('')
  const submit = (): void => {
    const t = v.trim()
    if (t === '') return
    props.onAdd(t)
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
      <Button variant="ghost" size="sm" disabled={props.busy || v.trim() === ''} onClick={submit}>
        {props.busy ? '…' : 'Add'}
      </Button>
    </div>
  )
}

function AdminsList(props: { scope: SceneScope; prose: string; others: boolean }): JSX.Element {
  const { data, err, reload } = useLoad(() => readable(listSceneAdmins(props.scope)), [props.scope.sceneId])
  const act = useAction(reload)
  const [confirm, setConfirm] = useState<SceneAdmin | null>(null)
  const [typed, setTyped] = useState(0)
  return (
    <>
      <p className="eui-world-hint">Admins can moderate this scene in-game: kick and ban visitors, manage its streams.</p>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data?.map((a) => (
        <div key={a.admin} className="eui-perm-row">
          <span className="nm">{who(a.name, a.admin)}</span>
          <span className="wa">{a.admin}</span>
          <span style={{ flex: 1 }} />
          {a.canBeRemoved ? (
            <Button variant="ghost" size="sm" disabled={act.busy} onClick={() => setConfirm(a)}>
              Remove
            </Button>
          ) : (
            <Chip>Owner</Chip>
          )}
        </div>
      ))}
      {data !== undefined && data.length === 0 && <p className="eui-world-hint">No extra admins for this scene.</p>}
      <AddByAddressOrName
        key={typed}
        placeholder="0x address or DCL name"
        busy={act.busy}
        onAdd={(v) => {
          setTyped((n) => n + 1)
          act.run(addSceneAdmin(props.scope, ADDRESS_RE.test(v) ? { admin: v } : { name: v }))
        }}
      />
      {act.err !== null && <p className="eui-perm-err">{act.err}</p>}
      {confirm !== null && (
        <Modal
          title={`Remove ${who(confirm.name, confirm.admin)} as an admin of ${props.prose}?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  act.run(removeSceneAdmin(props.scope, confirm.admin))
                  setConfirm(null)
                }}
              >
                Remove
              </Button>
            </>
          }
        >
          <p className="eui-world-hint">
            They stop being able to kick and ban visitors in this scene, or manage its streams.
          </p>
          {props.others && <p className="eui-world-hint">Admins on the other scenes in this world are unaffected.</p>}
        </Modal>
      )}
    </>
  )
}

interface BanTarget {
  target: { address?: string; name?: string }
  who: string
}

function BansList(props: { scope: SceneScope; prose: string; others: boolean }): JSX.Element {
  const { data, err, reload } = useLoad(() => readable(listSceneBans(props.scope)), [props.scope.sceneId])
  const act = useAction(reload)
  const [confirm, setConfirm] = useState<BanTarget | null>(null)
  const [typed, setTyped] = useState(0)
  return (
    <>
      <p className="eui-world-hint">People banned from this scene. Other scenes in this world keep their own list.</p>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data?.bans.map((b) => (
        <div key={b.bannedAddress !== '' ? b.bannedAddress : b.name} className="eui-perm-row">
          <span className="nm">{who(b.name, b.bannedAddress)}</span>
          <span className="wa">{b.bannedAddress}</span>
          <span style={{ flex: 1 }} />
          <Button
            variant="ghost"
            size="sm"
            disabled={act.busy}
            onClick={() =>
              act.run(
                setSceneBan(props.scope, b.bannedAddress !== '' ? { address: b.bannedAddress } : { name: b.name }, false)
              )
            }
          >
            Unban
          </Button>
        </div>
      ))}
      {data !== undefined && data.bans.length === 0 && <p className="eui-world-hint">Nobody is banned from this scene.</p>}
      {data !== undefined && data.total > data.bans.length && (
        <p className="eui-world-hint">Showing the first {data.bans.length} of {data.total}.</p>
      )}
      <AddByAddressOrName
        key={typed}
        placeholder="0x address or DCL name to ban"
        busy={act.busy}
        onAdd={(v) =>
          setConfirm(ADDRESS_RE.test(v) ? { target: { address: v }, who: shortAddr(v) } : { target: { name: v }, who: v })
        }
      />
      {act.err !== null && <p className="eui-perm-err">{act.err}</p>}
      {confirm !== null && (
        <Modal
          title={`Ban ${confirm.who} from ${props.prose}?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  act.run(setSceneBan(props.scope, confirm.target, true))
                  setConfirm(null)
                  setTyped((n) => n + 1)
                }}
              >
                Ban
              </Button>
            </>
          }
        >
          <p className="eui-world-hint">They stay banned until you unban them here.</p>
          {props.others && <p className="eui-world-hint">The other scenes in this world are unaffected.</p>}
        </Modal>
      )}
    </>
  )
}
