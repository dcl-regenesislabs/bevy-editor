import { beforeEach, describe, expect, it, vi } from 'vitest'
import { autoExpandPrimary } from './auto-expand'

// The reveal is once per card per SESSION, not per call: the inspector effect
// re-runs on every snapshot change, so without the guard a creator could never
// keep the card collapsed while the entity stays selected. And it must be
// snapshot-driven, not selection-driven: a freshly instantiated prefab is
// selected before its components arrive over the bus, so the first call sees an
// empty entity and the reveal has to happen on the call after the script lands.

const { state, expandedKeys, expandCalls } = vi.hoisted(() => ({
  state: { snapshot: {} as Record<string, Record<string, unknown>> },
  expandedKeys: new Set<string>(),
  expandCalls: [] as string[]
}))

vi.mock('@scene/state', () => ({
  state,
  componentKey: (id: string, name: string) => `${id}/${name}`,
  setComponentExpanded: (key: string, expanded: boolean) => {
    expandCalls.push(key)
    if (expanded) expandedKeys.add(key)
    else expandedKeys.delete(key)
  }
}))
vi.mock('@scene/allowed-components', () => ({ SCRIPT_COMPONENT: 'asset-packs::Script' }))
vi.mock('./views/admin-tools', () => ({ ADMIN_TOOLS_COMPONENT: 'asset-packs::AdminTools' }))

let nextId = 0
function entity(comps: Record<string, unknown>): string {
  const id = `e${nextId++}`
  state.snapshot[id] = comps
  return id
}

beforeEach(() => {
  state.snapshot = {}
  expandedKeys.clear()
  expandCalls.length = 0
})

describe('autoExpandPrimary', () => {
  it('opens the Script card of a scripted entity', () => {
    const id = entity({ Transform: {}, 'asset-packs::Script': {} })
    autoExpandPrimary(id)
    expect(expandedKeys.has(`${id}/asset-packs::Script`)).toBe(true)
  })

  it('reveals once, then respects a later collapse', () => {
    const id = entity({ 'asset-packs::Script': {} })
    autoExpandPrimary(id)
    expandedKeys.clear()
    autoExpandPrimary(id)
    expect(expandCalls).toHaveLength(1)
    expect(expandedKeys.size).toBe(0)
  })

  it('prefers AdminTools over a paramless companion script', () => {
    const id = entity({ 'asset-packs::AdminTools': {}, 'asset-packs::Script': {} })
    autoExpandPrimary(id)
    expect(expandedKeys.has(`${id}/asset-packs::AdminTools`)).toBe(true)
    expect(expandedKeys.has(`${id}/asset-packs::Script`)).toBe(false)
  })

  it('does nothing for an entity with no behavior card', () => {
    const id = entity({ Transform: {}, GltfContainer: {} })
    autoExpandPrimary(id)
    expect(expandCalls).toHaveLength(0)
  })

  it('waits for the snapshot to land, then reveals', () => {
    const id = `e${nextId++}`
    autoExpandPrimary(id)
    expect(expandCalls).toHaveLength(0)
    state.snapshot[id] = { 'asset-packs::Script': {} }
    autoExpandPrimary(id)
    expect(expandedKeys.has(`${id}/asset-packs::Script`)).toBe(true)
  })
})
