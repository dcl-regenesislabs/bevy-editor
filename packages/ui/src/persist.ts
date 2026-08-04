// Persisted UI choices — the dock's width and open flags, the left tab — all
// under one `eui:` key prefix. The string-union case takes the guard from its
// caller: a stored value that no longer names anything real — a renamed tab, a
// downgrade — must not be trusted.
import { useState } from 'react'

const storageKey = (name: string): string => `eui:${name}`

/** Whether this choice has ever been made — a first run has no stored value. */
export function storedValue(name: string): string | null {
  return localStorage.getItem(storageKey(name))
}

export function usePersistentFlag(name: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    const stored = storedValue(name)
    return stored === null ? initial : stored === '1'
  })
  return [
    v,
    (next: boolean) => {
      localStorage.setItem(storageKey(name), next ? '1' : '0')
      setV(next)
    }
  ]
}

export function usePersistentNum(name: string, initial: number): [number, (v: number) => void] {
  const [v, setV] = useState(() => {
    const n = Number(storedValue(name))
    return Number.isFinite(n) && n > 0 ? n : initial
  })
  return [
    v,
    (next: number) => {
      localStorage.setItem(storageKey(name), String(next))
      setV(next)
    }
  ]
}

export function usePersistentEnum<T extends string>(
  name: string,
  initial: T,
  valid: (v: string) => v is T
): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const stored = storedValue(name)
    return stored !== null && valid(stored) ? stored : initial
  })
  return [
    v,
    (next: T) => {
      localStorage.setItem(storageKey(name), next)
      setV(next)
    }
  ]
}
