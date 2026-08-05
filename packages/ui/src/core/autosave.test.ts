import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Stop and Play both flush before they act, so the flush must await writes that
// are already in flight — not just the debounce timer. Losing that is how a move
// made <1.2s before Stop used to disappear.

const write = vi.fn<() => Promise<void>>(() => Promise.resolve())

vi.mock('@scene/state', () => ({ state: { frozen: true, playEditWarn: false } }))
vi.mock('@scene/reactive', () => ({ notify: () => {} }))
vi.mock('@scene/inspector', () => ({
  saveCompositeDirect: () => write(),
  setCompositeWriter: () => {},
  isLocalScene: () => true
}))
vi.mock('../engine/datalayer', () => ({
  dataLayerSaveFile: async () => {},
  probeDataLayer: async () => true,
  dataLayerAvailable: () => true
}))

const compositeWritten = vi.fn()
const sceneStale = vi.fn()
vi.mock('../features/editor/scene-health', () => ({
  noteCompositeWritten: () => compositeWritten(),
  noteSceneStale: () => sceneStale()
}))
// The derived-script passes run off the same save; they have their own suites,
// and a real one here would read a project that does not exist.
const spawnables = vi.fn<
  () => Promise<{ written: boolean; vendored: string[]; blocked: boolean; problems: string[] }>
>(async () => ({ written: false, vendored: [], blocked: false, problems: [] }))
const gameConfig = vi.fn<() => Promise<{ written: boolean }>>(async () => ({ written: false }))
vi.mock('../prefabs/generate', () => ({ regenerateSpawnables: () => spawnables() }))
vi.mock('../gameconfig/generate', () => ({ regenerateGameConfig: () => gameConfig() }))

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
    compositeWritten.mockReset()
    sceneStale.mockReset()
    spawnables.mockReset()
    gameConfig.mockReset()
    write.mockImplementation(() => Promise.resolve())
    spawnables.mockImplementation(async () => ({ written: false, vendored: [], blocked: false, problems: [] }))
    gameConfig.mockImplementation(async () => ({ written: false }))
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

  // Play waits for the rebuild before it reloads, and learns the composite is
  // unbuilt from here. A save the debounce fired on its own reports pending:false
  // — the signal Play used to rely on — so this report is the only thing that
  // still sees it.
  it('reports a write the debounce fired on its own, with nothing left to flush', async () => {
    markDirty()
    vi.advanceTimersByTime(DEBOUNCE_MS)
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))

    expect(compositeWritten).toHaveBeenCalledTimes(1)
    await expect(flushPendingSave()).resolves.toEqual({ pending: false, ok: true })
  })

  it('does not report a write that failed', async () => {
    write.mockImplementationOnce(() => Promise.reject(new Error('disk full')))
    markDirty()
    await flushPendingSave()
    expect(compositeWritten).not.toHaveBeenCalled()
  })

  // src/scripts/game-config.ts and spawnables.ts are written FROM the save, and
  // Play starts as soon as the flush resolves. Letting them run past it is how a
  // round could start on the numbers the creator had just replaced.
  it('does not settle the flush until the derived scripts are written', async () => {
    const d = deferred()
    gameConfig.mockImplementationOnce(async () => {
      await d.promise
      return { written: true }
    })

    markDirty()
    let settled = false
    const flush = flushPendingSave().then((r) => {
      settled = true
      return r
    })
    await vi.waitFor(() => expect(gameConfig).toHaveBeenCalledTimes(1))
    expect(settled).toBe(false)

    d.resolve()
    await expect(flush).resolves.toEqual({ pending: true, ok: true })
    expect(spawnables).toHaveBeenCalledTimes(1)
  })

  // A written derived script is SOURCE the running bundle predates. Without this
  // Play sees no reason to reload and resumes the old instance.
  it('marks the scene stale when a derived script was actually written', async () => {
    gameConfig.mockImplementationOnce(async () => ({ written: true }))
    markDirty()
    await flushPendingSave()
    expect(sceneStale).toHaveBeenCalledTimes(1)
  })

  it('marks the scene stale when the registry vendored a runtime module', async () => {
    spawnables.mockImplementationOnce(async () => ({
      written: false,
      vendored: ['src/scripts/runtime/spawner.ts'],
      blocked: false,
      problems: []
    }))
    markDirty()
    await flushPendingSave()
    expect(sceneStale).toHaveBeenCalledTimes(1)
  })

  it('leaves the scene alone when both passes wrote nothing', async () => {
    markDirty()
    await flushPendingSave()
    expect(sceneStale).not.toHaveBeenCalled()
  })

  // A generation failure must never fail the save that already landed on disk.
  it('reports ok even when a derived pass throws', async () => {
    gameConfig.mockImplementationOnce(() => Promise.reject(new Error('no data layer')))
    spawnables.mockImplementationOnce(() => Promise.reject(new Error('no data layer')))
    markDirty()
    await expect(flushPendingSave()).resolves.toEqual({ pending: true, ok: true })
    expect(sceneStale).not.toHaveBeenCalled()
  })

  it('clearDirty drops a pending timer without writing', async () => {
    markDirty()
    clearDirty()
    expect(hasPendingSave()).toBe(false)
    await expect(flushPendingSave()).resolves.toEqual({ pending: false, ok: true })
    expect(write).not.toHaveBeenCalled()
  })
})
