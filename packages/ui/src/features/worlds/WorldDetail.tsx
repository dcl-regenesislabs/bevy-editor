// Full-page tabbed world detail: Overview | Permissions | Streaming |
// Moderation | Storage — each tab owns the whole content area.
import { useState } from 'react'
import type { ProjectInfo } from '@dcl-editor/contract'
import { Button, Segmented } from '../../ds'
import { formatAgo, formatBytes, jumpInUrl, sceneScopeOf, type WorldEntry } from '../../worlds'
import { linkedScenes, openExternal, shortAddr, WorldCover } from './common'
import { AccessPanel } from './AccessPanel'
import { StreamingPanel } from './StreamingPanel'
import { ModerationPanel } from './ModerationPanel'
import { StorageTab } from './StorageTab'

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
  const [tab, setTab] = useState<'overview' | 'access' | 'streaming' | 'moderation' | 'storage'>('overview')
  return (
    <>
      <header className="eui-home-head eui-world-dhead">
        <div>
          <button className="eui-back eui-world-back" onClick={props.onBack}>← All worlds</button>
          <h1>{w.name}</h1>
          <p>{d !== null ? `Live — “${d.title}”, updated ${formatAgo(d.timestamp)}.` : 'Nothing published here yet.'}</p>
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
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'access', label: 'Permissions' },
            { value: 'streaming', label: 'Streaming' },
            { value: 'moderation', label: 'Moderation' },
            { value: 'storage', label: 'Storage' }
          ]}
        />
      </div>

      <div className="eui-world-detail">
        {tab === 'overview' && (
          <OverviewTab w={w} projects={props.projects} onOpenScene={props.onOpenScene} onPublishScene={props.onPublishScene} />
        )}
        {tab === 'access' && <AccessPanel world={w.name} wallet={props.wallet} />}
        {tab === 'streaming' && <StreamingPanel scope={scope} />}
        {tab === 'moderation' && <ModerationPanel scope={scope} />}
        {tab === 'storage' && <StorageTab realm={w.name} d={d} />}
      </div>
    </>
  )
}

// Overview tab: the world's face — cover, live facts, and the local scenes
// that publish here.
function OverviewTab(props: {
  w: WorldEntry
  projects: ProjectInfo[]
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
