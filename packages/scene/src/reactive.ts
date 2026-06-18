// The reactive core — dependency-free, React-free, SDK7-safe.
//
// Lives in `scene` (not `ui`) because `state.ts` imports it and is bundled into
// BOTH the React UI and the SDK7 scene (engine sandbox). It uses nothing beyond a
// bare `Proxy` — no browser globals, no React — so it runs in the engine's
// stripped-down V8 as well as the browser. (This is exactly why we don't depend
// on valtio: its `proxySet`/`proxyMap` crash the scene runtime.)
//
// The React read hook (`useStore`) lives in `packages/ui/src/store.ts` and
// subscribes to this same channel. In the engine bundle there are no subscribers,
// so writes here are inert — the engine syncs to the UI over the editor bus, not
// through this. See docs/STATE-ARCHITECTURE.md.

const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Wrap an object so any top-level set/delete notifies subscribers. Shallow by
// design: nested objects (the snapshot) are updated via immutable helpers in
// state.ts, so a shallow trap suffices — and it avoids a deep proxy's edge cases.
export function reactive<T extends object>(obj: T): T {
  return new Proxy(obj, {
    set(target, key, value, receiver) {
      const ok = Reflect.set(target, key, value, receiver)
      notify()
      return ok
    },
    deleteProperty(target, key) {
      const ok = Reflect.deleteProperty(target, key)
      notify()
      return ok
    }
  })
}
