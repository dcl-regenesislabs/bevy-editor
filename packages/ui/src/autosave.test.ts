import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Stop and Play both flush before they act, so the flush must await writes that
// are already in flight — not just the debounce timer. Losing that is how a move
// made <1.2s before Stop used to disappear.

const write = vi.fn<() => Promise<void>>(() => Promise.resolve())

vi.mock('../../scene/src/state', () => ({ state: { frozen: true, playEditWarn: false } }))
vi.mock('../../scene/src/reactive', () => ({ notify: () => {} }))
vi.mock('../../scene/src/inspector', () => ({
  saveCompositeDirect: () => write(),
  setCompositeWriter: () => {},
  isLocalScene: () => true
}))
vi.mock('./datalayer', () => ({
  dataLayerSaveFile: async () => {},
  probeDataLayer: async () => true,
  dataLayerAvailable: () => true
}))

import { markDirty, flushPendingSave, clearDirty, hasPendingSave } from './autosave'

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve = (): void => {}
  let reject = (_e: Error): void => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = (e) => rej(e)
  })
  return { promise, resolve, reject }
}

const DEBOUNCE_MS = 1200

describe('autosave flush contract', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    write.mockReset()
    write.mockImplementation(() => Promise.resolve())
    clearDirty()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports nothing to do when idle, and writes nothing', async () => {
    expect(hasPendingSave()).toBe(false)
    await expect(flushPendingSave()).resolves.toEqual({ pending: false, ok: true })
    expect(write).not.toHaveBeenCalled()
  })

  it('writes a debounced edit that has not fired yet', async () => {
    markDirty()
    expect(hasPendingSave()).toBe(true)
    const res = await flushPendingSave()
    expect(res).toEqual({ pending: true, ok: true })
    expect(write).toHaveBeenCalledTimes(1)
    expect(hasPendingSave()).toBe(false)
  })

  it('awaits a write that is already in flight', async () => {
    const d = deferred()
    write.mockImplementationOnce(() => d.promise)

    markDirty()
    vi.advanceTimersByTime(DEBOUNCE_MS)
    await Promise.resolve()
    expect(write).toHaveBeenCalledTimes(1)
    expect(hasPendingSave()).toBe(true)

    let settled = false
    const flush = flushPendingSave().then((r) => {
      settled = true
      return r
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    d.resolve()
    await expect(flush).resolves.toEqual({ pending: true, ok: true })
  })

  it('reports ok:false when the write fails, and stays usable afterwards', async () => {
    write.mockImplementationOnce(() => Promise.reject(new Error('disk full')))
    markDirty()
    await expect(flushPendingSave()).resolves.toEqual({ pending: true, ok: false })

    markDirty()
    await expect(flushPendingSave()).resolves.toEqual({ pending: true, ok: true })
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('serializes writes rather than overlapping them', async () => {
    const first = deferred()
    let overlapped = false
    let settledFirst = false
    write.mockImplementationOnce(() => first.promise)
    write.mockImplementationOnce(() => {
      overlapped = !settledFirst
      return Promise.resolve()
    })

    markDirty()
    vi.advanceTimersByTime(DEBOUNCE_MS)
    await Promise.resolve()

    markDirty()
    const flush = flushPendingSave()
    await Promise.resolve()

    settledFirst = true
    first.resolve()
    await flush
    expect(overlapped).toBe(false)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('clearDirty drops a pending timer without writing', async () => {
    markDirty()
    clearDirty()
    expect(hasPendingSave()).toBe(false)
    await expect(flushPendingSave()).resolves.toEqual({ pending: false, ok: true })
    expect(write).not.toHaveBeenCalled()
  })
})
