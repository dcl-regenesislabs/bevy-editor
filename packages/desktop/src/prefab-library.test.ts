import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  copyIntoProject,
  copyOutToLibrary,
  deleteLibraryPrefab,
  listLibrary,
  overwriteProjectCopy,
  parseGithubPrefabUrl,
  parseRef,
  prefabSlug,
  type LibraryDirs
} from './prefab-library'

describe('parseGithubPrefabUrl', () => {
  it('reads a bare repo URL', () => {
    expect(parseGithubPrefabUrl('https://github.com/decentraland/prefabs')).toEqual({
      owner: 'decentraland',
      repo: 'prefabs',
      ref: 'HEAD',
      subpath: ''
    })
  })

  it('reads a subfolder link and keeps the ref', () => {
    expect(parseGithubPrefabUrl('https://github.com/acme/kit/tree/v2/prefabs/door')).toEqual({
      owner: 'acme',
      repo: 'kit',
      ref: 'v2',
      subpath: 'prefabs/door'
    })
  })

  it('strips .git and accepts blob links', () => {
    expect(parseGithubPrefabUrl('https://github.com/acme/kit.git')?.repo).toBe('kit')
    expect(parseGithubPrefabUrl('https://github.com/acme/kit/blob/main/door')?.subpath).toBe('door')
  })

  it('rejects anything that is not an https github.com repo', () => {
    expect(parseGithubPrefabUrl('https://gitlab.com/acme/kit')).toBeNull()
    expect(parseGithubPrefabUrl('http://github.com/acme/kit')).toBeNull()
    expect(parseGithubPrefabUrl('https://github.com/acme')).toBeNull()
    expect(parseGithubPrefabUrl('https://github.com/acme/kit/issues/1')).toBeNull()
    expect(parseGithubPrefabUrl('not a url')).toBeNull()
  })
})

describe('parseRef', () => {
  it('splits scope from folder', () => {
    expect(parseRef('user:door')).toEqual({ scope: 'user', name: 'door' })
    expect(parseRef('builtin:admin_tools')).toEqual({ scope: 'builtin', name: 'admin_tools' })
  })

  it('refuses traversal and unknown scopes', () => {
    expect(parseRef('user:../../etc')).toBeNull()
    expect(parseRef('user:.')).toBeNull()
    expect(parseRef('project:door')).toBeNull()
    expect(parseRef('door')).toBeNull()
  })
})

describe('prefabSlug', () => {
  it('matches the ui package slug shape', () => {
    expect(prefabSlug('Front Door')).toBe('front_door')
    expect(prefabSlug('  ¡Hola! ')).toBe('hola')
    expect(prefabSlug('***')).toBe('prefab')
  })
})

const temps: string[] = []

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefab-lib-test-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function writePrefab(dir: string, data: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(data))
  fs.writeFileSync(
    path.join(dir, 'composite.json'),
    JSON.stringify({ version: 1, components: [{ name: 'core::Transform', data: { '0': { json: {} } } }] })
  )
}

function fixture(): { dirs: LibraryDirs; project: string } {
  const root = tmp()
  const dirs: LibraryDirs = { user: path.join(root, 'user'), builtin: path.join(root, 'builtin') }
  const project = path.join(root, 'scene')
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, 'scene.json'), '{}')
  return { dirs, project }
}

describe('listLibrary', () => {
  it('merges builtin and user entries and skips folders that are not prefabs', () => {
    const { dirs } = fixture()
    writePrefab(path.join(dirs.builtin, 'admin'), { id: 'a', name: 'Admin', origin: { source: 'builtin' } })
    writePrefab(path.join(dirs.user, 'door'), { id: 'd', name: 'Door' })
    fs.mkdirSync(path.join(dirs.user, 'not-a-prefab'), { recursive: true })

    const entries = listLibrary(dirs)
    expect(entries.map((e) => e.ref)).toEqual(['builtin:admin', 'user:door'])
    expect(JSON.parse(entries[1].data).name).toBe('Door')
  })

  it('is empty rather than throwing when neither tree exists', () => {
    expect(listLibrary({ user: '/nope/user', builtin: '/nope/builtin' })).toEqual([])
  })

  it('sends thumbnails along as data URLs, skipping oversized ones', () => {
    const { dirs } = fixture()
    writePrefab(path.join(dirs.user, 'door'), { id: 'd', name: 'Door' })
    writePrefab(path.join(dirs.user, 'huge'), { id: 'h', name: 'Huge' })
    fs.writeFileSync(path.join(dirs.user, 'door', 'thumbnail.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    fs.writeFileSync(path.join(dirs.user, 'huge', 'thumbnail.png'), Buffer.alloc(400 * 1024))

    const entries = listLibrary(dirs)
    const door = entries.find((e) => e.ref === 'user:door')
    const huge = entries.find((e) => e.ref === 'user:huge')
    expect(door?.thumbnail?.startsWith('data:image/png;base64,')).toBe(true)
    expect(huge?.thumbnail).toBeUndefined()
  })
})

describe('copyIntoProject', () => {
  it('copies the folder under custom/ and slugs the name', () => {
    const { dirs, project } = fixture()
    writePrefab(path.join(dirs.builtin, 'admin'), { id: 'a', name: 'Admin Tools' })

    const res = copyIntoProject(dirs, 'builtin:admin', project)
    expect(res).toEqual({ folder: 'custom/admin_tools', name: 'Admin Tools', reused: false })
    expect(fs.existsSync(path.join(project, 'custom/admin_tools/composite.json'))).toBe(true)
  })

  it('reuses the copy the project already has instead of duplicating it', () => {
    const { dirs, project } = fixture()
    writePrefab(path.join(dirs.user, 'door'), { id: 'shared', name: 'Door' })
    copyIntoProject(dirs, 'user:door', project)

    expect(copyIntoProject(dirs, 'user:door', project)).toEqual({
      folder: 'custom/door',
      name: 'Door',
      reused: true
    })
    expect(fs.readdirSync(path.join(project, 'custom'))).toEqual(['door'])
  })

  it('refuses an unknown ref or a folder that is not a scene', () => {
    const { dirs, project } = fixture()
    expect(copyIntoProject(dirs, 'user:ghost', project)).toBeNull()
    writePrefab(path.join(dirs.user, 'door'), { id: 'd', name: 'Door' })
    expect(copyIntoProject(dirs, 'user:door', path.join(project, 'elsewhere'))).toBeNull()
  })
})

describe('overwriteProjectCopy', () => {
  it('rewrites the existing copy in place, keeping the folder and local extras', () => {
    const { dirs, project } = fixture()
    writePrefab(path.join(dirs.builtin, 'clock'), { id: 'c', name: 'Clock', version: '2.0.0' })
    copyIntoProject(dirs, 'builtin:clock', project)
    const copyDir = path.join(project, 'custom/clock')
    fs.writeFileSync(path.join(copyDir, 'data.json'), JSON.stringify({ id: 'c', name: 'Clock', version: '1.0.0' }))
    fs.writeFileSync(path.join(copyDir, 'local-notes.txt'), 'mine')

    expect(overwriteProjectCopy(dirs, 'builtin:clock', project)).toBe('custom/clock')
    const data = JSON.parse(fs.readFileSync(path.join(copyDir, 'data.json'), 'utf8'))
    expect(data.version).toBe('2.0.0')
    expect(fs.readFileSync(path.join(copyDir, 'local-notes.txt'), 'utf8')).toBe('mine')
  })

  it('returns null when the project has no copy or the ref is unknown', () => {
    const { dirs, project } = fixture()
    writePrefab(path.join(dirs.builtin, 'clock'), { id: 'c', name: 'Clock' })
    expect(overwriteProjectCopy(dirs, 'builtin:clock', project)).toBeNull()
    expect(overwriteProjectCopy(dirs, 'builtin:ghost', project)).toBeNull()
  })
})

describe('copyOutToLibrary', () => {
  it('stamps origin user and dedupes the library folder', () => {
    const { dirs, project } = fixture()
    writePrefab(path.join(project, 'custom/door'), { id: 'd', name: 'Door' })
    fs.mkdirSync(dirs.user, { recursive: true })
    fs.mkdirSync(path.join(dirs.user, 'door'))

    const entry = copyOutToLibrary(dirs, project, 'custom/door')
    expect(entry.ref).toBe('user:door_2')
    expect(JSON.parse(entry.data).origin).toEqual({ source: 'user' })
  })

  it('keeps the creating scene on a user origin', () => {
    const { dirs, project } = fixture()
    const origin = { source: 'user', project: 'My Plaza' }
    writePrefab(path.join(project, 'custom/door'), { id: 'd', name: 'Door', origin })

    expect(JSON.parse(copyOutToLibrary(dirs, project, 'custom/door').data).origin).toEqual(origin)
  })

  it('keeps an imported provenance instead of claiming authorship', () => {
    const { dirs, project } = fixture()
    const origin = { source: 'github', url: 'https://github.com/acme/kit', commit: 'abc123' }
    writePrefab(path.join(project, 'custom/door'), { id: 'd', name: 'Door', origin })

    expect(JSON.parse(copyOutToLibrary(dirs, project, 'custom/door').data).origin).toEqual(origin)
  })

  it('refuses a folder outside custom/', () => {
    const { dirs, project } = fixture()
    expect(() => copyOutToLibrary(dirs, project, 'src/scripts')).toThrow()
    expect(() => copyOutToLibrary(dirs, project, 'custom/../scene.json')).toThrow()
  })
})

describe('deleteLibraryPrefab', () => {
  it('removes a user entry and never a builtin one', () => {
    const { dirs } = fixture()
    writePrefab(path.join(dirs.user, 'door'), { id: 'd', name: 'Door' })
    writePrefab(path.join(dirs.builtin, 'admin'), { id: 'a', name: 'Admin' })

    expect(deleteLibraryPrefab(dirs, 'user:door')).toBe(true)
    expect(fs.existsSync(path.join(dirs.user, 'door'))).toBe(false)
    expect(deleteLibraryPrefab(dirs, 'builtin:admin')).toBe(false)
    expect(fs.existsSync(path.join(dirs.builtin, 'admin'))).toBe(true)
  })
})
