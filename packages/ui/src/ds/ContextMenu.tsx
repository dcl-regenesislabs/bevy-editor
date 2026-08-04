// Pointer-positioned context menu (right-click / ⋯ at a point). Distinct from an
// anchored dropdown, which CSS-positions itself under its trigger — this one is
// placed at arbitrary viewport coordinates and has to keep itself on screen.
//
// It owns the three things every call site was re-implementing: shadow-DOM-safe
// outside-close, Escape, and viewport clamping. The clamp measures the rendered
// menu instead of guessing, which is what the hand-rolled copies got wrong — they
// subtracted hard-coded widths (220) and heights (240 in one panel, 190 in the
// other) that had to be re-tuned by hand whenever an item was added.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useOutsideClose } from '.'

const GAP = 8 // keep a little air between the menu and the viewport edge

export function ContextMenu(props: {
  x: number
  y: number
  onClose: () => void
  className?: string
  children: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // start at the requested point, then correct once we can measure
  const [pos, setPos] = useState({ left: props.x, top: props.y })

  useOutsideClose(true, ref, props.onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // the menu is the top layer while it is open: closing it is the whole
      // meaning of Escape here, so it must not also clear the selection behind it
      e.stopPropagation()
      props.onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [props.onClose])

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(GAP, Math.min(props.x, window.innerWidth - width - GAP)),
      top: Math.max(GAP, Math.min(props.y, window.innerHeight - height - GAP))
    })
  }, [props.x, props.y])

  return (
    <div
      ref={ref}
      className={props.className === undefined ? 'eui-ctx' : `eui-ctx ${props.className}`}
      style={{ left: pos.left, top: pos.top }}
      role="menu"
    >
      {props.children}
    </div>
  )
}
