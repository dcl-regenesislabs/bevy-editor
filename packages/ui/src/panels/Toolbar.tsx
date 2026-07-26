import { useEffect, useRef, useState } from 'react'
import { state } from '../../../scene/src/state'
import { isLocalScene } from '../../../scene/src/inspector'
import { type EditorTool } from '../../../scene/src/bridge-protocol'
import { uiSetTool, uiSetCamera, uiPause, uiPlay, uiStep, uiSave, uiToggleColliders, uiToggleSnap } from '../actions'
import { restartScene } from '../boot'
import { undo, redo, canUndo, canRedo } from '../history'
import { autoSaveEnabled, autoSaveStatus } from '../autosave'
import { useStore } from '../store'
import { AutoSaveChip as DsAutoSaveChip, MenuItem } from '../ds'
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
  IconGrid,
  IconUndo,
  IconRedo
} from '../icons'

// What each mode IS, not what the button will do — the caret menu shows all three
// at once with the active one marked, so a state-describing label would misread.
const CAM_MODES = [
  { id: 'off', label: 'Player camera', tip: 'The avatar’s own view' },
  { id: 'free', label: 'Free fly', tip: 'WASD + mouse; scroll changes speed' },
  { id: 'target', label: 'Orbit selection', tip: 'Circle the selection; F to focus' }
] as const

// state.camMode uses 'none' where the command takes 'off'
const CAM_TITLE = {
  none: 'Player camera — click to fly',
  free: 'Free fly — click to return to the player',
  target: 'Orbiting the selection — click to return to the player'
} as const

const TOOLS: Array<{ id: EditorTool; icon: () => JSX.Element; title: string }> = [
  { id: 'select', icon: IconSelect, title: 'Select (Q)' },
  { id: 'translate', icon: IconMove, title: 'Move (W)' },
  { id: 'rotate', icon: IconRotate, title: 'Rotate (E)' },
  { id: 'scale', icon: IconScale, title: 'Scale (R)' }
]

export function Toolbar(props: {
  leftOpen: boolean
  rightOpen: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
  showAll: boolean
  onToggleShowAll: () => void
  onShortcuts: () => void
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const saveStatus = useStore(() => state.saveStatus)
  const snap = useStore(() => state.snap)
  const activeAction = useStore(() => state.activeAction)
  const frozen = useStore(() => state.frozen)
  const camMode = useStore(() => state.camMode)
  // subscribe to the non-proxied module state these read, so the buttons/chip
  // re-render when it changes (the mutators call notify())
  const undoable = useStore(() => canUndo())
  const redoable = useStore(() => canRedo())
  const saving = saveStatus === 'saving…'
  const restarting = saveStatus === 'restarting…'

  return (
    <div className="eui-panel eui-toolbar">
      <button
        className={`eui-btn icon ${props.leftOpen ? '' : 'closed'}`}
        data-tip={props.leftOpen ? 'Hide hierarchy' : 'Show hierarchy'}
        onClick={props.onToggleLeft}
      >
        <IconSidebarLeft />
      </button>

      <div className="eui-tool-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            data-tip={t.title}
            className={`eui-btn icon ${activeAction === t.id ? 'active' : ''}`}
            onClick={() => uiSetTool(t.id)}
          >
            <t.icon />
          </button>
        ))}
      </div>

      <div className="eui-tool-group">
        {frozen ? (
          <>
            <button className="eui-btn icon" data-tip="Run the scene" onClick={() => void uiPlay()}>
              <IconPlay />
            </button>
            <button className="eui-btn icon" data-tip="Advance one tick" onClick={() => void uiStep(1)}>
              <IconStep />
            </button>
          </>
        ) : (
          <button
            className="eui-btn icon active"
            data-tip="Scene is running — pause"
            onClick={() => void uiPause()}
          >
            <IconPause />
          </button>
        )}
        <button
          className="eui-btn icon"
          data-tip="Restart the scene from tick 0"
          disabled={restarting}
          onClick={() => void restartScene()}
        >
          <IconStop />
        </button>
      </div>

      <div className="eui-tool-group">
        <button
          className={`eui-btn icon ${snap ? 'active' : ''}`}
          data-tip={
            snap
              ? 'Snap is on — 0.5m / 15° / 0.1× steps. Hold ⇧ while dragging for free movement'
              : 'Snap to grid — 0.5m / 15° / 0.1× steps. Hold ⇧ while dragging to snap just once'
          }
          onClick={uiToggleSnap}
        >
          <IconGrid />
        </button>
      </div>

      <div className="eui-tool-group">
        <button
          className="eui-btn icon"
          data-tip="Undo (⌘Z)"
          disabled={!undoable}
          onClick={() => void undo()}
        >
          <IconUndo />
        </button>
        <button
          className="eui-btn icon"
          data-tip="Redo (⇧⌘Z)"
          disabled={!redoable}
          onClick={() => void redo()}
        >
          <IconRedo />
        </button>
      </div>

      <CameraControl camMode={camMode} />

      {autoSaveEnabled() ? (
        <AutoSaveChip />
      ) : (
        <button
          className="eui-btn primary"
          data-tip={
            !frozen
              ? 'Stop the scene to edit & save (play-mode edits are runtime-only)'
              : isLocalScene()
                ? 'Save to the project folder (run the scene server with --data-layer for auto-save)'
                : 'Saving needs a locally-served scene'
          }
          disabled={!isLocalScene() || saving || !frozen}
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
        className="eui-btn icon"
        data-tip="Keyboard shortcuts (?)"
        onClick={props.onShortcuts}
      >
        ?
      </button>

      <button
        className={`eui-btn icon ${props.rightOpen ? '' : 'closed'}`}
        data-tip={props.rightOpen ? 'Hide inspector' : 'Show inspector'}
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
  error: { label: 'Save failed', cls: 'err', title: 'Auto-save failed — is the scene server running with --data-layer?' }
}

function AutoSaveChip(): JSX.Element {
  const frozen = useStore(() => state.frozen)
  const status = useStore(() => autoSaveStatus()) // re-render when the status changes
  // While playing, edits are runtime-only (not written to main.composite) and
  // revert on Stop — surface that instead of a save state, so it's not a surprise.
  const c = frozen
    ? CHIP[status] ?? CHIP.idle
    : { label: 'Runtime', cls: 'dim', title: "Scene is playing — edits are live only and revert on Stop (not saved)" }
  return <DsAutoSaveChip state={c.cls as 'ok' | 'dim' | 'err' | undefined} tip={c.title}>{c.label}</DsAutoSaveChip>
}

// Camera: the icon toggles fly on/off (the common case), the caret opens every
// mode plus the axis presets. Previously the toggle was here and the mode list
// lived in the overflow menu, so the current mode was invisible from the toolbar.
function CameraControl(props: { camMode: 'none' | 'free' | 'target' }): JSX.Element {
  const { camMode } = props
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex' }}>
      <button
        className={`eui-btn icon ${camMode !== 'none' ? 'active' : ''}`}
        data-tip={CAM_TITLE[camMode]}
        onClick={() => uiSetCamera(camMode === 'none' ? 'free' : 'off')}
      >
        <IconCamera />
      </button>
      <button
        className={`eui-btn caret ${open ? 'active' : ''}`}
        data-tip="Camera modes"
        onClick={() => setOpen(!open)}
      >
        ▾
      </button>
      {open && (
        <div className="eui-menu">
          {CAM_MODES.map((m) => (
            <MenuItem
              key={m.id}
              hint={(m.id === 'off' ? 'none' : m.id) === camMode ? '●' : ''}
              onClick={() => {
                uiSetCamera(m.id)
                setOpen(false)
              }}
            >
              <span data-tip={m.tip}>{m.label}</span>
            </MenuItem>
          ))}
          {camMode !== 'none' && (
            <>
              <div className="eui-menu-sep" />
              <div className="eui-menu-label">Look along</div>
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
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MoreMenu(props: {
  open: boolean
  setOpen: (v: boolean) => void
  showAll: boolean
  onToggleShowAll: () => void
}): JSX.Element {
  const { open, setOpen } = props
  const camMode = useStore(() => state.camMode)
  const showColliders = useStore(() => state.showColliders)
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

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex' }}>
      <button
        className={`eui-btn icon ${open ? 'active' : ''}`}
        data-tip="More options"
        onClick={() => setOpen(!open)}
      >
        <IconDots />
      </button>
      {open && (
        <div className="eui-menu">
          <div className="eui-menu-label">Viewport</div>
          <MenuItem hint={showColliders ? 'on' : 'off'} onClick={() => void uiToggleColliders()}>
            Show collider &amp; trigger volumes
          </MenuItem>
          <div className="eui-menu-sep" />
          <div className="eui-menu-label">Hierarchy</div>
          <MenuItem hint={props.showAll ? 'on' : 'off'} onClick={props.onToggleShowAll}>Show all entities</MenuItem>
        </div>
      )}
    </div>
  )
}
