import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { state } from '../../../../scene/src/state'
import { AccountBadge } from '../account/account'
import { PublishModal } from '../publish/PublishModal'
import { backToProjects } from './nav'

const TerminalIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="2.5" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M4 6l2.5 2L4 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 10.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

const ArrowLeftIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const GearIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8 3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

// Slim top bar over the viewport: scene name on the left, settings + back-to-
// home on the right. Replaces the old floating ⌂ button.
export function SceneTopbar(props: { logsOpen: boolean; onToggleLogs: () => void; project?: string | null }): JSX.Element {
  const scene = useStore(() => state.scene)
  const [menuOpen, setMenuOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [world, setWorld] = useState<string | null>(null)
  const title = scene?.title ?? scene?.hash ?? 'Loading scene…'
  const home = backToProjects
  const project = props.project ?? null
  // the scene's current target world (for pre-selecting in the publish modal)
  useEffect(() => {
    if (project === null || window.editorShell === undefined) return
    void window.editorShell.getState().then((s) => {
      setWorld(s.projects.find((p) => p.path === project)?.world ?? null)
    })
  }, [project, publishing])
  return (
    <div className="eui-topbar">
      <button className="eui-topbar-home" data-tip="Back to projects" onClick={home}>
        <ArrowLeftIcon />
      </button>
      <div className="eui-topbar-title">
        <span className="eui-overline">Editing</span>
        <span className="eui-title">{title}</span>
      </div>
      <span style={{ flex: 1 }} />
      {window.editorShell !== undefined && project !== null && (
        <button className="eui-topbar-publish" onClick={() => setPublishing(true)}>
          Publish
        </button>
      )}
      <button
        className={`eui-topbar-btn ${props.logsOpen ? 'on' : ''}`}
        data-tip={props.logsOpen ? 'Hide logs' : 'Show build / server logs'}
        onClick={props.onToggleLogs}
      >
        <TerminalIcon />
      </button>
      {window.editorShell !== undefined && (
        <div className="eui-topbar-menu-wrap">
          <button
            className="eui-topbar-btn"
            data-tip="Settings"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <GearIcon />
          </button>
          {menuOpen && (
            <>
              <div className="eui-topbar-scrim" onClick={() => setMenuOpen(false)} />
              <div className="eui-ctx eui-topbar-menu">
                <button className="eui-menu-item" onClick={home}>Back to projects</button>
                <button className="eui-menu-item" onClick={() => window.location.reload()}>Reload editor</button>
              </div>
            </>
          )}
        </div>
      )}
      {window.editorShell !== undefined && <AccountBadge />}
      {publishing && project !== null && (
        <PublishModal
          dir={project}
          sceneTitle={typeof title === 'string' ? title : 'this scene'}
          currentWorld={world}
          onClose={() => setPublishing(false)}
        />
      )}
    </div>
  )
}
