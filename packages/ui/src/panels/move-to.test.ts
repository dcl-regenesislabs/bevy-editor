import { describe, expect, it } from 'vitest'
import { flatten, folderTree, levelOf, searchFolders, trailTo } from './move-to'
import { FOLDER_COMPONENT } from '../prefabs/format'
import { NAME_COMPONENT } from '@scene/custom-components'
import type { Snapshot } from '@scene/state'

const folder = (name: string, parent = 0): Record<string, unknown> => ({
  Transform: { parent },
  [NAME_COMPONENT]: { value: name },
  [FOLDER_COMPONENT]: {}
})
const thing = (name: string, parent = 0): Record<string, unknown> => ({
  Transform: { parent },
  [NAME_COMPONENT]: { value: name }
})

// Props (512) under Set (513) under Level (514); Attic (517) is a second root,
// so there is always somewhere outside the subtree to move to. Loose (515) sits
// at the root, Crate (516) inside Props.
const scene = (): Snapshot =>
  ({
    '514': folder('Level'),
    '513': folder('Set', 514),
    '512': folder('Props', 513),
    '517': folder('Attic'),
    '515': thing('Loose'),
    '516': thing('Crate', 512)
  }) as unknown as Snapshot

const names = (ns: { name: string }[]): string[] => ns.map((n) => n.name)

describe('folderTree', () => {
  it('lists only folders, nested, sorted by name', () => {
    const roots = folderTree(scene(), ['515'])
    expect(names(roots)).toEqual(['Attic', 'Level'])
    // by name, not by index: the roots are sorted, so positions move whenever a
    // folder is added to the fixture
    const level = roots.find((n) => n.name === 'Level') as (typeof roots)[number]
    expect(names(level.children)).toEqual(['Set'])
    expect(names(level.children[0].children)).toEqual(['Props'])
    // 'Crate' is an entity, not a folder — it must never be a destination
    expect(names(flatten(roots))).not.toContain('Crate')
  })

  it('names an unnamed folder rather than showing a blank row', () => {
    const s = { '512': { Transform: { parent: 0 }, [FOLDER_COMPONENT]: {} } } as unknown as Snapshot
    expect(folderTree(s, [])[0].name).toBe('Folder')
  })

  // The cycle guard: a folder taking its own subtree as a parent detaches it
  // from the scene entirely, because the new parent travels with it.
  it('blocks the moved folder itself and everything inside it', () => {
    const byId = new Map(flatten(folderTree(scene(), ['513'])).map((n) => [n.name, n]))
    expect(byId.get('Set')?.enabled).toBe(false)
    expect(byId.get('Set')?.blockedReason).toMatch(/itself/)
    expect(byId.get('Props')?.enabled).toBe(false)
    expect(byId.get('Props')?.blockedReason).toMatch(/inside/)
    // Its own parent is refused for the other reason — moving Set into Level is
    // where it already is — while a folder outside the subtree is fine.
    expect(byId.get('Level')?.blockedReason).toBe('Already here')
    expect(byId.get('Attic')?.enabled).toBe(true)
  })

  // The subtree rule must not swallow ancestors above the current parent: Level
  // contains Props, but moving Props there is a real move, not a cycle.
  it('allows a grandparent, which is neither inside nor already the parent', () => {
    const byId = new Map(flatten(folderTree(scene(), ['512'])).map((n) => [n.name, n]))
    expect(byId.get('Level')?.enabled).toBe(true)
    expect(byId.get('Set')?.blockedReason).toBe('Already here')
    expect(byId.get('Props')?.blockedReason).toMatch(/itself/)
  })

  it('blocks the folder the selection is already in', () => {
    const byId = new Map(flatten(folderTree(scene(), ['516'])).map((n) => [n.name, n]))
    expect(byId.get('Props')?.enabled).toBe(false)
    expect(byId.get('Props')?.blockedReason).toBe('Already here')
    expect(byId.get('Set')?.enabled).toBe(true)
  })

  it('blocks nothing for a mixed selection — it has somewhere to go', () => {
    // '516' is in Props, '515' is at the root: no single "already here"
    const byId = new Map(flatten(folderTree(scene(), ['515', '516'])).map((n) => [n.name, n]))
    expect(byId.get('Props')?.enabled).toBe(true)
  })

  it('survives a parent cycle in a malformed snapshot', () => {
    const s = {
      '512': { Transform: { parent: 513 }, [FOLDER_COMPONENT]: {} },
      '513': { Transform: { parent: 512 }, [FOLDER_COMPONENT]: {} }
    } as unknown as Snapshot
    expect(() => folderTree(s, ['512'])).not.toThrow()
  })
})

describe('browsing and search', () => {
  it('shows one level at a time', () => {
    const roots = folderTree(scene(), [])
    expect(names(levelOf(roots, null))).toEqual(['Attic', 'Level'])
    expect(names(levelOf(roots, '514'))).toEqual(['Set'])
    expect(levelOf(roots, '512')).toEqual([])
  })

  it('searches every level, not just the one being browsed', () => {
    const roots = folderTree(scene(), [])
    expect(names(searchFolders(roots, 'props'))).toEqual(['Props'])
    expect(searchFolders(roots, '')).toEqual([])
    expect(searchFolders(roots, 'zzz')).toEqual([])
  })

  it('builds a breadcrumb from the root to the open folder', () => {
    const roots = folderTree(scene(), [])
    expect(names(trailTo(roots, '512'))).toEqual(['Level', 'Set', 'Props'])
    expect(trailTo(roots, null)).toEqual([])
  })
})
