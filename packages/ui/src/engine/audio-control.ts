// The engine-document half of the global mute. Runs inside the engine's own
// document (engine-host.ts) before the wasm boots, and leaves __editorAudio
// behind for the host page to call — see ./audio.ts for why muting happens here
// in the browser rather than as a write into the scene.
//
// Kept apart from ./audio.ts on purpose: this module ships in the engine.html
// bundle, which has no editor state and should not pull the store in behind it.

export interface EngineAudioWindow extends Window {
  // AudioContext is a global `var`, so it only sits on `Window & typeof
  // globalThis` — a plain Window doesn't carry it. Declared here because this
  // module is handed the ENGINE's window, not its own.
  AudioContext?: typeof AudioContext
  __editorAudio?: { setMuted: (muted: boolean) => void }
}

export function installEngineAudioControl(win: EngineAudioWindow): void {
  const contexts = new Set<AudioContext>()
  let muted = false

  // The context has to be captured at construction: there is no registry of live
  // AudioContexts to enumerate, and by the time the toolbar asks, the engine has
  // long since built its own. Proxying the constructor is the hook that needs no
  // engine change — and it must be installed before the wasm runs, or the context
  // it built is invisible to us.
  const Native = win.AudioContext
  if (Native !== undefined) {
    win.AudioContext = new Proxy(Native, {
      construct(target, args: ConstructorParameters<typeof AudioContext>) {
        const ctx = new target(...args)
        contexts.add(ctx)
        // a context built while muted (a stream started after the toggle) must
        // come up silent, not play until the next toggle
        if (muted) void ctx.suspend()
        return ctx
      }
    })
  }

  // Video textures and audio streams are <video>/<audio> elements, which the
  // AudioContext doesn't cover — and they appear as the scene runs, so the
  // observer keeps late ones in step instead of a one-shot pass.
  const applyToMedia = (root: ParentNode): void => {
    for (const el of root.querySelectorAll('audio, video')) {
      ;(el as HTMLMediaElement).muted = muted
    }
  }
  new MutationObserver((records) => {
    if (!muted) return
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n instanceof HTMLMediaElement) n.muted = true
        else if (n instanceof Element) applyToMedia(n)
      }
    }
  }).observe(win.document, { childList: true, subtree: true })

  win.__editorAudio = {
    setMuted: (next: boolean) => {
      muted = next
      // resume() wants a user gesture in some browsers; the toggle click is one
      for (const ctx of contexts) void (next ? ctx.suspend() : ctx.resume())
      applyToMedia(win.document)
    }
  }
}
