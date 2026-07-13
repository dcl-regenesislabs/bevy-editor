// Style registry for the shadow root. The app's UI renders inside a shadow
// root, so stylesheets cannot be <link>ed — every component/feature registers
// its co-located CSS chunk (imported with Vite's ?inline) and the entry
// injects collectCss() once. Layers keep the cascade deterministic; within a
// layer, registration (import) order wins.
export type Layer = 'tokens' | 'base' | 'primitives' | 'features' | 'app'

const ORDER: Record<Layer, number> = { tokens: 0, base: 1, primitives: 2, features: 3, app: 4 }
const chunks = new Map<string, { layer: Layer; css: string; seq: number }>()
let seq = 0

// idempotent (HMR-safe): re-registering an id replaces its css, keeps its slot
export function registerCss(id: string, layer: Layer, css: string): void {
  chunks.set(id, { layer, css, seq: chunks.get(id)?.seq ?? seq++ })
}

export function collectCss(): string {
  return [...chunks.values()]
    .sort((a, b) => ORDER[a.layer] - ORDER[b.layer] || a.seq - b.seq)
    .map((c) => c.css)
    .join('')
}
