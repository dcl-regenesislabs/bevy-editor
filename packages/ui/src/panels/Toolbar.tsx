import { useEffect, useRef, useState } from 'react'
import { state } from '../../../scene/src/state'
import { isLocalScene } from '../../../scene/src/inspector'
import { type EditorTool } from '../../../scene/src/bridge-protocol'
import { uiSetTool, uiSetCamera, uiPause, uiPlay, uiStep, uiSave } from '../actions'
import { restartScene } from '../boot'
import { undo, redo, canUndo, canRedo } from '../history'
import { autoSaveEnabled, autoSaveStatus } from '../autosave'
import {
  IconSelect,
  IconMove,
  IconRotate,
  IconScale,
  IconPlay,
  IconPause,
  IconStep,
  IconStop,
  IconDots,
  IconSidebarLeft,
  IconSidebarRight,
  IconCamera,
  IconUndo,
  IconRedo
} from '../icons'

const CAM_TITLE = {
  none: 'Free camera (WASD + mouse)',
  free: 'Free camera on — click to return to player',
  target: 'Orbiting — click to return to player'
} as const

const TOOLS: Array<{ id: EditorTool; icon: () => JSX.Element; title: string }> = [
  { id: 'select', icon: IconSelect, title: 'Select (V)' },
  { id: 'translate', icon: IconMove, title: 'Move' },
  { id: 'rotate', icon: IconRotate, title: 'Rotate' },
  { id: 'scale', icon: IconScale, title: 'Scale' }
]

export function Toolbar(props: {
  leftOpen: boolean
  rightOpen: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
  showAll: boolean
  onToggleShowAll: () => void
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const saving = state.saveStatus === 'saving…'
  const restarting = state.saveStatus === 'restarting…'

  return (
    <div className="eui-panel eui-toolbar">
      <button
        className={`eui-btn icon ${props.leftOpen ? '' : 'closed'}`}
        title={props.leftOpen ? 'Hide hierarchy' : 'Show hierarchy'}
        onClick={props.onToggleLeft}
      >
        <IconSidebarLeft />
      </button>

      <div className="eui-tool-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            title={t.title}
            className={`eui-btn icon ${state.activeAction === t.id ? 'active' : ''}`}
            onClick={() => uiSetTool(t.id)}
          >
            <t.icon />
          </button>
        ))}
      </div>

      <div className="eui-tool-group">
        {state.frozen ? (
          <>
            <button className="eui-btn icon" title="Run the scene" onClick={() => void uiPlay()}>
              <IconPlay />
            </button>
            <button className="eui-btn icon" title="Advance one tick" onClick={() => void uiStep(1)}>
              <IconStep />
            </button>
          </>
        ) : (
          <button
            className="eui-btn icon active"
            title="Scene is running — pause"
            onClick={() => void uiPause()}
          >
            <IconPause />
          </button>
        )}
        <button
          className="eui-btn icon"
          title="Restart the scene from tick 0"
          disabled={restarting}
          onClick={() => void restartScene()}
        >
          <IconStop />
        </button>
      </div>

      <div className="eui-tool-group">
        <button
          className="eui-btn icon"
          title="Undo (⌘Z)"
          disabled={!canUndo()}
          onClick={() => void undo()}
        >
          <IconUndo />
        </button>
        <button
          className="eui-btn icon"
          title="Redo (⇧⌘Z)"
          disabled={!canRedo()}
          onClick={() => void redo()}
        >
          <IconRedo />
        </button>
      </div>

      <button
        className={`eui-btn icon ${state.camMode !== 'none' ? 'active' : ''}`}
        title={CAM_TITLE[state.camMode]}
        onClick={() => uiSetCamera(state.camMode === 'none' ? 'free' : 'off')}
      >
        <IconCamera />
      </button>

      {autoSaveEnabled() ? (
        <AutoSaveChip />
      ) : (
        <button
          className="eui-btn primary"
          title={
            !state.frozen
              ? 'Stop the scene to edit & save (play-mode edits are runtime-only)'
              : isLocalScene()
                ? 'Save to the project folder (run the scene server with --data-layer for auto-save)'
                : 'Saving needs a locally-served scene'
          }
          disabled={!isLocalScene() || saving || !state.frozen}
          onClick={() => void uiSave()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}

      <MoreMenu
        open={menuOpen}
        setOpen={setMenuOpen}
        showAll={props.showAll}
        onToggleShowAll={props.onToggleShowAll}
      />

      <button
        className={`eui-btn icon ${props.rightOpen ? '' : 'closed'}`}
        title={props.rightOpen ? 'Hide inspector' : 'Show inspector'}
        onClick={props.onToggleRight}
      >
        <IconSidebarRight />
      </button>
    </div>
  )
}

const CHIP: Record<string, { label: string; cls: string; title: string }> = {
  idle: { label: 'Saved', cls: 'ok', title: 'Auto-save on — changes write to main.composite' },
  saved: { label: 'Saved', cls: 'ok', title: 'All changes written to main.composite' },
  dirty: { label: 'Unsaved', cls: 'dim', title: 'Changes pending — saving shortly' },
  saving: { label: 'Saving…', cls: 'dim', title: 'Writing main.composite' },
  error: { label: 'Save failed', cls: 'err', title: 'Auto-save failed — is the scene server running with --data-layer?' },
  off: { label: '', cls: '', title: '' }
}

function AutoSaveChip(): JSX.Element {
  // While playing, edits are runtime-only (not written to main.composite) and
  // revert on Stop — surface that instead of a save state, so it's not a surprise.
  const c = state.frozen
    ? CHIP[autoSaveStatus()] ?? CHIP.idle
    : { label: 'Runtime', cls: 'dim', title: "Scene is playing — edits are live only and revert on Stop (not saved)" }
  return (
    <span className={`eui-autosave ${c.cls}`} title={c.title}>
      <span className="dot" />
      {c.label}
    </span>
  )
}

function MoreMenu(props: {
  open: boolean
  setOpen: (v: boolean) => void
  showAll: boolean
  onToggleShowAll: () => void
}): JSX.Element {
  const { open, setOpen } = props
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      // composedPath: targets inside the shadow root are retargeted on document
      if (ref.current !== null && !e.composedPath().includes(ref.current)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open, setOpen])

  const camMode = state.camMode
  const item = (label: string, onClick: () => void, hint?: string): JSX.Element => (
    <button className="eui-menu-item" onClick={onClick}>
      {label}
      {hint !== undefined && hint !== '' && <span className="hint">{hint}</span>}
    </button>
  )

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex' }}>
      <button
        className={`eui-btn icon ${open ? 'active' : ''}`}
        title="More options"
        onClick={() => setOpen(!open)}
      >
        <IconDots />
      </button>
      {open && (
        <div className="eui-menu">
          <div className="eui-menu-label">Camera</div>
          {item('Player camera', () => uiSetCamera('off'), camMode === 'none' ? '●' : '')}
          {item('Free fly', () => uiSetCamera('free'), camMode === 'free' ? '●' : '')}
          {item('Orbit selection', () => uiSetCamera('target'), camMode === 'target' ? '●' : '')}
          {camMode !== 'none' && (
            <div style={{ display: 'flex', gap: 2, padding: '2px 4px' }}>
              {(['+x', '-x', '+y', '-y', '+z', '-z'] as const).map((a) => (
                <button
                  key={a}
                  className="eui-btn"
                  style={{ flex: 1, height: 24, padding: 0, fontSize: 11 }}
                  onClick={() => uiSetCamera(camMode === 'free' ? 'free' : 'target', a)}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
          <div className="eui-menu-sep" />
          <div className="eui-menu-label">Hierarchy</div>
          {item('Show all entities', props.onToggleShowAll, props.showAll ? 'on' : 'off')}
        </div>
      )}
    </div>
  )
}
