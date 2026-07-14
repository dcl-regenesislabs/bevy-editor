// Shared data-loading hooks for panels that fetch on mount and mutate-reload.
import { useEffect, useState } from 'react'

// tiny load-with-retry hook shared by the gatekeeper/storage panels
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; err: string | null; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setData(undefined)
    setErr(null)
    fn().then(
      (d) => live && setData(d),
      (e: unknown) => live && setErr(e instanceof Error ? e.message : String(e))
    )
    return () => {
      live = false
    }
  }, [...deps, tick])
  return { data, err, reload: () => setTick((t) => t + 1) }
}

// minimal page shape (structurally matches the worlds StoragePage<T>)
export interface PageInfo {
  items: unknown[]
  total: number
  offset: number
}

// deleting the last item of a trailing page leaves it empty — step back to the
// last page that still has content
export function usePageClamp(page: PageInfo | undefined, offset: number, setOffset: (o: number) => void, pageSize = 50): void {
  useEffect(() => {
    if (page !== undefined && page.items.length === 0 && page.total > 0 && offset > 0) {
      setOffset(Math.max(0, Math.floor((page.total - 1) / pageSize) * pageSize))
    }
  }, [page])
}
