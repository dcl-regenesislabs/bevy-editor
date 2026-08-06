import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { state } from '@scene/state'
import { useStore } from './core/store'
import { useEditorShortcuts } from './shortcuts'
import { getBootPhase, isViewportReady } from './boot/boot'
import { Toolbar } from './panels/Toolbar'
import { HierarchyPanel } from './panels/HierarchyPanel'
import { InspectorPanel } from './panels/InspectorPanel'
import { DeleteEntityDialog, NewEntityDialog, PlayEditWarningDialog } from './panels/dialogs'
import { CreatePrefabDialog } from './panels/CreatePrefabDialog'
import { ShortcutsOverlay } from './panels/ShortcutsOverlay'
import { AssetsPanel } from './panels/AssetsPanel'
import { PrefabDropLayer, PrefabsPanel } from './panels/PrefabsPanel'
import { AiPanel } from './panels/AiPanel'
import { aiStore, canAskAssistant } from './panels/ai-store'
import { chrome, toggleRightPanel } from './core/chrome'
import { dragCapture } from './core/drag'
import { isLeftView, type LeftView } from './panels/left-view'
import { sceneEmptiness } from './panels/empty-scene'
import { prefabStore } from './panels/prefab-store'
import { renameRequested } from './panels/reveal'
import { storedValue, usePersistentEnum, usePersistentFlag, usePersistentNum } from './core/persist'

// Draggable right edge of the left dock.
function LeftResize(props: { width: number; onResize: (w: number) => void }): JSX.Element {
  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const startX = e.clientX
    const base = props.width
    dragCapture(e, (ev) => props.onResize(Math.max(248, Math.min(680, base + (ev.clientX - startX)))))
  }
  return (
    <div
      className="eui-left-resize"
      style={{ left: `calc(var(--edge-pad, 12px) + ${props.width - 5}px)` }}
      onPointerDown={onDown}
    />
  )
}

// Same drag, mirrored: the right column's left edge. Both panels in the column
// share the one width.
function RightResize(props: { width: number; onResize: (w: number) => void }): JSX.Element {
  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const startX = e.clientX
    const base = props.width
    dragCapture(e, (ev) => props.onResize(Math.max(280, Math.min(560, base + (startX - ev.clientX)))))
  }
  return (
    <div
      className="eui-right-resize"
      style={{ right: `calc(var(--edge-pad, 12px) + ${props.width - 5}px)` }}
      onPointerDown={onDown}
    />
  )
}

const DOCK_MIN_H = 200
function maxDockHeight(): number {
  return Math.max(DOCK_MIN_H, Math.round(window.innerHeight * 0.7))
}

// Vertical splitter between the inspector and the docked assistant.
function AiSplit(props: { height: number; onResize: (h: number) => void }): JSX.Element {
  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const startY = e.clientY
    const base = props.height
    dragCapture(e, (ev) =>
      props.onResize(Math.max(DOCK_MIN_H, Math.min(maxDockHeight(), base + (startY - ev.clientY))))
    )
  }
  return <div className="eui-col-split" onPointerDown={onDown} />
}

export function App(): JSX.Element {
  const frozen = useStore(() => state.frozen)
  const playEditWarn = useStore(() => state.playEditWarn)
  const deleteConfirm = useStore(() => state.deleteConfirm)
  const [newEntityOpen, setNewEntityOpen] = useState(false)
  const [createPrefab, setCreatePrefab] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [leftView, setLeftView] = usePersistentEnum<LeftView>('left-view', 'scene', isLeftView)
  const [leftWidth, setLeftWidth] = usePersistentNum('left-w', 300)
  const [leftOpen, setLeftOpen] = usePersistentFlag('left', true)
  const [rightWidth, setRightWidth] = usePersistentNum('right-w', 340)
  const [aiHeight, setAiHeight] = usePersistentNum('ai-h', 520)
  const [inspectorMin, setInspectorMin] = usePersistentFlag('right-min', false)
  const rightOpen = useStore(() => chrome.rightOpen)
  const aiMin = useStore(() => aiStore.collapsed)
  const aiMode = useStore(() => aiStore.mode)
  const aiHere = canAskAssistant()
  // Who gets the column's leftover height: the inspector unless it is minimized,
  // in which case the docked chat takes it. Two minimized panels are two title
  // bars stacked at the top, with the viewport showing through below.
  const splitShown = !inspectorMin && aiHere && aiMode === 'dock' && !aiMin
  // A stored height from a taller window (or a since-shrunk column) would push
  // the composer off the bottom — clamp on the way out, not just while dragging.
  const dockHeight = Math.min(aiHeight, maxDockHeight())
  // The dock is one unit: the inspector and the assistant show and hide together
  // (chrome.rightOpen), and neither can be dismissed on its own — only minimized
  // to its title bar. The Studio is the assistant's other mode, so it paints
  // full-screen from inside this same column and survives the dock being hidden.
  const rightCol = (
    <>
      <div className="eui-right-col" style={{ width: rightWidth }} hidden={!rightOpen && aiMode !== 'studio'}>
        {rightOpen && <InspectorPanel min={inspectorMin} onToggleMin={() => setInspectorMin(!inspectorMin)} />}
        {rightOpen && splitShown && <AiSplit height={dockHeight} onResize={setAiHeight} />}
        {aiHere && <AiPanel shown={rightOpen} fill={inspectorMin} height={dockHeight} />}
      </div>
      {rightOpen && <RightResize width={rightWidth} onResize={setRightWidth} />}
    </>
  )
  const showPrefabs = (): void => {
    setLeftOpen(true)
    setLeftView('prefabs')
  }
  useEditorShortcuts(shortcutsOpen, setShortcutsOpen, showPrefabs)
  const firstRun = useRef(storedValue('left-view') === null)
  const emptyScene = useStore(sceneEmptiness)
  useEffect(() => {
    if (!firstRun.current || emptyScene === null) return
    firstRun.current = false
    if (emptyScene) setLeftView('prefabs')
  }, [emptyScene])
  const prefabReveal = useStore(() => prefabStore.reveal)
  const libraryReveal = useStore(() => prefabStore.revealLibrary)
  useEffect(() => {
    if (prefabReveal === null && libraryReveal === null) return
    showPrefabs()
  }, [prefabReveal, libraryReveal])
  const renamePending = useStore(renameRequested)
  useEffect(() => {
    if (!renamePending) return
    setLeftOpen(true)
    setLeftView('scene')
  }, [renamePending])

  const phase = useStore(() => getBootPhase())
  const viewport = useStore(isViewportReady)
  // The assistant needs nothing from the editor scene — and a scene too broken to
  // attach is exactly when the creator needs it, to fix the code that is breaking
  // it. So the dock comes up alongside the boot pill, without the inspector.
  if (phase !== 'ready') {
    return (
      <>
        <div className="eui-boot">
          {phase === 'waiting-engine'
            ? 'Editor — waiting for engine…'
            : viewport
              ? 'Attaching editor tools…'
              : 'Editor — waiting for scene…'}
        </div>
        {aiHere && (
          <>
            <div className="eui-right-col" style={{ width: rightWidth }} hidden={!rightOpen && aiMode !== 'studio'}>
              <AiPanel shown={rightOpen} fill height={dockHeight} />
            </div>
            {rightOpen && <RightResize width={rightWidth} onResize={setRightWidth} />}
          </>
        )}
      </>
    )
  }

  return (
    <>
      <PrefabDropLayer />
      <Toolbar
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        leftWidth={leftWidth}
        rightWidth={rightWidth}
        onToggleLeft={() => setLeftOpen(!leftOpen)}
        onToggleRight={toggleRightPanel}
        onShortcuts={() => setShortcutsOpen(true)}
      />
      {leftOpen &&
        (leftView === 'scene' ? (
          <HierarchyPanel
            width={leftWidth}
            onNewEntity={() => setNewEntityOpen(true)}
            onCreatePrefab={() => setCreatePrefab(true)}
            onView={setLeftView}
          />
        ) : leftView === 'prefabs' ? (
          <PrefabsPanel
            width={leftWidth}
            onView={setLeftView}
            onCreatePrefab={() => setCreatePrefab(true)}
          />
        ) : (
          <AssetsPanel width={leftWidth} onView={setLeftView} />
        ))}
      {leftOpen && <LeftResize width={leftWidth} onResize={setLeftWidth} />}
      {rightCol}
      {!frozen && (
        <div className="eui-play-frame" aria-hidden>
          <span className="eui-play-badge">● PLAYING — changes won’t be saved</span>
        </div>
      )}
      <Toast />
      {newEntityOpen && <NewEntityDialog onClose={() => setNewEntityOpen(false)} />}
      {createPrefab && (
        <CreatePrefabDialog onClose={() => setCreatePrefab(false)} />
      )}
      {playEditWarn && <PlayEditWarningDialog />}
      {deleteConfirm !== null && <DeleteEntityDialog />}
      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
    </>
  )
}

function Toast(): JSX.Element | null {
  const msg = useStore(() => state.saveStatus)
  useEffect(() => {
    if (msg === '' || msg === 'saving…') return
    const t = setTimeout(() => {
      state.saveStatus = ''
    }, 5000)
    return () => clearTimeout(t)
  }, [msg])
  if (msg === '' || msg === 'saving…') return null
  return <div className="eui-toast">{msg}</div>
}
