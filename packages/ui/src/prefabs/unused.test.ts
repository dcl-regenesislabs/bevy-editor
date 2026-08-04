import { describe, expect, it } from 'vitest'
import { unusedBuiltinCopies } from './unused'
import { CUSTOM_ASSET_COMPONENT } from './format'
import type { PrefabData, PrefabOriginSource } from './format'
import type { PrefabEntry } from '../panels/prefab-store'

function entry(folder: string, id: string, source: PrefabOriginSource): PrefabEntry {
  const data: PrefabData = {
    id,
    name: folder,
    category: 'custom',
    tags: [],
    origin: { source }
  }
  return { folder, data, hasGuide: false }
}

/** A scene holding `count` instances of `assetId`, plus one plain entity. */
function scene(assetId: string, count: number): Record<string, Record<string, unknown>> {
  const snapshot: Record<string, Record<string, unknown>> = { plain: {} }
  for (let i = 0; i < count; i++) {
    snapshot[`e${i}`] = { [CUSTOM_ASSET_COMPONENT]: { assetId } }
  }
  return snapshot
}

describe('unusedBuiltinCopies', () => {
  it('offers a built-in copy whose last instance is gone', () => {
    const items = [entry('custom/server_clock', 'clock', 'builtin')]
    expect(unusedBuiltinCopies(items, scene('clock', 0)).map((i) => i.folder)).toEqual([
      'custom/server_clock'
    ])
  })

  it('keeps a built-in copy while the scene still instances it', () => {
    const items = [entry('custom/trigger_zone', 'zone', 'builtin')]
    expect(unusedBuiltinCopies(items, scene('zone', 2))).toEqual([])
  })

  it('never offers a prefab the editor cannot ship back', () => {
    const items = [
      entry('custom/mine', 'mine', 'user'),
      entry('custom/imported', 'imported', 'import'),
      entry('custom/from_gh', 'gh', 'github')
    ]
    expect(unusedBuiltinCopies(items, scene('nothing', 0))).toEqual([])
  })

  it('counts instances per prefab, not in total', () => {
    const items = [entry('custom/a', 'a', 'builtin'), entry('custom/b', 'b', 'builtin')]
    const snapshot = { ...scene('a', 1) }
    expect(unusedBuiltinCopies(items, snapshot).map((i) => i.folder)).toEqual(['custom/b'])
  })
})
