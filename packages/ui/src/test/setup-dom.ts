// Setup for the ui-dom vitest project (packages/ui/vitest.dom.config.ts).
//
// happy-dom supplies document/window; this adds the two things React and the
// editor's own globals expect and happy-dom does not: the act() environment flag
// and a matchMedia stub (the theme reader calls it during the first render).
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
