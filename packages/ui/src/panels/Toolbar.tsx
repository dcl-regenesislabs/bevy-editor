import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { state } from '@scene/state'
import { isLocalScene } from '@scene/inspector'
import { type EditorTool } from '@scene/bridge-protocol'
import { uiPause, uiPlay, uiSave, uiStep } from '../actions/playback'
import { uiSetCamera, uiSetTool } from '../actions/selection'
import { uiToggleColliders, uiToggleSnap, uiToggleSpawnAreas } from '../actions/viewport'
import { restartScene } from '../boot/boot'
import { undo, redo, canUndo, canRedo } from '../core/history'
import { autoSaveEnabled, autoSaveStatus } from '../core/autosave'
import { sceneUi, toggleSceneUi } from '../engine/scene-ui'
import { sceneAudio, toggleSceneAudio } from '../engine/audio'
import { useStore } from '../core/store'
import { usePersistentFlag, usePersistentNum } from '../core/persist'
import { MOD, SHIFT, keyCombo } from '../lib/keys'
import { dragCapture } from '../core/drag'
import { AutoSaveChip as DsAutoSaveChip, Toggle } from '../ds'
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
  IconRedo,
  IconSceneUi,
  IconSound,
  IconSoundMuted
} from '../icons'

// state.camMode uses 'none' where the command takes 'off'
const CAM_TITLE = {
  none: 'Player camera — click to fly',
  free: 'Free fly — click to return to the player',
  target: 'Orbiting the selection — click to return to the player'
} as const

const TOOLS: Array<{ id: EditorTool; icon: () => JSX.Element; title: string }> = [
  { id: 'select', icon: IconSelect, title: `Select (${keyCombo(MOD, 'Q')})` },
  { id: 'translate', icon: IconMove, title: `Move (${keyCombo(MOD, 'W')})` },
  { id: 'rotate', icon: IconRotate, title: `Rotate (${keyCombo(MOD, 'E')})` },
  { id: 'scale', icon: IconScale, title: `Scale (${keyCombo(MOD, 'R')})` }
]

export function Toolbar(props: {
  leftOpen: boolean
  rightOpen: boolean
  // widths of the docks the bar sits between — 0 when a dock is closed. They
  // become --dock-l/--dock-r, which is what centres the bar in the gap instead
  // of on the window (base.css). App owns the widths, so it has to hand them over.
  leftWidth: number
  rightWidth: number
  onToggleLeft: () => void
  onToggleRight: () => void
  onShortcuts: () => void
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const saveStatus = useStore(() => state.saveStatus)
  const sceneUiHidden = useStore(() => sceneUi.hidden)
  const muted = useStore(() => sceneAudio.muted)
  const snap = useStore(() => state.snap)
  const activeAction = useStore(() => state.activeAction)
  const frozen = useStore(() => state.frozen)
  const camMode = useStore(() => state.camMode)
  // subscribe to the non-proxied module state these read, so the buttons/chip
  // re-render when it changes (the mutators call notify())
  const undoable = useStore(() => canUndo())
  const redoable = useStore(() => canRedo())
  const saving = saveStatus === 'saving…'
  const restarting = saveStatus === 'restarting…' || saving

  // Where the toolbar sits. Until it's dragged it stays centred by CSS — the
  // stored x/y only mean anything once `moved` is set, which is also why they
  // clamp to a margin: usePersistentNum drops anything <= 0.
  const barRef = useRef<HTMLDivElement>(null)
  const [moved, setMoved] = usePersistentFlag('toolbar-moved', false)
  const [barX, setBarX] = usePersistentNum('toolbar-x', 12)
  const [barY, setBarY] = usePersistentNum('toolbar-y', 12)
  // Once dragged, left/top are the whole answer and the dock insets stop
  // mattering — a bar the creator parked stays parked when a panel resizes.
  const docks = {
    '--dock-l': `${props.leftOpen ? props.leftWidth : 0}px`,
    '--dock-r': `${props.rightOpen ? props.rightWidth : 0}px`
  } as CSSProperties
  const placement: CSSProperties = moved ? { left: barX, top: barY } : docks
  // The toolbar must never come to rest anywhere it can't be grabbed again: the
  // topbar paints over it (higher z), so a drag under it used to hide the
  // toolbar for good. The floor is the topbar's own height, read from the
  // layout's custom property — zero in the bundle that has no topbar.
  const clamp = (x: number, y: number, rect: DOMRect): [number, number] => {
    const edge = 8
    const raw = parseFloat(getComputedStyle(barRef.current as Element).getPropertyValue('--topbar-h'))
    const top = (Number.isFinite(raw) ? raw : 0) + edge
    return [
      Math.max(edge, Math.min(window.innerWidth - rect.width - edge, x)),
      Math.max(top, Math.min(window.innerHeight - rect.height - edge, y))
    ]
  }
  // A window resized smaller (or a position stored on a larger screen) would
  // strand it off-screen, which is the same lost toolbar by another route.
  useEffect(() => {
    if (!moved) return
    const fix = (): void => {
      const bar = barRef.current
      if (bar === null) return
      const [x, y] = clamp(barX, barY, bar.getBoundingClientRect())
      if (x !== barX) setBarX(x)
      if (y !== barY) setBarY(y)
    }
    fix()
    window.addEventListener('resize', fix)
    return () => window.removeEventListener('resize', fix)
  }, [moved, barX, barY])
  const startDrag = (e: ReactPointerEvent<HTMLSpanElement>): void => {
    const bar = barRef.current
    if (bar === null) return
    const rect = bar.getBoundingClientRect()
    const offX = e.clientX - rect.left
    const offY = e.clientY - rect.top
    let dragging = false
    dragCapture(e, (ev) => {
      // only on the first real movement: a plain click on the grip must not
      // un-centre the toolbar by promoting the stale stored position
      if (!dragging) {
        dragging = true
        setMoved(true)
      }
      const [x, y] = clamp(ev.clientX - offX, ev.clientY - offY, rect)
      setBarX(x)
      setBarY(y)
    })
  }

  return (
    <div ref={barRef} className={`eui-panel eui-toolbar ${moved ? 'moved' : ''}`} style={placement}>
      <span
        className="eui-toolbar-grip"
        data-tip="Drag to move · double-click to re-centre"
        onPointerDown={startDrag}
        onDoubleClick={() => setMoved(false)}
      />
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
        {/* Muting belongs beside the transport: it's the same kind of control —
            what the scene is doing right now, not what you're editing. */}
        <button
          className={`eui-btn icon ${muted ? 'muted' : ''}`}
          data-tip={muted ? 'Unmute the scene (M)' : 'Mute (M)'}
          aria-pressed={muted}
          onClick={toggleSceneAudio}
        >
          {muted ? <IconSoundMuted /> : <IconSound />}
        </button>
      </div>

      <div className="eui-tool-group">
        <button
          className={`eui-btn icon ${snap ? 'active' : ''}`}
          data-tip={
            snap
              ? `Snap is on — 0.5m / 15° / 0.1× steps. Hold ${SHIFT} while dragging for free movement`
              : `Snap to grid — 0.5m / 15° / 0.1× steps. Hold ${SHIFT} while dragging to snap just once`
          }
          onClick={uiToggleSnap}
        >
          <IconGrid />
        </button>
        <button
          className={`eui-btn icon ${sceneUiHidden ? 'active' : ''}`}
          data-tip={
            sceneUiHidden
              ? "Scene UI hidden — click to show it again"
              : "Hide the scene's UI (HUD, menus) to see the world behind it"
          }
          onClick={() => void toggleSceneUi()}
        >
          <IconSceneUi />
        </button>
      </div>

      <div className="eui-tool-group">
        <button
          className="eui-btn icon"
          data-tip={`Undo (${keyCombo(MOD, 'Z')})`}
          disabled={!undoable}
          onClick={() => void undo()}
        >
          <IconUndo />
        </button>
        <button
          className="eui-btn icon"
          data-tip={`Redo (${keyCombo(MOD, SHIFT, 'Z')})`}
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

      <MoreMenu open={menuOpen} setOpen={setMenuOpen} />

      <button
        className="eui-btn icon"
        data-tip="Keyboard shortcuts (?)"
        onClick={props.onShortcuts}
      >
        ?
      </button>

      <button
        className={`eui-btn icon ${props.rightOpen ? '' : 'closed'}`}
        data-tip={props.rightOpen ? 'Hide inspector & assistant' : 'Show inspector & assistant'}
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

// Camera: one button, two states — player camera or free fly. Orbit stays
// reachable the way it always was (F focuses the selection); a three-way menu
// for that earned its removal.
function CameraControl(props: { camMode: 'none' | 'free' | 'target' }): JSX.Element {
  const { camMode } = props
  return (
    <button
      className={`eui-btn icon ${camMode !== 'none' ? 'active' : ''}`}
      data-tip={CAM_TITLE[camMode]}
      onClick={() => uiSetCamera(camMode === 'none' ? 'free' : 'off')}
    >
      <IconCamera />
    </button>
  )
}

function MenuToggleItem(props: { checked: boolean; onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <button className="eui-menu-item" role="menuitemcheckbox" aria-checked={props.checked} onClick={props.onClick}>
      {props.children}
      <span className="hint">
        <Toggle size="sm" presentation checked={props.checked} />
      </span>
    </button>
  )
}

function MoreMenu(props: {
  open: boolean
  setOpen: (v: boolean) => void
}): JSX.Element {
  const { open, setOpen } = props
  const showColliders = useStore(() => state.showColliders)
  const showSpawnAreas = useStore(() => state.showSpawnAreas)
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
          <MenuToggleItem checked={showColliders} onClick={() => void uiToggleColliders()}>
            Show collider &amp; trigger volumes
          </MenuToggleItem>
          <MenuToggleItem checked={showSpawnAreas} onClick={uiToggleSpawnAreas}>
            Show spawn points
          </MenuToggleItem>
        </div>
      )}
    </div>
  )
}
