import { describe, expect, it } from 'vitest'
import { clampMax, DEFAULT_MAX, keptPlacement, MAX_MAX, MIN_MAX } from './spawnable-draft'
import type { PrefabData, PrefabSpawnable } from './format'

const data = (over: Partial<PrefabData> = {}): PrefabData => ({
  id: 'a1',
  name: 'Zombie',
  category: 'custom',
  tags: [],
  ...over
})

const pool: PrefabSpawnable = { max: 8, instancing: 'onDemand' }

describe('clampMax', () => {
  it('keeps a number inside the pool range', () => {
    expect(clampMax(0)).toBe(MIN_MAX)
    expect(clampMax(5000)).toBe(MAX_MAX)
    expect(clampMax(12.6)).toBe(13)
  })

  // JSON.stringify(NaN) is null, and a null max is a pool with no cap at all
  it('never lets a cleared field through', () => {
    expect(clampMax(NaN)).toBe(DEFAULT_MAX)
    expect(clampMax(NaN, 32)).toBe(32)
    expect(clampMax(Infinity, 32)).toBe(32)
  })
})

describe('keptPlacement', () => {
  it('keeps a scriptless prefab for editing only', () => {
    expect(keptPlacement(data(), pool, true, [])).toBe('editingOnly')
  })

  it('keeps anything with a server half in the game', () => {
    expect(keptPlacement(data(), pool, true, ['if (isServer()) return'])).toBe('editorAndPlay')
    expect(keptPlacement(data({ requiresSdk: 'auth-server' }), pool, true, [])).toBe('editorAndPlay')
  })

  // guessing "editing only" before the scripts are read would ghost a copy the
  // Multiplayer Server needs, and nothing would say so
  it('takes the safe side while the project is unread', () => {
    expect(keptPlacement(data(), pool, false, [])).toBe('editorAndPlay')
  })

  it('never answers unplaced — the caller already decided to keep it', () => {
    const big: PrefabSpawnable = { max: 64, instancing: 'onDemand' }
    expect(keptPlacement(data(), big, true, [])).toBe('editorAndPlay')
  })
})
