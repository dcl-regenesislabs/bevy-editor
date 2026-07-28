import { useEffect, useState } from 'react'
import type { OpenPreview } from '@dcl-editor/contract'
import { MenuItem } from '../../ds'
import { useStore } from '../../store'
import { GlobeIcon, openExternal } from '../worlds/common'
import { state } from '../../../../scene/src/state'
import { AccountBadge } from '../account/account'
import { PublishModal } from '../publish/PublishModal'
import { restartToUpdate, useUpdateStatus } from '../update/update'
import { SceneSettingsModal } from '../scene-settings/SceneSettingsModal'
import { MobilePreviewModal } from '../preview/MobilePreviewModal'
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

const PhoneIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="4.5" y="1.5" width="7" height="13" rx="1.8" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7 12.5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

const MonitorIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M6 14h4M8 11.5V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

const ChevronDownIcon = (): JSX.Element => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
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
  const upd = useUpdateStatus()
  const [updateHint, setUpdateHint] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobilePreview, setMobilePreview] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewFail, setPreviewFail] = useState<Extract<OpenPreview, { ok: false }>['reason'] | null>(null)
  // launch an external preview client; failures show as a note inside the menu
  const runPreview = (fn: (() => Promise<OpenPreview>) | undefined): void => {
    if (fn === undefined) return
    void fn().then((r) => {
      if (r.ok) setPreviewOpen(false)
      else setPreviewFail(r.reason)
    })
  }
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
      {window.editorShell?.mobilePreview !== undefined && (
        <div className="eui-topbar-menu-wrap">
          <button
            className={`eui-topbar-btn wide ${previewOpen ? 'on' : ''}`}
            onClick={() => {
              setPreviewFail(null) // a stale failure note must not survive a re-open
              setPreviewOpen((v) => !v)
            }}
          >
            Preview
            <ChevronDownIcon />
          </button>
          {previewOpen && (
            <>
              <div className="eui-topbar-scrim" onClick={() => setPreviewOpen(false)} />
              <div className="eui-ctx eui-topbar-menu">
                {window.editorShell?.webPreview !== undefined && (
                  <MenuItem icon={<GlobeIcon />} onClick={() => runPreview(window.editorShell?.webPreview)}>
                    In your browser
                  </MenuItem>
                )}
                <MenuItem
                  icon={<PhoneIcon />}
                  onClick={() => {
                    setPreviewOpen(false)
                    setMobilePreview(true)
                  }}
                >
                  On your phone…
                </MenuItem>
                {window.editorShell?.unityPreview !== undefined && (
                  <MenuItem icon={<MonitorIcon />} onClick={() => runPreview(window.editorShell?.unityPreview)}>
                    In Decentraland Desktop
                  </MenuItem>
                )}
                {previewFail === 'no-scene' && (
                  <span className="eui-menu-note eui-topbar-note">The scene server is still starting — try again in a moment.</span>
                )}
                {previewFail === 'no-client' && (
                  <span className="eui-menu-note eui-topbar-note">
                    Decentraland Desktop isn't installed.{' '}
                    <button className="eui-link" onClick={() => openExternal('https://dcl.gg/explorer')}>
                      Get it
                    </button>
                  </span>
                )}
              </div>
            </>
          )}
        </div>
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
            className={`eui-topbar-btn ${upd.state === 'downloaded' ? 'eui-has-update' : ''}`}
            data-tip={upd.state === 'downloaded' ? 'Settings — update ready' : 'Settings'}
            onClick={() => {
              setUpdateHint(false) // a stale "deploy running" hint must not survive a re-open
              setMenuOpen((v) => !v)
            }}
          >
            <GearIcon />
            {upd.state === 'downloaded' && <span className="eui-update-dot" />}
          </button>
          {menuOpen && (
            <>
              <div className="eui-topbar-scrim" onClick={() => setMenuOpen(false)} />
              <div className="eui-ctx eui-topbar-menu">
                {project !== null && window.editorShell?.sceneSettings !== undefined && (
                  <button
                    className="eui-menu-item"
                    onClick={() => {
                      setMenuOpen(false)
                      setSettingsOpen(true)
                    }}
                  >
                    Scene settings…
                  </button>
                )}
                <button className="eui-menu-item" onClick={home}>Back to projects</button>
                <button className="eui-menu-item" onClick={() => window.location.reload()}>Reload editor</button>
                {upd.state === 'downloaded' && (
                  <button
                    className="eui-menu-item"
                    onClick={() => {
                      // stays open on refusal so the busy hint is seen
                      void restartToUpdate().then((r) => {
                        if (r.ok) setMenuOpen(false)
                        else setUpdateHint(true)
                      })
                    }}
                  >
                    Restart to update to v{upd.version}
                  </button>
                )}
                {updateHint && <span className="eui-menu-note">Finish the current deploy first</span>}
              </div>
            </>
          )}
        </div>
      )}
      {window.editorShell !== undefined && <AccountBadge />}
      {settingsOpen && project !== null && (
        <SceneSettingsModal
          dir={project}
          onClose={() => setSettingsOpen(false)}
          // parcels/base/spawn feed the engine's launch params — relaunch the
          // scene so the preview actually reflects the new layout
          onSaved={(layoutChanged) => {
            if (layoutChanged) void window.editorShell?.openProject(project)
          }}
        />
      )}
      {mobilePreview && <MobilePreviewModal onClose={() => setMobilePreview(false)} />}
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
