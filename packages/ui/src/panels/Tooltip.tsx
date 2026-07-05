import { useEffect, useRef, useState } from 'react'

// One app-wide tooltip. Hovering any element carrying a `data-tip` attribute shows
// a styled label after a short delay — faster than the ~500ms OS-native `title`
// tooltip and matching the editor's dark design system. A single delegated
// listener on the shadow root covers every current and future `data-tip` control,
// so individual components just set the attribute (no per-button wiring).
//
// Mounted once at the root (see main-embed). The `.eui-tip` style lives in
// styles.ts. Position is fixed/viewport-space (the shadow host fills the viewport).

const DELAY_MS = 450 // a deliberate hover pause before the tip appears

type Tip = { text: string; left: number; below: boolean; offset: number; short: boolean }

const TIP_WIDTH = 220 // .eui-tip fixed width; keep in sync with styles.ts
const SHORT_LEN = 26 // brief labels render at natural width, not the full doc block

export function TooltipLayer(): JSX.Element {
  const anchor = useRef<HTMLSpanElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    const root = anchor.current?.getRootNode()
    if (!(root instanceof ShadowRoot) && !(root instanceof Document)) return
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
        // below the control by default; flip above only when near the viewport bottom
        const below = r.bottom < window.innerHeight - 48
        // clamp the CENTER so a TIP_WIDTH-wide box stays fully on-screen (fields
        // near the right panel edge would otherwise run the tip off the viewport)
        const half = TIP_WIDTH / 2 + 8
        const cx = Math.max(half, Math.min(window.innerWidth - half, r.left + r.width / 2))
        setTip({
          text,
          left: cx,
          below,
          offset: below ? r.bottom + 6 : window.innerHeight - r.top + 6,
          short: text.length <= SHORT_LEN
        })
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
      {tip !== null && (
        <div
          className={`eui-tip${tip.short ? ' short' : ''}`}
          role="tooltip"
          style={tip.below ? { left: tip.left, top: tip.offset } : { left: tip.left, bottom: tip.offset }}
        >
          {tip.text}
        </div>
      )}
    </>
  )
}
