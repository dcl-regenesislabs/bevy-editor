// Setup for the ui-dom vitest project (packages/ui/vitest.dom.config.ts).
//
// happy-dom supplies document/window; this adds the things React and the editor's
// own globals expect and happy-dom does not: the act() environment flag, a
// matchMedia stub (the theme reader calls it during the first render), and a
// localStorage stub.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// core/persist reads localStorage at MODULE scope (core/chrome builds its store
// from a stored flag), so any suite that transitively imports it — anything
// pulling in ai-store — dies during collection, before a single test runs, with
// "localStorage.getItem is not a function". happy-dom exposes the name but not a
// working Storage here, so a plain Map-backed one stands in. Per-file, because
// each test file gets a fresh module registry: no state leaks between suites.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  const store = new Map<string, string>()
  const storage: Storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, String(v))
    },
    removeItem: (k) => {
      store.delete(k)
    },
    clear: () => {
      store.clear()
    },
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    }
  }
  // Both, when they are different objects: persist.ts reads the bare global, and
  // component code reaches it through window.
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage })
  if (window !== (globalThis as unknown as Window)) {
    Object.defineProperty(window, 'localStorage', { configurable: true, writable: true, value: storage })
  }
}

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  })
}

export {}
