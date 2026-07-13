// Roblox/creator-hub-style home: a left rail (Scenes / Worlds / Settings /
// Account) and a content area. No logs here — those live in the in-scene
// Build/Server drawer.
import { useEffect, useRef, useState } from 'react'
import type { HostState, ProjectInfo } from '@dcl-editor/contract'
import { Button, SearchField, Segmented, Select, Toast } from '../../ds'
import { AccountBadge, AccountSection } from '../account/account'
import { WorldsSection } from '../worlds/WorldsSection'
import { PublishModal } from '../publish/PublishModal'
import { SceneCard, FolderIcon } from './SceneCard'
import dclLogo from '../../assets/dcl-logo.png'
import { NewSceneModal } from './NewSceneModal'

type HomeSection = 'scenes' | 'worlds' | 'account'

type SortKey = 'recent' | 'name' | 'parcels'

const NAV: Array<[HomeSection, string]> = [
  ['scenes', 'Scenes'],
  ['worlds', 'Worlds'],
  ['account', 'Account']
]

const SORTERS: Record<SortKey, (a: ProjectInfo, b: ProjectInfo) => number> = {
  recent: (a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0),
  name: (a, b) => a.title.localeCompare(b.title),
  parcels: (a, b) => b.parcels - a.parcels
}

// Roblox/creator-hub-style home: a left rail (Scenes / Settings / Account) and a
// content area. No logs here — those live in the in-scene Build/Server drawer.
export function Picker(): JSX.Element {
  const shell = window.editorShell
  const [cfg, setCfg] = useState<HostState | null>(null)
  const [section, setSection] = useState<HomeSection>('scenes')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<{ path: string; name: string } | null>(null)
  const [publish, setPublish] = useState<{ dir: string; title: string; world: string | null } | null>(null)
  const [worldsFocus, setWorldsFocus] = useState<string | null>(null) // deep-link into a world's detail
  const removeTimer = useRef<ReturnType<typeof setTimeout>>()
  const refresh = (): void => {
    void shell?.getState().then(setCfg)
  }
  useEffect(() => {
    if (shell === undefined) return
    void shell.getState().then((s) => {
      setCfg(s)
      setView(s.viewMode ?? 'grid')
    })
  }, [])
  if (shell === undefined) {
    return <div className="eui-boot">Editor host — pass ?realm=…&systemScene=… to attach to a running stack</div>
  }

  const setViewMode = (v: 'grid' | 'list'): void => {
    setView(v)
    void shell.setViewMode?.(v)
  }
  // Undo-able remove: hide the card, commit the removal after a grace period.
  const requestRemove = (p: ProjectInfo): void => {
    setPending({ path: p.path, name: p.title })
    clearTimeout(removeTimer.current)
    removeTimer.current = setTimeout(() => {
      void shell.removeFromRecents?.(p.path).then(refresh)
      setPending(null)
    }, 4500)
  }
  const undoRemove = (): void => {
    clearTimeout(removeTimer.current)
    setPending(null)
  }

  const all = (cfg?.projects ?? []).filter((p) => p.path !== pending?.path)
  const q = search.trim().toLowerCase()
  const filtered =
    q === '' ? all : all.filter((p) => `${p.title} ${p.world ?? ''} ${p.path}`.toLowerCase().includes(q))
  const sorted = [...filtered].sort(SORTERS[sort])
  const favs = sorted.filter((p) => p.favourite === true)
  const recents = sorted.filter((p) => p.favourite !== true)

  const card = (p: ProjectInfo): JSX.Element => (
    <SceneCard
      key={p.path}
      p={p}
      shell={shell}
      onOpen={() => void shell.openProject(p.path)}
      onChanged={refresh}
      onRemove={requestRemove}
      onPublish={() => setPublish({ dir: p.path, title: p.title, world: p.world })}
    />
  )

  return (
    <div className="eui-home">
      <nav className="eui-home-rail">
        <div className="eui-home-brand">
          <img className="eui-home-logo" src={dclLogo} alt="" />
          <span>Creator Hub</span>
        </div>
        {NAV.map(([key, label]) => (
          <button
            key={key}
            className={`eui-home-navitem ${section === key ? 'on' : ''}`}
            onClick={() => {
              setWorldsFocus(null) // manual nav always lands on the worlds grid
              setSection(key)
            }}
          >
            {label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <AccountBadge variant="rail" onAccount={() => setSection('account')} />
      </nav>

      <main className="eui-home-main">
        {section === 'scenes' && (
          <>
            <header className="eui-home-head">
              <div>
                <h1>Your scenes</h1>
                <p>Create, open and manage your Decentraland scenes.</p>
              </div>
            </header>

            {all.length > 0 && (
              <div className="eui-home-toolbar">
                <SearchField value={search} onChange={setSearch} placeholder="Search scenes…" />
                <span style={{ flex: 1 }} />
                <Select
                  value={sort}
                  onChange={(v) => setSort(v as SortKey)}
                  options={[
                    { value: 'recent', label: 'Last opened' },
                    { value: 'name', label: 'Name' },
                    { value: 'parcels', label: 'Parcels' }
                  ]}
                  aria-label="Sort"
                />
                <Segmented
                  value={view}
                  onChange={(v) => setViewMode(v)}
                  options={[
                    { value: 'grid', label: '▦' },
                    { value: 'list', label: '☰' }
                  ]}
                />
              </div>
            )}

            {favs.length > 0 && (
              <>
                <div className="eui-home-shelf">★ Favourites</div>
                <div className={`eui-scene-grid ${view}`}>{favs.map(card)}</div>
              </>
            )}

            {favs.length > 0 && <div className="eui-home-shelf">Recent</div>}
            {all.length > 0 && (
              <div className={`eui-scene-grid ${view}`}>
                {q === '' && (
                  <button className="eui-scene-card new" onClick={() => setCreating(true)}>
                    <FolderIcon />
                    <span>New or open scene…</span>
                  </button>
                )}
                {recents.map(card)}
              </div>
            )}

            {all.length === 0 && (
              <div className="eui-home-first">
                <FolderIcon />
                <p className="t">Create your first scene</p>
                <p className="s">Start from a template, or open an existing scene folder.</p>
                <Button variant="primary" size="md" onClick={() => setCreating(true)}>+ New scene</Button>
              </div>
            )}
            {q !== '' && sorted.length === 0 && all.length > 0 && (
              <p className="eui-home-empty">No scenes match “{search}”.</p>
            )}
          </>
        )}

        {section === 'worlds' && (
          <WorldsSection
            key={worldsFocus ?? 'all'}
            projects={cfg?.projects ?? []}
            initialWorld={worldsFocus}
            onOpenScene={(dir) => void shell.openProject(dir)}
            onPublishScene={(p, world) => setPublish({ dir: p.path, title: p.title, world })}
          />
        )}

        {section === 'account' && <AccountSection />}
      </main>

      {creating && (
        <NewSceneModal
          shell={shell}
          onOpenExisting={() => {
            setCreating(false)
            void shell.pickProject()
          }}
          onClose={() => setCreating(false)}
          onCreated={(dir) => {
            setCreating(false)
            void shell.openProject(dir)
          }}
        />
      )}
      {publish !== null && (
        <PublishModal
          dir={publish.dir}
          sceneTitle={publish.title}
          currentWorld={publish.world}
          onClose={() => {
            setPublish(null)
            refresh() // the publish wrote worldConfiguration.name — refresh badges
          }}
          onManageWorld={(name) => {
            setPublish(null)
            refresh()
            setWorldsFocus(name)
            setSection('worlds')
          }}
        />
      )}
      {pending !== null && (
        <Toast>
          Removed “{pending.name}”
          <button className="eui-link" onClick={undoRemove}>Undo</button>
        </Toast>
      )}
    </div>
  )
}
