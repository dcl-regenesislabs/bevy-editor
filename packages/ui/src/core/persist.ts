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

/** Read/write a flag outside React — for the module stores (chrome, ai-store),
 *  whose state has to be settable from plain functions. */
export function storedFlag(name: string, initial: boolean): boolean {
  const stored = storedValue(name)
  return stored === null ? initial : stored === '1'
}

export function setStoredFlag(name: string, value: boolean): void {
  localStorage.setItem(storageKey(name), value ? '1' : '0')
}

export function usePersistentFlag(name: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => storedFlag(name, initial))
  return [
    v,
    (next: boolean) => {
      setStoredFlag(name, next)
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
