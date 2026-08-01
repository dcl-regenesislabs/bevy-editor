import { Storage } from '@dcl/sdk/server'
import { normalizeVersioned, type Versioned } from './pure/normalize'

// Server-only write-behind store over Storage.player: per-wallet state lives
// in memory, is repaired on read (normalize-on-read), and is flushed at
// checkpoints — round end, player leave, periodic save — never per tick
// (storage writes are capped; excess writes fail).
//
// Storage.set resolves false when a write did not persist: failed keys STAY
// dirty so the next flush retries them.

export interface PlayerStoreOptions<T extends Versioned> {
  /** Storage key, unique per store — two stores (or two prefab copies) must not share one. */
  key: string
  schemaVersion: number
  defaults: () => T
  /** Field-by-field repair of a current-version value; unknown versions fall back to defaults. */
  repair: (value: Partial<T>, defaults: T) => T
}

export class PlayerStore<T extends Versioned> {
  private cache = new Map<string, T>()
  private dirty = new Set<string>()

  constructor(private options: PlayerStoreOptions<T>) {}

  /** Load (or return cached) state for a player. Server-only. */
  async load(address: string): Promise<T> {
    const key = address.toLowerCase()
    const cached = this.cache.get(key)
    if (cached) return cached
    const raw = await Storage.player.get<unknown>(key, this.options.key)
    const value = normalizeVersioned(raw, this.options.schemaVersion, this.options.defaults, this.options.repair)
    this.cache.set(key, value)
    if (raw === null) this.dirty.add(key) // first save writes the canonical shape
    return value
  }

  /** In-memory state, if loaded. */
  get(address: string): T | null {
    return this.cache.get(address.toLowerCase()) ?? null
  }

  /** Mutate in memory and mark dirty. Persistence happens at the next flush. */
  mutate(address: string, mutator: (value: T) => void): boolean {
    const key = address.toLowerCase()
    const value = this.cache.get(key)
    if (!value) return false
    mutator(value)
    this.dirty.add(key)
    return true
  }

  /** Flush one player. Returns whether the write persisted; failures stay dirty. */
  async save(address: string): Promise<boolean> {
    const key = address.toLowerCase()
    const value = this.cache.get(key)
    if (!value) return true
    const ok = await Storage.player.set(key, this.options.key, value)
    if (ok) this.dirty.delete(key)
    return ok
  }

  /** Flush every dirty player. Returns the addresses that failed (and stay dirty). */
  async saveDirty(): Promise<string[]> {
    const failed: string[] = []
    for (const key of [...this.dirty]) {
      if (!(await this.save(key))) failed.push(key)
    }
    return failed
  }

  /** Checkpoint for player-leave: flush, then drop from memory (only if persisted). */
  async saveAndEvict(address: string): Promise<boolean> {
    const key = address.toLowerCase()
    const ok = await this.save(key)
    if (ok) this.cache.delete(key)
    return ok
  }

  get dirtyCount(): number {
    return this.dirty.size
  }
}

export function createPlayerStore<T extends Versioned>(options: PlayerStoreOptions<T>): PlayerStore<T> {
  return new PlayerStore(options)
}
