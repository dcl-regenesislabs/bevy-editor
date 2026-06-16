// The scene logic mutates a shared mutable `state` object (../../scene/src/state).
// React subscribes through a version counter: actions and bus events call
// `bump()`, and a low-frequency safety tick catches async mutations done deep
// inside the logic layer (reloads, settles, etc.).
import { useSyncExternalStore } from 'react'

let version = 0
const subscribers = new Set<() => void>()

export function bump(): void {
  version++
  for (const fn of subscribers) fn()
}

export function useInspectorVersion(): number {
  return useSyncExternalStore(
    (onChange) => {
      subscribers.add(onChange)
      return () => subscribers.delete(onChange)
    },
    () => version
  )
}

// safety net for mutations that happen outside action wrappers
setInterval(bump, 500)
