import { describe, expect, it } from 'vitest'
import { ServerStore, claimStoreKey } from '../runtime-modules/pure/serverStore'
import {
  ProtectedLedger,
  isServerPeer,
  protectedLogLine
} from '../runtime-modules/pure/protectedFields'

interface RoundState {
  seed: number
  phase: string
  alive: string[]
  pinned: { hp: number } | null
}

const defaults = (): RoundState => ({ seed: 0, phase: 'lobby', alive: [], pinned: null })

describe('_runtime serverStore', () => {
  it('starts from a fresh defaults object per store', () => {
    const a = new ServerStore<RoundState>({ key: 'a', defaults })
    const b = new ServerStore<RoundState>({ key: 'b', defaults })
    a.get().alive.push('0xabc')
    expect(b.get().alive).toEqual([])
  })

  it('merges patches and ignores undefined fields', () => {
    const store = new ServerStore<RoundState>({ key: 'round', defaults })
    store.patch({ seed: 12 })
    store.patch({ phase: undefined })
    expect(store.get()).toEqual({ seed: 12, phase: 'lobby', alive: [], pinned: null })
  })

  it('tracks dirtiness by content, including direct mutation', () => {
    const store = new ServerStore<RoundState>({ key: 'round', defaults })
    expect(store.needsFlush()).toBe(true)
    store.markPersisted(store.snapshot().encoded)
    expect(store.needsFlush()).toBe(false)

    store.get().alive.push('0xabc')
    expect(store.needsFlush()).toBe(true)
  })

  it('stays dirty when a write did not persist', () => {
    const store = new ServerStore<RoundState>({ key: 'round', defaults })
    const first = store.snapshot()
    store.patch({ seed: 9 })
    store.markPersisted(first.encoded)
    expect(store.needsFlush()).toBe(true)
  })

  it('adopts a stored payload field by field', () => {
    const store = new ServerStore<RoundState>({ key: 'round', defaults })
    store.adopt({ seed: 7, phase: 'wave', alive: ['0x1'], pinned: { hp: 40 } })
    expect(store.get()).toEqual({ seed: 7, phase: 'wave', alive: ['0x1'], pinned: { hp: 40 } })
  })

  it('repairs a stored payload of the wrong shape', () => {
    const store = new ServerStore<RoundState>({ key: 'round', defaults })
    store.adopt({ seed: 'many', phase: 'wave', alive: { nope: true }, extra: 1 })
    expect(store.get()).toEqual({ seed: 0, phase: 'wave', alive: [], pinned: null })
  })

  it('drops non-finite numbers and missing fields', () => {
    const store = new ServerStore<RoundState>({ key: 'round', defaults })
    store.adopt({ seed: Number.NaN })
    expect(store.get()).toEqual(defaults())
  })

  it('ignores a payload that is not an object', () => {
    const store = new ServerStore<RoundState>({ key: 'round', defaults })
    store.patch({ seed: 3 })
    store.adopt(null)
    store.adopt('{}')
    store.adopt([1, 2])
    expect(store.get().seed).toBe(3)
  })

  it('claims keys once and rejects a collision', () => {
    const claimed = new Set<string>()
    claimStoreKey(claimed, 'round-loop')
    expect(() => claimStoreKey(claimed, 'round-loop')).toThrow(/already in use/)
    expect(() => claimStoreKey(claimed, '  ')).toThrow(/non-empty key/)
    claimStoreKey(claimed, 'wave-director')
    expect([...claimed]).toEqual(['round-loop', 'wave-director'])
  })
})

describe('_runtime protectedFields', () => {
  it('records what each entity protects', () => {
    const ledger = new ProtectedLedger()
    ledger.record(512, [1, 2])
    ledger.record(512, [2, 3])
    ledger.record(513, [1])
    expect(ledger.entries()).toEqual([
      { entity: 512, componentIds: [1, 2, 3] },
      { entity: 513, componentIds: [1] }
    ])
    expect(ledger.protects(512, 3)).toBe(true)
    expect(ledger.protects(513, 3)).toBe(false)
  })

  it('forgets a released entity', () => {
    const ledger = new ProtectedLedger()
    ledger.record(512, [1])
    ledger.forget(512)
    expect(ledger.entries()).toEqual([])
  })

  it('reports nothing late before the seal', () => {
    const ledger = new ProtectedLedger()
    expect(ledger.isSealed()).toBe(false)
    expect(ledger.record(512, [1, 2]).late).toEqual([])
  })

  it('flags only a component armed for the first time after the seal', () => {
    const ledger = new ProtectedLedger()
    ledger.record(512, [1])
    ledger.seal()
    expect(ledger.record(513, [1]).late).toEqual([])
    expect(ledger.record(514, [1, 7]).late).toEqual([7])
    expect(ledger.record(515, [7]).late).toEqual([])
  })

  it('matches the server peer regardless of case, never on an empty address', () => {
    expect(isServerPeer('0xABC', '0xabc')).toBe(true)
    expect(isServerPeer(' 0xabc ', '0xABC')).toBe(true)
    expect(isServerPeer('0xdead', '0xabc')).toBe(false)
    expect(isServerPeer('', '')).toBe(false)
    expect(isServerPeer('', '0xabc')).toBe(false)
  })

  it('emits a parseable log line', () => {
    const line = protectedLogLine('registered', { entity: 512, componentIds: [1, 2] })
    expect(line.startsWith('[SERVER] protected-sync ')).toBe(true)
    expect(JSON.parse(line.slice('[SERVER] protected-sync '.length))).toEqual({
      kind: 'registered',
      entity: 512,
      componentIds: [1, 2]
    })
  })
})
