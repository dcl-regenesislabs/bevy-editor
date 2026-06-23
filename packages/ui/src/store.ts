// React binding for the editor's reactive store. The reactive core (the Proxy +
// subscribe channel) lives in `packages/scene/src/reactive.ts` because `state` is
// shared with the SDK7 scene bundle, which must stay React-free. This file adds
// the React read hook. See docs/STATE-ARCHITECTURE.md for the full model.
//
//   write:  `state.x = y`                       → auto-notifies (no bump, no tick)
//   read:   `const x = useStore(() => state.x)`  → re-renders ONLY when x changes
import { useSyncExternalStore } from 'react'
import { subscribe } from '../../scene/src/reactive'

export { reactive } from '../../scene/src/reactive'

// Subscribe a component to a slice of state. It re-renders only when the
// selector's return value changes (Object.is). The selector MUST return a stable
// value — a raw slice or primitive, never a freshly-built object/array (compute
// derived values in render, after the hook). Read several slices with several
// useStore calls.
export function useStore<T>(selector: () => T): T {
  return useSyncExternalStore(subscribe, selector)
}
