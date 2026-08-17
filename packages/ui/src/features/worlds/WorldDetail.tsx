// Full-page tabbed world detail: "This world" (Overview, Settings, Permissions)
// and "One scene" (Analytics, Streaming, Moderation, Storage, Logs).
import { useState } from 'react'
import type { ProjectInfo } from '@dcl-editor/contract'
import { Button, Chip, ContextMenu, GroupLabel, MenuItem, Modal, ParcelMap, parcelTone, Segmented, Spinner } from '../../ds'
import { IconTrash } from '../../icons'
import { formatAgo, formatBytes, plural, sceneTitle } from '../../lib/format'
import { jumpInUrl } from './endpoints'
import { sceneCoordinate, type WorldEntry, type WorldScene } from './inventory'
import { undeployScene } from './undeploy'
import { refreshWorlds } from './worlds-store'
import { linkedScenes, openExternal, shortAddr, WorldCover } from './common'
import {
  commonDeployer,
  orderScenesByCoordinate,
  sceneKeyOf,
  sceneLabelProse,
  sceneListShort,
  sceneToneOf,
  sceneTotalOf
} from './scene-label'
import { nextWatched } from './scene-panel'
import { AccessPanel } from './AccessPanel'
import { StreamingPanel } from './StreamingPanel'
import { ModerationPanel } from './ModerationPanel'
import { StorageTab } from './StorageTab'
import { LogsTab } from './LogsTab'
import { SettingsTab } from './SettingsTab'
import { AnalyticsTab } from './AnalyticsTab'

type WorldTab = 'overview' | 'settings' | 'access'
type SceneTab = 'analytics' | 'streaming' | 'moderation' | 'storage' | 'logs'
type Tab = WorldTab | SceneTab

const WORLD_TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'settings', label: 'Settings' },
  { value: 'access', label: 'Permissions' }
]

const SCENE_TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'analytics', label: 'Analytics' },
  { value: 'streaming', label: 'Streaming' },
  { value: 'moderation', label: 'Moderation' },
  { value: 'storage', label: 'Storage' },
  { value: 'logs', label: 'Logs' }
]

function lastPublished(scenes: WorldScene[]): number | null {
  const stamps = scenes.map((s) => s.timestamp).filter((t): t is number => t !== null)
  return stamps.length === 0 ? null : Math.max(...stamps)
}

function parcelTotal(scenes: WorldScene[]): number {
  return new Set(scenes.flatMap((s) => (s.parcels.length > 0 ? s.parcels : [`${s.x},${s.y}`]))).size
}

function worldHeadline(w: WorldEntry): string {
  if (!w.sceneCount.known) return "Couldn't read this world."
  const total = sceneTotalOf(w)
  if (total === 0) return 'Nothing published here yet.'
  const ago = formatAgo(lastPublished(w.scenes))
  if (total === 1 && w.scenes.length === 1) {
    const name = sceneTitle(w.scenes[0].title)
    return ago === '' ? `Live — “${name}”.` : `Live — “${name}”, updated ${ago}.`
  }
  return ago === '' ? `Live — ${plural(total, 'scene')}.` : `Live — ${plural(total, 'scene')}, last updated ${ago}.`
}

// ---- world detail (overview + the seven managed surfaces) ----
export function WorldDetail(props: {
  w: WorldEntry
  projects: ProjectInfo[]
  wallet: string
  onBack: () => void
  onOpenScene: (dir: string) => void
  onPublishScene: (p: ProjectInfo, world: string) => void
}): JSX.Element {
  const { w } = props
  const [tab, setTab] = useState<Tab>('overview')
  const [picked, setPicked] = useState<string[]>([])
  const [watching, setWatching] = useState<string[] | null>(null)
  const pickOne = (key: string): void => setPicked([key])
  const toggleWatch = (key: string): void => setWatching((prev) => nextWatched(prev, picked, key))
  const title = w.settings?.title ?? null
  return (
    <>
      <header className="eui-home-head">
        <div>
          <button className="eui-back eui-world-back" onClick={props.onBack}>← All worlds</button>
          <h1>{title ?? w.name}</h1>
          {title !== null && <p className="eui-world-id">{w.name}</p>}
          <p>{worldHeadline(w)}</p>
        </div>
        <div className="eui-home-cta">
          {w.scenes.length > 0 && (
            <Button variant="primary" size="md" onClick={() => openExternal(jumpInUrl(w.name))}>Jump in</Button>
          )}
        </div>
      </header>

      <div className="eui-world-tabs">
        <div className="eui-world-tabgroup">
          <GroupLabel>Whole world</GroupLabel>
          <Segmented value={tab} onChange={setTab} aria-label="World-wide sections" options={WORLD_TABS} />
        </div>
        <div className="eui-world-tabgroup">
          <GroupLabel>Per scene</GroupLabel>
          <Segmented value={tab} onChange={setTab} aria-label="Per-scene sections" options={SCENE_TABS} />
        </div>
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
        {tab === 'settings' && (
          <>
            <WholeWorld note={`Settings apply to every scene in ${w.name}.`} />
            <SettingsTab world={w.name} />
          </>
        )}
        {tab === 'access' && (
          <>
            <WholeWorld note={`Permissions apply to every scene in ${w.name}.`} />
            <AccessPanel world={w.name} wallet={props.wallet} scenes={w.scenes} />
          </>
        )}
        {tab === 'analytics' && <AnalyticsTab w={w} picked={picked} onPick={pickOne} />}
        {tab === 'streaming' && <StreamingPanel w={w} picked={picked} onPick={pickOne} />}
        {tab === 'moderation' && <ModerationPanel w={w} picked={picked} onPick={pickOne} />}
        {tab === 'storage' && <StorageTab w={w} picked={picked} onPick={pickOne} />}
        {tab === 'logs' && <LogsTab w={w} watching={watching ?? picked} onWatch={toggleWatch} />}
      </div>
    </>
  )
}

function WholeWorld(props: { note?: string }): JSX.Element {
  return (
    <div className="eui-world-scope">
      <Chip tone="info" size="xs">Whole world</Chip>
      {props.note !== undefined && <span>{props.note}</span>}
    </div>
  )
}

// Overview tab: the world's face — cover, world-wide facts, and the local scenes
// that publish here.
function OverviewTab(props: {
  w: WorldEntry
  projects: ProjectInfo[]
  wallet: string
  onOpenScene: (dir: string) => void
  onPublishScene: (p: ProjectInfo, world: string) => void
}): JSX.Element {
  const { w } = props
  const linked = linkedScenes(props.projects, w.name)
  const deployer = commonDeployer(w.scenes)
  const live = w.scenes.length > 0
  const size = w.size ?? sumSizes(w.scenes)
  const facts: Array<[string, string]> = [
    ['Last published', live ? formatAgo(lastPublished(w.scenes)) : '—'],
    ...(deployer !== null ? ([['Published by', shortAddr(deployer)]] as Array<[string, string]>) : []),
    ['Size', formatBytes(size)],
    ['Scenes', String(sceneTotalOf(w))],
    ['Parcels', live ? String(parcelTotal(w.scenes)) : '—'],
    ['Your role', w.role === 'owner' ? 'Owner' : 'Collaborator']
  ]
  return (
    <>
      <div className="eui-world-hero">
        <WorldCover w={w} local={linked[0]?.thumbnail} />
        {w.settings?.description !== undefined && w.settings?.description !== null && (
          <p className="eui-world-desc">{w.settings.description}</p>
        )}
        <div className="eui-world-facts">
          {facts.map(([k, v]) => (
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
            {live ? ' — the current content was published from somewhere else (CLI or another computer), and stays live either way.' : '.'}
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

function sumSizes(scenes: WorldScene[]): number | null {
  const known = scenes.map((s) => s.size).filter((n): n is number => n !== null)
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0)
}

function parcelCount(s: WorldScene): number {
  return s.parcels.length > 0 ? s.parcels.length : 1
}

function sceneWhere(s: WorldScene): string {
  const at = `${s.x},${s.y} · ${plural(parcelCount(s), 'parcel')}`
  return s.timestamp === null ? at : `${at} · published ${formatAgo(s.timestamp)}`
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
  const [picked, setPicked] = useState<string | null>(null)
  const scenes = orderScenesByCoordinate(w.scenes)
  const total = sceneTotalOf(w)
  const named = (s: WorldScene): string => sceneLabelProse(s, total)
  const regions = scenes.map((s) => ({
    key: sceneKeyOf(w, s),
    parcels: s.parcels,
    base: `${s.x},${s.y}`,
    label: sceneTitle(s.title),
    tone: sceneToneOf(s)
  }))

  const remove = (s: WorldScene): void => {
    const key = sceneKeyOf(w, s)
    setConfirm(null)
    setFailed(null)
    setNote(null)
    setBusy(key)
    void undeployScene(w.name, sceneCoordinate(s)).then((r) => {
      setBusy(null)
      if (r.ok) {
        setNote(`Removed ${named(s)}.`)
        refreshWorlds()
        return
      }
      if (r.reason === 'gone') {
        setNote(r.message)
        refreshWorlds()
        return
      }
      setFailed({ key, message: `Couldn't remove ${named(s)} — nothing else changed.`, why: r.message })
    })
  }

  return (
    <section className="eui-world-block">
      <h2>Scenes published here</h2>
      <p className="eui-world-hint">{scenesHint(w)}</p>
      {w.scenes.length > 0 && sceneListShort(w) && (
        <p className="eui-world-hint">Part of {w.name} couldn't be read, so this list may be missing scenes.</p>
      )}
      {note !== null && <p className="eui-world-ok">{note}</p>}
      {regions.length > 0 && (
        <ParcelMap
          regions={regions}
          cell={14}
          selected={picked}
          onSelect={(key) => setPicked((cur) => (cur === key ? null : key))}
          onContext={(key, e) => {
            const hit = scenes.find((s) => sceneKeyOf(w, s) === key)
            if (hit !== undefined) setMenu({ x: e.clientX, y: e.clientY, scene: hit })
          }}
        />
      )}
      {scenes.length > 0 && (
        <div className="eui-world-scenes">
          {scenes.map((s) => {
            const key = sceneKeyOf(w, s)
            return (
              <div key={key} className="eui-world-srow">
                <div
                  className={`eui-world-scene${picked === key ? ' picked' : ''}`}
                  onClick={() => setPicked((cur) => (cur === key ? null : key))}
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
                  <span className="tone" style={parcelTone(sceneToneOf(s))} />
                  <div className="meta">
                    <span className="nm">{sceneTitle(s.title)}</span>
                    <span className="pt">{sceneWhere(s)}</span>
                  </div>
                  <span style={{ flex: 1 }} />
                  {busy === key && <Spinner size="sm" />}
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
          named={named(confirm)}
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
  named: string
  others: number
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  const { scene } = props
  const deployer = scene.deployer
  const someoneElse = deployer !== null && deployer !== props.wallet.toLowerCase()
  return (
    <Modal
      title={`Remove ${props.named} from ${props.world}?`}
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
