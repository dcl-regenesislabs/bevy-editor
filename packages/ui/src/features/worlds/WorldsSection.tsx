// The Home "Worlds" tab: live inventory of the wallet's worlds. Worlds are the
// source of truth — fetched from the servers, so scenes deployed with the CLI
// (outside this editor) show up too. Local scenes associate to a world through
// scene.json's worldConfiguration.name (ProjectInfo.world); the link is shown
// on both sides but a missing local scene never hides a world.
import { useEffect, useState } from 'react'
import type { ProjectInfo } from '@dcl-editor/contract'
import { Button } from '../../ds'
import { useAuth } from '../../auth'
import { ensureWorlds, formatAgo, refreshWorlds, useWorlds, type WorldEntry } from '../../worlds'
import { GlobeIcon, linkedScenes, NAME_MARKETPLACE, openExternal, WorldCover } from './common'
import { WorldDetail } from './WorldDetail'

// ---- Worlds tab ----
export function WorldsSection(props: {
  projects: ProjectInfo[]
  initialWorld?: string | null
  onOpenScene: (dir: string) => void
  onPublishScene: (p: ProjectInfo, world: string) => void
}): JSX.Element {
  const auth = useAuth()
  const { worlds, status, error } = useWorlds()
  const [selected, setSelected] = useState<string | null>(props.initialWorld ?? null)
  // ensureWorlds resets on sign-out/account-switch and fetches when stale
  useEffect(ensureWorlds, [auth.wallet])

  if (auth.wallet === null) {
    return (
      <>
        <WorldsHead />
        <div className="eui-account-card">
          <div className="eui-signin">
            <div className="eui-account-empty-icon"><GlobeIcon size={22} /></div>
            <p className="t">Sign in to see your worlds</p>
            <p className="s">Your Decentraland NAMEs are worlds you can publish scenes to.</p>
            <Button variant="primary" size="md" onClick={auth.signIn}>Sign in with Decentraland</Button>
          </div>
        </div>
      </>
    )
  }

  const detail = selected !== null ? worlds.find((w) => w.name === selected) : undefined
  if (detail !== undefined) {
    return (
      <WorldDetail
        w={detail}
        projects={props.projects}
        wallet={auth.wallet}
        onBack={() => setSelected(null)}
        onOpenScene={props.onOpenScene}
        onPublishScene={props.onPublishScene}
      />
    )
  }

  return (
    <>
      <WorldsHead onRefresh={status === 'loading' ? undefined : refreshWorlds} />
      {status === 'loading' && worlds.length === 0 && (
        <div className="eui-world-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="eui-world-card skeleton" />
          ))}
        </div>
      )}
      {status === 'error' && (
        <div className="eui-home-first">
          <p className="t">Couldn't load your worlds</p>
          <p className="s">{error}</p>
          <Button variant="primary" size="md" onClick={refreshWorlds}>Try again</Button>
        </div>
      )}
      {status === 'ready' && worlds.length === 0 && (
        <div className="eui-home-first">
          <GlobeIcon size={22} />
          <p className="t">No worlds yet</p>
          <p className="s">
            A Decentraland NAME gives you a world of your own — a place with its own URL where you can publish any scene.
          </p>
          <div className="eui-home-cta">
            <Button variant="primary" size="md" onClick={() => openExternal(NAME_MARKETPLACE)}>Get a NAME</Button>
            <Button variant="ghost" size="md" onClick={refreshWorlds}>Refresh</Button>
          </div>
        </div>
      )}
      {worlds.length > 0 && (
        <div className="eui-world-grid">
          {worlds.map((w) => (
            <WorldCard key={w.name} w={w} projects={props.projects} onOpen={() => setSelected(w.name)} />
          ))}
        </div>
      )}
    </>
  )
}

function WorldsHead(props: { onRefresh?: () => void }): JSX.Element {
  return (
    <header className="eui-home-head">
      <div>
        <h1>Your worlds</h1>
        <p>What's live on your Decentraland NAMEs — published from here, the CLI, or anywhere else.</p>
      </div>
      {props.onRefresh !== undefined && (
        <div className="eui-home-cta">
          <Button variant="ghost" size="md" onClick={props.onRefresh}>Refresh</Button>
        </div>
      )}
    </header>
  )
}

function WorldCard(props: { w: WorldEntry; projects: ProjectInfo[]; onOpen: () => void }): JSX.Element {
  const { w } = props
  const linked = linkedScenes(props.projects, w.name)
  const live = w.deployment !== null
  return (
    <div className="eui-world-card" role="button" tabIndex={0} onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          props.onOpen()
        }
      }}
    >
      <WorldCover w={w} local={linked[0]?.thumbnail} />
      <div className="eui-world-meta">
        <span className="nm">{w.name}</span>
        <span className={`eui-world-status ${live ? 'live' : ''}`}>
          {live ? (
            <>
              <span className="dot" />
              {w.deployment!.title} · {formatAgo(w.deployment!.timestamp)}
            </>
          ) : (
            'Nothing published yet'
          )}
        </span>
        {linked.length > 0 && (
          <span className="eui-world-linked" data-tip={linked.map((p) => p.title).join(', ')}>
            ⛶ {linked.length === 1 ? linked[0].title : `${linked.length} local scenes`}
          </span>
        )}
      </div>
      <div className="eui-world-tags">
        {w.role === 'collaborator' && <span className="eui-world-chip">Collaborator</span>}
        {w.userCount !== null && w.userCount > 0 && <span className="eui-world-chip live">{w.userCount} online</span>}
      </div>
    </div>
  )
}
