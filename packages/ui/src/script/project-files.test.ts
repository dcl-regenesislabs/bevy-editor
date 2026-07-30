import { describe, it, expect } from 'vitest'
import {
  buildTree,
  filterTree,
  allDirPaths,
  isEditable,
  isViewable,
  fileKind,
  looksBinary,
  mimeFor,
  isHidden,
  dirName,
  baseName,
  rankQuickOpen
} from './project-files'

const names = (nodes: ReturnType<typeof buildTree>): string[] => nodes.map((n) => n.name)

describe('path helpers', () => {
  it('opens TypeScript only', () => {
    expect(isEditable('src/index.ts')).toBe(true)
    expect(isEditable('src/ui.tsx')).toBe(true)
    expect(isEditable('scene.json')).toBe(false)
    expect(isEditable('assets/scene/Tree.glb')).toBe(false)
  })

  it('splits at the last separator', () => {
    expect(dirName('src/scripts/Door.ts')).toBe('src/scripts')
    expect(dirName('scene.json')).toBe('')
    expect(baseName('src/scripts/Door.ts')).toBe('Door.ts')
  })

  it('hides tooling directories at any depth', () => {
    expect(isHidden('.claude/settings.local.json')).toBe(true)
    expect(isHidden('.github/workflows/ci.yml')).toBe(true)
    expect(isHidden('vendor/asset-packs-stub/package.json')).toBe(true)
    expect(isHidden('src/.agents/x.ts')).toBe(true)
    expect(isHidden('src/index.ts')).toBe(false)
  })
})

describe('file kinds', () => {
  it('classifies by extension, case-insensitively', () => {
    expect(fileKind('src/index.ts')).toBe('code')
    expect(fileKind('README.md')).toBe('text')
    expect(fileKind('scene.json')).toBe('text')
    expect(fileKind('assets/Tree.PNG')).toBe('image')
    expect(fileKind('assets/Tree.glb')).toBe('model')
    expect(fileKind('game.wasm')).toBe('binary')
    expect(fileKind('audio/theme.mp3')).toBe('binary')
  })

  it('falls back to text for unknown and extensionless files', () => {
    expect(fileKind('app.config')).toBe('text')
    expect(fileKind('Dockerfile')).toBe('text')
    expect(fileKind('config.toml')).toBe('text')
    expect(fileKind('package-lock.json')).toBe('text')
    expect(fileKind('LICENSE')).toBe('text')
  })

  it('opens code and previews text/images, but not models or binaries', () => {
    expect(isViewable('src/index.ts')).toBe(true)
    expect(isViewable('README.md')).toBe(true)
    expect(isViewable('logo.png')).toBe(true)
    expect(isViewable('app.config')).toBe(true)
    expect(isViewable('Tree.glb')).toBe(false)
    expect(isViewable('game.wasm')).toBe(false)
  })

  it('detects binary content the extension lied about', () => {
    const text = new TextEncoder().encode('# hello\nplain text\n')
    expect(looksBinary(text)).toBe(false)
    expect(looksBinary(new Uint8Array([0x68, 0x69, 0x00, 0x01]))).toBe(true)
    expect(looksBinary(new Uint8Array())).toBe(false)
  })

  it('only code is editable — previews are read-only', () => {
    expect(isEditable('src/index.ts')).toBe(true)
    expect(isEditable('README.md')).toBe(false)
    expect(isEditable('scene.json')).toBe(false)
  })

  it('maps image mime types, including the two irregular ones', () => {
    expect(mimeFor('a.png')).toBe('image/png')
    expect(mimeFor('a.jpg')).toBe('image/jpeg')
    expect(mimeFor('a.jpeg')).toBe('image/jpeg')
    expect(mimeFor('a.svg')).toBe('image/svg+xml')
  })

  it('marks tree nodes with their kind', () => {
    const tree = buildTree(['docs/README.md', 'docs/logo.png', 'docs/Tree.glb'])
    const kinds = Object.fromEntries(tree[0].children.map((n) => [n.name, n.kind]))
    expect(kinds).toEqual({ 'README.md': 'text', 'logo.png': 'image', 'Tree.glb': 'model' })
    expect(tree[0].children.filter((n) => n.viewable).map((n) => n.name).sort()).toEqual(['README.md', 'logo.png'])
  })
})

describe('buildTree', () => {
  it('nests folders instead of flattening them', () => {
    const tree = buildTree(['src/scripts/Door.ts', 'src/index.ts'])
    expect(names(tree)).toEqual(['src'])
    const src = tree[0]
    expect(src.dir).toBe(true)
    expect(names(src.children)).toEqual(['scripts', 'index.ts'])
    expect(names(src.children[0].children)).toEqual(['Door.ts'])
  })

  it('puts src first, then folders, then files', () => {
    const tree = buildTree(['scene.json', 'assets/a.glb', 'src/index.ts', 'package.json'])
    expect(names(tree)).toEqual(['src', 'assets', 'package.json', 'scene.json'])
  })

  it('drops hidden and ignored paths', () => {
    const tree = buildTree(['src/index.ts', '.claude/x.json', '.github/workflows/ci.yml', 'vendor/y.js'])
    expect(names(tree)).toEqual(['src'])
  })

  it('keeps deep folders separate rather than one long label', () => {
    const tree = buildTree(['assets/asset-packs/ambient/sound.glb'])
    expect(names(tree)).toEqual(['assets'])
    expect(names(tree[0].children)).toEqual(['asset-packs'])
    expect(names(tree[0].children[0].children)).toEqual(['ambient'])
  })
})

describe('filterTree', () => {
  const tree = buildTree(['src/index.ts', 'src/scripts/Door.ts', 'scene.json'])

  it('keeps branches that contain a hit', () => {
    const hit = filterTree(tree, 'door')
    expect(names(hit)).toEqual(['src'])
    expect(names(hit[0].children)).toEqual(['scripts'])
    expect(names(hit[0].children[0].children)).toEqual(['Door.ts'])
  })

  it('matches folder names too', () => {
    expect(names(filterTree(tree, 'scripts')[0].children)).toEqual(['scripts'])
  })

  it('returns the tree unchanged for an empty query', () => {
    expect(filterTree(tree, '  ')).toEqual(tree)
  })

  it('lists every folder so a search can expand them', () => {
    expect(allDirPaths(tree).sort()).toEqual(['src', 'src/scripts'])
  })
})

describe('rankQuickOpen', () => {
  const files = ['src/index.ts', 'src/scripts/spin.ts', 'assets/index-map.json', 'package.json']

  it('puts filename prefix matches first', () => {
    expect(rankQuickOpen(files, 'index')[0]).toBe('src/index.ts')
  })

  it('falls back to path substring matches', () => {
    expect(rankQuickOpen(files, 'scripts')).toContain('src/scripts/spin.ts')
  })

  it('matches scattered subsequences last', () => {
    const ranked = rankQuickOpen(files, 'sspin')
    expect(ranked).toEqual(['src/scripts/spin.ts'])
  })

  it('drops non-matches', () => {
    expect(rankQuickOpen(files, 'zzz')).toEqual([])
  })

  it('returns everything for an empty query', () => {
    expect(rankQuickOpen(files, '  ')).toHaveLength(files.length)
  })
})
