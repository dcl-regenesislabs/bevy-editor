import { describe, expect, it } from 'vitest'
import { originDetail, originLabel, originTip, prefabAssetId } from './provenance'
import type { PrefabOrigin } from './format'

describe('prefabAssetId', () => {
  it('reads the assetId off inspector::CustomAsset', () => {
    expect(prefabAssetId({ 'inspector::CustomAsset': { assetId: 'abc' } })).toBe('abc')
  })

  it('is null without the component, with a blank id, or on a missing entity', () => {
    expect(prefabAssetId({ Transform: {} })).toBeNull()
    expect(prefabAssetId({ 'inspector::CustomAsset': { assetId: '' } })).toBeNull()
    expect(prefabAssetId({ 'inspector::CustomAsset': { assetId: 7 } })).toBeNull()
    expect(prefabAssetId(undefined)).toBeNull()
  })
})

const github: PrefabOrigin = { source: 'github', url: 'https://github.com/a/b', commit: '0123456789' }

describe('provenance', () => {
  it('labels every origin, defaulting to the user', () => {
    expect(originLabel(undefined)).toBe('Made here')
    expect(originLabel({ source: 'user' })).toBe('Made here')
    expect(originLabel({ source: 'builtin' })).toBe('Built in')
    expect(originLabel({ source: 'import' })).toBe('Imported')
    expect(originLabel({ source: 'github' })).toBe('GitHub')
  })

  it('names the source in the tip when there is one', () => {
    expect(originTip({ source: 'import', url: 'shared/door.zip' })).toContain('shared/door.zip')
    expect(originTip(github)).toBe('From https://github.com/a/b @ 0123456')
    expect(originTip({ source: 'import' })).toBe('Imported into this project')
  })
})

describe('originDetail', () => {
  it('names the repo and the pinned commit', () => {
    expect(originDetail(github)).toBe('a/b @0123456')
    expect(originDetail({ source: 'github' })).toBe('GitHub')
  })

  it('names the file or folder an import arrived in', () => {
    expect(originDetail({ source: 'import', url: '/Users/me/shared/door.zip' })).toBe('from door.zip')
    expect(originDetail({ source: 'import', url: 'C:\\stuff\\door' })).toBe('from door')
    expect(originDetail({ source: 'import' })).toBe('imported')
  })

  it('names the scene a user prefab was made in', () => {
    expect(originDetail({ source: 'user', project: 'My Plaza' })).toBe('made in My Plaza')
    expect(originDetail({ source: 'user' })).toBeNull()
  })

  it('says nothing for prefabs that were made here or ship with the editor', () => {
    expect(originDetail(undefined)).toBeNull()
    expect(originDetail({ source: 'user' })).toBeNull()
    expect(originDetail({ source: 'builtin' })).toBeNull()
  })
})
