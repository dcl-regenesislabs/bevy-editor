// Full-page tabbed world detail: Overview | Analytics | Settings | Permissions |
// Streaming | Moderation | Storage | Logs — each tab owns the whole content area.
import { useState } from 'react'
import type { ProjectInfo } from '@dcl-editor/contract'
import { Button, ContextMenu, MenuItem, Modal, Segmented, Spinner } from '../../ds'
import { IconTrash } from '../../icons'
import { formatAgo, formatBytes, plural, sceneTitle } from '../../lib/format'
import { jumpInUrl } from './endpoints'
import { sceneScopeOf } from './gatekeeper'
import { sceneCoordinate, type WorldEntry, type WorldScene } from './inventory'
import { undeployScene } from './undeploy'
import { refreshWorlds } from './worlds-store'
import { linkedScenes, openExternal, shortAddr, WorldCover } from './common'
import { AccessPanel } from './AccessPanel'
import { StreamingPanel } from './StreamingPanel'
import { ModerationPanel } from './ModerationPanel'
import { StorageTab } from './StorageTab'
import { LogsTab } from './LogsTab'
import { SettingsTab } from './SettingsTab'
import { AnalyticsTab } from './AnalyticsTab'

function worldHeadline(w: WorldEntry): string {
  if (!w.sceneCount.known) return "Couldn't read this world."
  const d = w.deployment
  return d !== null ? `Live — “${d.title}”, updated ${formatAgo(d.timestamp)}.` : 'Nothing published here yet.'
}

// ---- world detail (overview + access management) ----
export function WorldDetail(props: {
  w: WorldEntry
  projects: ProjectInfo[]
  wallet: string
  onBack: () => void
  onOpenScene: (dir: string) => void
  onPublishScene: (p: ProjectInfo, world: string) => void
}): JSX.Element {
  const { w } = props
  const d = w.deployment
  const scope = d !== null ? sceneScopeOf(w.name, d) : null
  const [tab, setTab] = useState<
    'overview' | 'analytics' | 'settings' | 'access' | 'streaming' | 'moderation' | 'storage' | 'logs'
  >('overview')
  const title = w.settings?.title ?? null
  return (
    <>
      <header className="eui-home-head eui-world-dhead">
        <div>
          <button className="eui-back eui-world-back" onClick={props.onBack}>← All worlds</button>
          <h1>{title ?? w.name}</h1>
          {title !== null && <p className="eui-world-id">{w.name}</p>}
          <p>{worldHeadline(w)}</p>
        </div>
        <div className="eui-home-cta">
          {d !== null && (
            <Button variant="primary" size="md" onClick={() => openExternal(jumpInUrl(w.name))}>Jump in</Button>
          )}
        </div>
      </header>

      <div className="eui-world-tabs">
        <Segmented
          value={tab}
          onChange={setTab}
          aria-label="World sections"
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'analytics', label: 'Analytics' },
            { value: 'settings', label: 'Settings' },
            { value: 'access', label: 'Permissions' },
            { value: 'streaming', label: 'Streaming' },
            { value: 'moderation', label: 'Moderation' },
            { value: 'storage', label: 'Storage' },
            { value: 'logs', label: 'Logs' }
          ]}
        />
      </div>

      <div className="eui-world-detail">
        {tab === 'overview' && (
          <OverviewTab
            w={w}
            projects={props.projects}
            wallet={props.wallet}
            onOpenScene={props.onOpenScene}
            onPublishScene={props.onPublishScene}
          />
        )}
        {tab === 'analytics' && <AnalyticsTab w={w} />}
        {tab === 'settings' && <SettingsTab world={w.name} />}
        {tab === 'access' && <AccessPanel world={w.name} wallet={props.wallet} />}
        {tab === 'streaming' && <StreamingPanel scope={scope} />}
        {tab === 'moderation' && <ModerationPanel scope={scope} />}
        {tab === 'storage' && <StorageTab realm={w.name} d={d} />}
        {tab === 'logs' && <LogsTab realm={w.name} d={d} />}
      </div>
    </>
  )
}

// Overview tab: the world's face — cover, live facts, and the local scenes
// that publish here.
function OverviewTab(props: {
  w: WorldEntry
  projects: ProjectInfo[]
  wallet: string
  onOpenScene: (dir: string) => void
  onPublishScene: (p: ProjectInfo, world: string) => void
}): JSX.Element {
  const { w } = props
  const d = w.deployment
  const linked = linkedScenes(props.projects, w.name)
  return (
    <>
      <div className="eui-world-hero">
        <WorldCover w={w} local={linked[0]?.thumbnail} />
        {w.settings?.description !== undefined && w.settings?.description !== null && (
          <p className="eui-world-desc">{w.settings.description}</p>
        )}
        <div className="eui-world-facts">
          {(
            [
              ['Last published', d !== null ? formatAgo(d.timestamp) : '—'],
              ['Published by', d?.deployer !== null && d !== null ? shortAddr(d.deployer!) : '—'],
              ['Size', formatBytes(d?.size ?? w.size)],
              ['Parcels', d !== null ? String(d.parcels) : '—'],
              ['Your role', w.role === 'owner' ? 'Owner' : 'Collaborator']
            ] as Array<[string, string]>
          ).map(([k, v]) => (
            <div key={k} className="eui-world-fact">
              <span className="k">{k}</span>
              <span className="v">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <PublishedScenes w={w} wallet={props.wallet} />

      <section className="eui-world-block">
        <h2>Linked scenes</h2>
        <p className="eui-world-hint">
          {linked.length > 0
            ? 'These scenes live in your Scenes tab and publish to this world.'
            : 'None of the scenes in your Scenes tab is linked to this world yet.'}
        </p>
        {linked.length === 0 ? (
          <p className="eui-world-hint">
            Publish any scene here and it will link automatically
            {d !== null ? ' — the current content was published from somewhere else (CLI or another computer), and stays live either way.' : '.'}
          </p>
        ) : (
          <div className="eui-world-scenes">
            {linked.map((p) => (
              <div key={p.path} className="eui-world-scene">
                {p.thumbnail !== null ? <img src={p.thumbnail} alt="" /> : <span className="ph">⛶</span>}
                <div className="meta">
                  <span className="nm">{p.title}</span>
                  <span className="pt">{p.path}</span>
                </div>
                <span style={{ flex: 1 }} />
                <Button variant="ghost" size="sm" onClick={() => props.onOpenScene(p.path)}>Open</Button>
                <Button size="sm" variant="primary" onClick={() => props.onPublishScene(p, w.name)}>Publish update</Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

interface SceneMenu {
  x: number
  y: number
  scene: WorldScene
}

function parcelCount(s: WorldScene): number {
  return s.parcels.length > 0 ? s.parcels.length : 1
}

function sceneWhere(s: WorldScene): string {
  const at = `${s.x},${s.y} · ${plural(parcelCount(s), 'parcel')}`
  return s.timestamp === null ? at : `${at} · published ${formatAgo(s.timestamp)}`
}

function sceneKeyOf(s: WorldScene): string {
  return s.entityId ?? `${s.x},${s.y}`
}

function scenesHint(w: WorldEntry): string {
  if (w.scenes.length > 0) return 'Right-click a scene to remove it from this world.'
  return w.sceneCount.known ? 'Nothing is published here yet.' : "Couldn't read this world."
}

function PublishedScenes(props: { w: WorldEntry; wallet: string }): JSX.Element {
  const { w } = props
  const [menu, setMenu] = useState<SceneMenu | null>(null)
  const [confirm, setConfirm] = useState<WorldScene | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ key: string; message: string; why: string } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const total = w.sceneCount.known ? w.sceneCount.total : w.scenes.length

  const remove = (s: WorldScene): void => {
    const key = sceneKeyOf(s)
    setConfirm(null)
    setFailed(null)
    setNote(null)
    setBusy(key)
    void undeployScene(w.name, sceneCoordinate(s)).then((r) => {
      setBusy(null)
      if (r.ok) {
        setNote(`Removed “${sceneTitle(s.title)}”.`)
        refreshWorlds()
        return
      }
      if (r.reason === 'gone') {
        setNote(r.message)
        refreshWorlds()
        return
      }
      setFailed({ key, message: `Couldn't remove “${sceneTitle(s.title)}” — nothing else changed.`, why: r.message })
    })
  }

  return (
    <section className="eui-world-block">
      <h2>Scenes published here</h2>
      <p className="eui-world-hint">{scenesHint(w)}</p>
      {w.scenes.length > 0 && !w.sceneCount.known && (
        <p className="eui-world-hint">Part of {w.name} couldn't be read, so this list may be missing scenes.</p>
      )}
      {note !== null && <p className="eui-world-ok">{note}</p>}
      {w.scenes.length > 0 && (
        <div className="eui-world-scenes">
          {w.scenes.map((s) => {
            const key = sceneKeyOf(s)
            return (
              <div key={key} className="eui-world-srow">
                <div
                  className="eui-world-scene"
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, scene: s })
                  }}
                >
                  {s.thumbnail !== null ? (
                    <img src={s.thumbnail} alt="" crossOrigin="anonymous" loading="lazy" />
                  ) : (
                    <span className="ph">⛶</span>
                  )}
                  <div className="meta">
                    <span className="nm">{sceneTitle(s.title)}</span>
                    <span className="pt">{sceneWhere(s)}</span>
                  </div>
                  <span style={{ flex: 1 }} />
                  {busy === key && <Spinner size={14} />}
                </div>
                {failed !== null && failed.key === key && (
                  <p className="eui-world-srow-err">
                    {failed.message}
                    <span>{failed.why}</span>
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
      {menu !== null && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem
            danger
            icon={<IconTrash />}
            disabled={busy !== null}
            tip={busy === null ? undefined : 'Another scene is being removed'}
            onClick={() => {
              setConfirm(menu.scene)
              setMenu(null)
            }}
          >
            Remove from world…
          </MenuItem>
        </ContextMenu>
      )}
      {confirm !== null && (
        <RemoveSceneModal
          world={w.name}
          wallet={props.wallet}
          scene={confirm}
          others={total - 1}
          onCancel={() => setConfirm(null)}
          onConfirm={() => remove(confirm)}
        />
      )}
    </section>
  )
}

function RemoveSceneModal(props: {
  world: string
  wallet: string
  scene: WorldScene
  others: number
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  const { scene } = props
  const deployer = scene.deployer
  const someoneElse = deployer !== null && deployer !== props.wallet.toLowerCase()
  return (
    <Modal
      title={`Remove “${sceneTitle(scene.title)}” from ${props.world}?`}
      onClose={props.onCancel}
      footer={
        <>
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button variant="danger" onClick={props.onConfirm}>Remove</Button>
        </>
      }
    >
      <p className="eui-world-hint">
        It sits on {plural(parcelCount(scene), 'parcel')} starting at {scene.x},{scene.y}. Visitors who walk there will
        find empty ground. To bring it back you'd publish it again from its own project folder.
      </p>
      {someoneElse && <p className="eui-world-hint">Published by {shortAddr(deployer)} — not you.</p>}
      {props.others > 0 && (
        <p className="eui-world-hint">
          {props.others === 1
            ? 'The other scene in this world stays live.'
            : `The other ${props.others} scenes in this world stay live.`}
        </p>
      )}
    </Modal>
  )
}
