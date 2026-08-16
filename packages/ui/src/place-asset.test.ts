import { describe, it, expect } from 'vitest'
import {
  resolveAsset,
  componentsFor,
  entitySpec,
  isProblem,
  defaultName,
  type AssetSources,
  type ResolvedAsset
} from './place-asset'
import type { ModelAsset } from './assets'

const asset = (id: string, name: string): ModelAsset => ({
  id,
  name,
  filename: `${id}.glb`,
  url: `https://models.example/${id}.glb`,
  collection: 'pack',
  category: 'nature',
  tags: []
})

const SOURCES: AssetSources = {
  projectFiles: ['models/tree.glb', 'sounds/Ambient.mp3', 'README.md'],
  catalog: [asset('a1', 'Pine Tree'), asset('a2', 'Oak Tree')]
}

const resolved = (query: string, sources: AssetSources = SOURCES): ResolvedAsset => {
  const r = resolveAsset(query, sources)
  if (isProblem(r)) throw new Error(`expected a placeable asset, got: ${r.problem}`)
  return r
}

describe('resolving what was named', () => {
  it('takes a project model by path, case-insensitively', () => {
    expect(resolved('MODELS/Tree.glb')).toEqual({
      kind: 'model',
      name: 'tree',
      ref: 'models/tree.glb',
      catalog: null
    })
  })

  it('takes a project sound by path', () => {
    expect(resolved('sounds/Ambient.mp3')).toEqual({
      kind: 'audio-file',
      name: 'Ambient',
      ref: 'sounds/Ambient.mp3'
    })
  })

  it('reads a catalog asset by id and by name, leaving the ref for the download', () => {
    expect(resolved('a1')).toEqual({
      kind: 'model',
      name: 'Pine Tree',
      ref: '',
      catalog: SOURCES.catalog[0]
    })
    expect(resolved('pine tree')).toEqual(resolved('a1'))
  })

  it('prefers an exact name over a case-insensitive one', () => {
    const catalog = [asset('a1', 'Rock'), asset('a2', 'ROCK'), asset('a3', 'rock')]
    expect(resolved('ROCK', { ...SOURCES, catalog })).toMatchObject({ catalog: catalog[1] })
  })

  it('treats an http audio link as a stream', () => {
    expect(resolved('https://stream.example/live')).toEqual({
      kind: 'audio-url',
      name: 'Audio Stream',
      ref: 'https://stream.example/live'
    })
  })

  it('places nothing for an empty query — that is the grouping entity', () => {
    expect(resolved('')).toEqual({ kind: 'empty', name: 'Entity' })
    expect(resolveAsset(undefined, SOURCES)).toEqual({ kind: 'empty', name: 'Entity' })
  })

  // Every refusal names what to do instead: a placement that guesses puts the
  // wrong model in the scene 30 times over.
  it('refuses rather than guesses when only the casing tells two assets apart', () => {
    const catalog = [asset('a1', 'Rock'), asset('a2', 'rock')]
    expect(resolveAsset('ROCK', { ...SOURCES, catalog })).toEqual({
      problem: '"ROCK" matches 2 assets — name one exactly, or use its id'
    })
    // …but naming one of them exactly is not ambiguous at all
    expect(resolveAsset('rock', { ...SOURCES, catalog })).toMatchObject({ catalog: catalog[1] })
  })

  it('refuses when the catalog ships the same name twice', () => {
    const catalog = [asset('a1', 'Rock'), asset('a2', 'Rock')]
    expect(resolveAsset('Rock', { ...SOURCES, catalog })).toEqual({
      problem: '"Rock" matches 2 assets — name one exactly, or use its id'
    })
  })

  it('refuses a project file that is neither a model nor a sound', () => {
    expect(resolveAsset('README.md', SOURCES)).toEqual({
      problem: '"README.md" is not a model or an audio file, so it can\'t be placed'
    })
  })

  it('refuses a model URL, since a model has to come through the catalog', () => {
    expect(resolveAsset('https://cdn.example/tree.glb', SOURCES)).toEqual({
      problem: '"https://cdn.example/tree.glb" is a model URL — models come from the catalog, not a link'
    })
  })

  it('says the file is missing for a path, and the name is unknown for a name', () => {
    expect(resolveAsset('models/missing.glb', SOURCES)).toEqual({
      problem: 'there is no "models/missing.glb" in this project'
    })
    expect(resolveAsset('Palm Tree', SOURCES)).toEqual({
      problem: 'there is no asset called "Palm Tree"'
    })
  })
})

describe('text, which is placeable without being a file', () => {
  it('answers to the words a creator would use', () => {
    for (const word of ['text', 'Sign', 'LABEL']) {
      expect(resolved(word)).toEqual({ kind: 'text', name: 'Text' })
    }
  })

  it('wins over a project file that happens to be called text.glb', () => {
    const sources = { ...SOURCES, projectFiles: ['text.glb'] }
    expect(resolved('text', sources)).toEqual({ kind: 'text', name: 'Text' })
    // …the file is still placeable by its path
    expect(resolved('text.glb', sources)).toMatchObject({ kind: 'model', ref: 'text.glb' })
  })

  it('writes what it says and how big, leaving every other field to the engine', () => {
    expect(componentsFor(resolved('sign'), { text: 'Welcome', fontSize: 5 })).toEqual({
      TextShape: { text: 'Welcome', fontSize: 5 }
    })
    expect(componentsFor(resolved('sign'))).toEqual({ TextShape: { text: 'Text', fontSize: 3 } })
  })

  // "Text" in the hierarchy tells the creator nothing; what it says does.
  it('is named after what it says', () => {
    expect(defaultName(resolved('sign'), { text: '  Welcome  home \n friends now ' })).toBe(
      'Welcome home friends now'
    )
    expect(defaultName(resolved('sign'), { text: '' })).toBe('Text')
    expect(defaultName(resolved('sign'))).toBe('Text')
    expect(defaultName(resolved('sign'), { text: 'x'.repeat(60) })).toHaveLength(41)
  })

  it('leaves every other kind named after the asset', () => {
    expect(defaultName(resolved('models/tree.glb'), { text: 'ignored' })).toBe('tree')
  })
})

describe('the components each kind carries', () => {
  it('gives a model its GltfContainer, with visible meshes as colliders', () => {
    expect(componentsFor(resolved('models/tree.glb'))).toEqual({
      GltfContainer: { src: 'models/tree.glb', visibleMeshesCollisionMask: 3 }
    })
  })

  it('gives a project sound an AudioSource that plays on load', () => {
    expect(componentsFor(resolved('sounds/Ambient.mp3'))).toEqual({
      AudioSource: { audioClipUrl: 'sounds/Ambient.mp3', playing: true, loop: false, volume: 1 }
    })
  })

  it('takes the settings a placement asked for', () => {
    expect(
      componentsFor(resolved('sounds/Ambient.mp3'), { loop: true, volume: 0.6, playing: false })
    ).toEqual({
      AudioSource: { audioClipUrl: 'sounds/Ambient.mp3', playing: false, loop: true, volume: 0.6 }
    })
  })

  it('gives a link an AudioStream, since a URL is a stream and not a clip', () => {
    expect(componentsFor(resolved('https://stream.example/live'), { volume: 0.5 })).toEqual({
      AudioStream: { url: 'https://stream.example/live', playing: true, volume: 0.5 }
    })
  })

  it('gives a grouping entity nothing beyond its transform and name', () => {
    expect(componentsFor(resolved(''))).toEqual({})
  })

  it('uses the project path the download landed on, not the empty catalog ref', () => {
    const downloaded = { ...resolved('Pine Tree'), ref: 'models/a1.glb' }
    expect(componentsFor(downloaded)).toEqual({
      GltfContainer: { src: 'models/a1.glb', visibleMeshesCollisionMask: 3 }
    })
  })
})

describe('the entity spec', () => {
  const NAME = 'core-schema::Name'

  it('defaults to the origin, unrotated, unscaled, at the scene root', () => {
    const spec = entitySpec(resolved(''), {}, 'Forest', NAME)
    expect(spec).toEqual({
      Transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        parent: 0
      },
      [NAME]: { value: 'Forest' }
    })
  })

  it('turns euler degrees into the quaternion the component stores', () => {
    const spec = entitySpec(resolved(''), { rotation: { x: 0, y: 90, z: 0 } }, 'Turned', NAME)
    const { rotation } = spec.Transform as { rotation: { x: number; y: number; z: number; w: number } }
    expect(rotation.y).toBeCloseTo(Math.SQRT1_2, 6)
    expect(rotation.w).toBeCloseTo(Math.SQRT1_2, 6)
    expect(rotation.x).toBeCloseTo(0, 6)
    expect(rotation.z).toBeCloseTo(0, 6)
  })

  it('carries the placement, the components and the name together', () => {
    const spec = entitySpec(
      resolved('models/tree.glb'),
      { position: { x: 8, y: 0, z: 10 }, scale: { x: 2, y: 2, z: 2 }, parent: 512 },
      'Oak by the gate',
      NAME
    )
    expect(spec).toMatchObject({
      Transform: { position: { x: 8, y: 0, z: 10 }, scale: { x: 2, y: 2, z: 2 }, parent: 512 },
      GltfContainer: { src: 'models/tree.glb' },
      [NAME]: { value: 'Oak by the gate' }
    })
  })
})
