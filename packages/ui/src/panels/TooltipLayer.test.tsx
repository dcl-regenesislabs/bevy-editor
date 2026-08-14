import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount, type Mounted } from '../test/render'
import { TooltipLayer } from './TooltipLayer'

const DELAY_MS = 150

let mounted: Mounted | null = null

function showTip(tip: string, rect: { top: number; bottom: number }, tipHeight: number): HTMLElement {
  mounted = mount(<TooltipLayer />)
  const target = document.createElement('button')
  target.setAttribute('data-tip', tip)
  target.getBoundingClientRect = () =>
    ({
      top: rect.top,
      bottom: rect.bottom,
      left: 100,
      right: 140,
      width: 40,
      height: rect.bottom - rect.top,
      x: 100,
      y: rect.top,
      toJSON: () => ({})
    }) as DOMRect
  mounted.container.appendChild(target)
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => tipHeight
  })
  act(() => {
    target.dispatchEvent(new Event('pointerover', { bubbles: true }))
  })
  act(() => {
    vi.advanceTimersByTime(DELAY_MS + 10)
  })
  const el = document.querySelector<HTMLElement>('.eui-tip')
  expect(el).not.toBeNull()
  if (el === null) throw new Error('unreachable')
  return el
}

describe('TooltipLayer placement', () => {
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')

  beforeEach(() => {
    vi.useFakeTimers()
    window.innerHeight = 800
    window.innerWidth = 1200
  })

  afterEach(() => {
    if (originalOffsetHeight !== undefined)
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight)
    mounted?.unmount()
    mounted = null
    vi.useRealTimers()
  })

  it('places a short tip below its control', () => {
    const el = showTip('short label', { top: 300, bottom: 320 }, 30)
    expect(el.style.visibility).not.toBe('hidden')
    expect(parseFloat(el.style.top)).toBe(326)
  })

  it('flips a tall tip above when it would run off the bottom', () => {
    const el = showTip('a very tall description', { top: 700, bottom: 720 }, 200)
    expect(parseFloat(el.style.top)).toBe(700 - 6 - 200)
  })

  it('pins inside the viewport when the tip fits neither side', () => {
    window.innerHeight = 300
    const el = showTip('taller than the viewport allows', { top: 150, bottom: 170 }, 280)
    const top = parseFloat(el.style.top)
    expect(top).toBeGreaterThanOrEqual(8)
    expect(top + 280).toBeLessThanOrEqual(300)
  })
})
