// One pointer drag, for the panel splitters and the toolbar's grip. Pointer
// capture is the whole point: the cursor spends most of a drag over the engine
// iframe, which swallows plain document listeners, so the moves have to keep
// reporting to the element the drag started on. Callers keep their own start
// values in the closure — this owns only the capture and its teardown, which is
// the part every hand-rolled copy gets subtly wrong.
import type { PointerEvent as ReactPointerEvent } from 'react'

export function dragCapture(
  e: ReactPointerEvent<HTMLElement>,
  onMove: (ev: PointerEvent) => void,
  onUp?: (ev: PointerEvent) => void
): void {
  e.preventDefault()
  const el = e.currentTarget
  el.setPointerCapture(e.pointerId)
  const up = (ev: PointerEvent): void => {
    el.releasePointerCapture(e.pointerId)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', up)
    // after teardown: a drop handler that starts another capture must not race
    // the one being dismantled
    onUp?.(ev)
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', up)
}
