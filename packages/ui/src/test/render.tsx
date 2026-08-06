// The whole render harness for the ui-dom project: mount a React element into a
// detached container, drive it through act(), read it back with querySelector.
//
// Deliberately not @testing-library — the surfaces under test are shadow-root
// components whose queries are class- and aria-label-based anyway, and a
// four-function harness keeps the dependency list at one package (happy-dom).
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

export interface Mounted {
  container: HTMLElement
  root: Root
  /** re-render the same root with a new element */
  render: (node: ReactElement) => void
  unmount: () => void
  /** visible text of the whole tree, whitespace-collapsed */
  text: () => string
  find: (selector: string) => HTMLElement | null
  all: (selector: string) => HTMLElement[]
  /** the first element whose trimmed text is exactly `label` */
  byText: (label: string, selector?: string) => HTMLElement | null
  click: (target: Element | null) => void
  /** type into a controlled input, then blur it — the settle most fields write on */
  type: (target: Element | null, value: string, settle?: boolean) => void
  /** let queued promises resolve — for handlers that await an action before the next write */
  settle: () => Promise<void>
}

// React tracks a controlled input's last value on the node itself; assigning
// `.value` updates that tracker too, so the synthetic onChange never fires. The
// prototype setter is the documented way past it.
function setNativeValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  if (descriptor?.set === undefined) input.value = value
  else descriptor.set.call(input, value)
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Mutate an external store from a test: React flushes before the next assertion. */
export function run(fn: () => void): void {
  act(fn)
}

export function mount(node: ReactElement): Mounted {
  const container = document.createElement('div')
  container.className = 'eui-root'
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(node)
  })
  const all = (selector: string): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>(selector))
  return {
    container,
    root,
    render: (next) =>
      act(() => {
        root.render(next)
      }),
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
    text: () => collapse(container.textContent ?? ''),
    find: (selector) => container.querySelector<HTMLElement>(selector),
    all,
    byText: (label, selector = '*') => all(selector).find((el) => collapse(el.textContent ?? '') === label) ?? null,
    click: (target) => {
      if (target === null) throw new Error('click: target not found')
      act(() => {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
    },
    type: (target, value, settle = true) => {
      if (target === null) throw new Error('type: target not found')
      const input = target as HTMLInputElement
      act(() => {
        setNativeValue(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      if (!settle) return
      act(() => {
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      })
    },
    settle: async () => {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }
}
