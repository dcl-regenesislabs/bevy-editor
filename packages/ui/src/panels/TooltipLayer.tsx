import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// One app-wide tooltip. Hovering any element carrying a `data-tip` attribute shows
// a styled label after a short delay — faster than the ~500ms OS-native `title`
// tooltip and matching the editor's dark design system. A single delegated
// listener on the shadow root covers every current and future `data-tip` control,
// so individual components just set the attribute (no per-button wiring).
//
// Mounted once at the root (see main-embed). The `.eui-tip` style lives in
// styles.ts. Position is fixed/viewport-space (the shadow host fills the viewport).

// One pause for ~100 tips, and they want opposite things: a label naming a
// toolbar button is met in passing and wants a beat before it interrupts, while
// a tip carrying data nothing else on screen carries — a withheld rate, the date
// on a chart's rule — is hunted for, and any wait is friction. 150ms reads as an
// answer rather than a delay, and is still long enough that a pointer crossing a
// dense toolbar does not strobe a label per button on its way past.
const DELAY_MS = 150

type Tip = { text: string; left: number; anchorTop: number; anchorBottom: number }

const TIP_WIDTH = 220 // .eui-tip max-width; the clamp assumes the widest case
const EDGE = 8 // minimum gap to the viewport edge
const GAP = 6 // gap between the control and the tip

export function TooltipLayer(): JSX.Element {
  const anchor = useRef<HTMLSpanElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    // no instanceof narrowing: a Node is always an EventTarget, and happy-dom's
    // document fails `instanceof Document` (its instance is HTMLDocument)
    const root = anchor.current?.getRootNode()
    if (root === undefined) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let current: Element | null = null

    const hide = (): void => {
      clearTimeout(timer)
      current = null
      setTip(null)
    }

    const onOver = (e: Event): void => {
      const target = e.target
      // skip the engine iframe (its title is an a11y name, not a button tooltip)
      const el =
        target instanceof Element && target.tagName !== 'IFRAME' ? target.closest('[data-tip]') : null
      if (el === current) return
      current = el
      clearTimeout(timer)
      if (el === null) {
        setTip(null)
        return
      }
      const text = el.getAttribute('data-tip') ?? ''
      if (text === '') {
        setTip(null)
        return
      }
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect()
        // clamp the CENTER so a TIP_WIDTH-wide box stays fully on-screen (fields
        // near the right panel edge would otherwise run the tip off the viewport)
        const half = TIP_WIDTH / 2 + EDGE
        const cx = Math.max(half, Math.min(window.innerWidth - half, r.left + r.width / 2))
        setTip({ text, left: cx, anchorTop: r.top, anchorBottom: r.bottom })
      }, DELAY_MS)
    }

    root.addEventListener('pointerover', onOver, true)
    root.addEventListener('pointerdown', hide, true) // a click shouldn't leave the tip lingering
    window.addEventListener('blur', hide)
    return () => {
      root.removeEventListener('pointerover', onOver, true)
      root.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('blur', hide)
      clearTimeout(timer)
    }
  }, [])

  return (
    <>
      <span ref={anchor} style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden />
      {tip !== null && <TipBox key={tip.text} tip={tip} />}
    </>
  )
}

// The 48px "am I near the bottom?" guess broke the moment tips grew past one
// line (a prefab description is ~10 lines): a tall tip placed below ran off the
// viewport. Measure the real box first, then place: below if it fits, above if
// that fits, otherwise pinned inside the nearest edge.
function TipBox({ tip }: { tip: Tip }): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState<number | null>(null)

  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 0
    const fitsBelow = tip.anchorBottom + GAP + h <= window.innerHeight - EDGE
    const fitsAbove = tip.anchorTop - GAP - h >= EDGE
    if (fitsBelow) setTop(tip.anchorBottom + GAP)
    else if (fitsAbove) setTop(tip.anchorTop - GAP - h)
    else setTop(Math.max(EDGE, window.innerHeight - h - EDGE))
  }, [tip])

  return (
    <div
      ref={box}
      className="eui-tip"
      role="tooltip"
      style={top === null ? { left: tip.left, top: 0, visibility: 'hidden' } : { left: tip.left, top }}
    >
      {tip.text}
    </div>
  )
}
