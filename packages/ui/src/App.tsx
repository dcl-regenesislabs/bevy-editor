import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { state } from '../../scene/src/state'
import { useStore } from './store'
import { useEditorShortcuts } from './shortcuts'
import { getBootPhase } from './boot'
import { Toolbar } from './panels/Toolbar'
import { HierarchyPanel } from './panels/HierarchyPanel'
import { InspectorPanel } from './panels/InspectorPanel'
import { NewEntityDialog, PlayEditWarningDialog } from './panels/Dialogs'
import { ShortcutsOverlay } from './panels/ShortcutsOverlay'
import { AssetsPanel, type LeftView } from './panels/AssetsPanel'

function usePersistent(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    const stored = localStorage.getItem(`eui:${key}`)
    return stored === null ? initial : stored === '1'
  })
  return [
    v,
    (next: boolean) => {
      localStorage.setItem(`eui:${key}`, next ? '1' : '0')
      setV(next)
    }
  ]
}

function usePersistentNum(key: string, initial: number): [number, (v: number) => void] {
  const [v, setV] = useState(() => {
    const n = Number(localStorage.getItem(`eui:${key}`))
    return Number.isFinite(n) && n > 0 ? n : initial
  })
  return [
    v,
    (next: number) => {
      localStorage.setItem(`eui:${key}`, String(next))
      setV(next)
    }
  ]
}

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
  const [newEntityOpen, setNewEntityOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  useEditorShortcuts(setShortcutsOpen)
  const [leftView, setLeftView] = useState<LeftView>('scene')
  const [leftWidth, setLeftWidth] = usePersistentNum('left-w', 300)
  const [leftOpen, setLeftOpen] = usePersistent('left', true)
  const [rightOpen, setRightOpen] = usePersistent('right', true)
  const [showAll, setShowAll] = usePersistent('show-all', false)

  const phase = getBootPhase()
  if (phase !== 'ready') {
    return (
      <div className="eui-boot">
        {phase === 'waiting-engine' ? 'Editor — waiting for engine…' : 'Editor — waiting for scene…'}
      </div>
    )
  }

  return (
    <>
      <Toolbar
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen(!leftOpen)}
        onToggleRight={() => setRightOpen(!rightOpen)}
        showAll={showAll}
        onToggleShowAll={() => setShowAll(!showAll)}
        onShortcuts={() => setShortcutsOpen(true)}
      />
      {leftOpen &&
        (leftView === 'scene' ? (
          <HierarchyPanel
            showAll={showAll}
            width={leftWidth}
            onNewEntity={() => setNewEntityOpen(true)}
            onView={setLeftView}
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
      {playEditWarn && <PlayEditWarningDialog />}
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
