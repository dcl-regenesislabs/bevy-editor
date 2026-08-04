import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { state } from '../../scene/src/state'
import { useStore } from './store'
import { useEditorShortcuts } from './shortcuts'
import { getBootPhase, isViewportReady } from './boot'
import { Toolbar } from './panels/Toolbar'
import { HierarchyPanel } from './panels/HierarchyPanel'
import { InspectorPanel } from './panels/InspectorPanel'
import {
  CreatePrefabDialog,
  DeleteEntityDialog,
  NewEntityDialog,
  PlayEditWarningDialog
} from './panels/Dialogs'
import { ShortcutsOverlay } from './panels/ShortcutsOverlay'
import { AssetsPanel } from './panels/AssetsPanel'
import { PrefabDropLayer, PrefabsPanel } from './panels/Prefabs'
import { isLeftView, type LeftView } from './panels/left-view'
import { sceneEmptiness } from './panels/empty-scene'
import { prefabStore } from './panels/prefab-store'
import { renameRequested } from './panels/reveal'
import { storedValue, usePersistentEnum, usePersistentFlag, usePersistentNum } from './persist'

// Draggable right edge of the left dock. Pointer-capture so the drag keeps
// tracking even when the cursor passes over the engine iframe.
function LeftResize(props: { width: number; onResize: (w: number) => void }): JSX.Element {
  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const base = props.width
    const move = (ev: PointerEvent): void =>
      props.onResize(Math.max(248, Math.min(680, base + (ev.clientX - startX))))
    const up = (): void => {
      el.releasePointerCapture(e.pointerId)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return <div className="eui-left-resize" style={{ left: 12 + props.width - 5 }} onPointerDown={onDown} />
}

export function App(): JSX.Element {
  const frozen = useStore(() => state.frozen)
  const playEditWarn = useStore(() => state.playEditWarn)
  const deleteConfirm = useStore(() => state.deleteConfirm)
  const [newEntityOpen, setNewEntityOpen] = useState(false)
  const [createPrefabOpen, setCreatePrefabOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [leftView, setLeftView] = usePersistentEnum<LeftView>('left-view', 'scene', isLeftView)
  const [leftWidth, setLeftWidth] = usePersistentNum('left-w', 300)
  const [leftOpen, setLeftOpen] = usePersistentFlag('left', true)
  const [rightOpen, setRightOpen] = usePersistentFlag('right', true)
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
  if (phase !== 'ready') {
    return (
      <div className="eui-boot">
        {phase === 'waiting-engine'
          ? 'Editor — waiting for engine…'
          : viewport
            ? 'Attaching editor tools…'
            : 'Editor — waiting for scene…'}
      </div>
    )
  }

  return (
    <>
      <PrefabDropLayer />
      <Toolbar
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen(!leftOpen)}
        onToggleRight={() => setRightOpen(!rightOpen)}
        onShortcuts={() => setShortcutsOpen(true)}
      />
      {leftOpen &&
        (leftView === 'scene' ? (
          <HierarchyPanel
            width={leftWidth}
            onNewEntity={() => setNewEntityOpen(true)}
            onCreatePrefab={() => setCreatePrefabOpen(true)}
            onView={setLeftView}
          />
        ) : leftView === 'prefabs' ? (
          <PrefabsPanel
            width={leftWidth}
            onView={setLeftView}
            onCreatePrefab={() => setCreatePrefabOpen(true)}
          />
        ) : (
          <AssetsPanel width={leftWidth} onView={setLeftView} />
        ))}
      {leftOpen && <LeftResize width={leftWidth} onResize={setLeftWidth} />}
      {rightOpen && <InspectorPanel />}
      {!frozen && (
        <div className="eui-play-frame" aria-hidden>
          <span className="eui-play-badge">● PLAYING — changes won’t be saved</span>
        </div>
      )}
      <Toast />
      {newEntityOpen && <NewEntityDialog onClose={() => setNewEntityOpen(false)} />}
      {createPrefabOpen && <CreatePrefabDialog onClose={() => setCreatePrefabOpen(false)} />}
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
