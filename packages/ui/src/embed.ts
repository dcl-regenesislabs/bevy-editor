// Embedded-engine bridge. Runs INSIDE the engine page when it is iframed by
// the host editor app (`?embed=true`): the host renders all editor chrome and
// reaches the engine directly through the same-origin contentWindow, so the
// only thing the engine page must do is forward viewport input — the host's
// DOM listeners (tap-to-pick, gizmo release, fly-speed wheel, undo keys) can't
// see events that target the iframe.
const FORWARDED_KEYS = new Set(['z', 'Z', 'y', 'Y'])

type ForwardedEvent =
  | { kind: 'pointer'; type: 'pointerdown' | 'pointerup'; button: number; clientX: number; clientY: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }
  | { kind: 'wheel'; deltaY: number; clientX: number; clientY: number }
  | { kind: 'key'; type: 'keydown' | 'keyup'; key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }

export type EmbedMessage = { editorEmbed: true; event: ForwardedEvent }

function post(event: ForwardedEvent): void {
  window.parent.postMessage({ editorEmbed: true, event } satisfies EmbedMessage, '*')
}

export function startEmbedBridge(): void {
  console.log('[editor-ui] embed bridge active (engine side)')
  for (const type of ['pointerdown', 'pointerup'] as const) {
    window.addEventListener(
      type,
      (e: PointerEvent) => {
        post({
          kind: 'pointer',
          type,
          button: e.button,
          clientX: e.clientX,
          clientY: e.clientY,
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey
        })
      },
      { capture: true }
    )
  }
  window.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      post({ kind: 'wheel', deltaY: e.deltaY, clientX: e.clientX, clientY: e.clientY })
    },
    { capture: true, passive: true }
  )
  for (const type of ['keydown', 'keyup'] as const) {
    window.addEventListener(
      type,
      (e: KeyboardEvent) => {
        // editor shortcuts only (undo/redo) — game keys stay in the engine
        if (!FORWARDED_KEYS.has(e.key)) return
        if (!e.metaKey && !e.ctrlKey) return
        post({
          kind: 'key',
          type,
          key: e.key,
          code: e.code,
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey
        })
      },
      { capture: true }
    )
  }
}

// Host side: re-dispatch forwarded events on this window so the editor's
// normal DOM listeners (boot.ts, history keys) fire exactly as in-page.
export function listenForEmbeddedEvents(): void {
  window.addEventListener('message', (msg: MessageEvent) => {
    const data = msg.data as EmbedMessage | undefined
    if (data === undefined || data.editorEmbed !== true) return
    const ev = data.event
    if (ev.kind === 'pointer') {
      window.dispatchEvent(
        new PointerEvent(ev.type, {
          button: ev.button,
          clientX: ev.clientX,
          clientY: ev.clientY,
          shiftKey: ev.shiftKey,
          ctrlKey: ev.ctrlKey,
          metaKey: ev.metaKey,
          altKey: ev.altKey
        })
      )
    } else if (ev.kind === 'wheel') {
      window.dispatchEvent(
        new WheelEvent('wheel', { deltaY: ev.deltaY, clientX: ev.clientX, clientY: ev.clientY })
      )
    } else {
      window.dispatchEvent(
        new KeyboardEvent(ev.type, {
          key: ev.key,
          code: ev.code,
          shiftKey: ev.shiftKey,
          ctrlKey: ev.ctrlKey,
          metaKey: ev.metaKey,
          altKey: ev.altKey
        })
      )
    }
  })
}
