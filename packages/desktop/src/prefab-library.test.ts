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

  it('never offers a hidden builtin, while a user prefab carrying the flag still shows', () => {
    const { dirs } = fixture()
    writePrefab(path.join(dirs.builtin, 'shelved'), { id: 's', name: 'Shelved', hidden: true })
    writePrefab(path.join(dirs.builtin, 'admin'), { id: 'a', name: 'Admin' })
    writePrefab(path.join(dirs.user, 'mine'), { id: 'm', name: 'Mine', hidden: true })

    expect(listLibrary(dirs).map((e) => e.ref)).toEqual(['builtin:admin', 'user:mine'])
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

  it('honours a pinned slug, so renaming the card cannot move the folder scripts import', () => {
    const { dirs, project } = fixture()
    writePrefab(path.join(dirs.builtin, 'area'), { id: 'z', name: 'Trigger Area', slug: 'trigger_zone' })

    const res = copyIntoProject(dirs, 'builtin:area', project)
    expect(res?.folder).toBe('custom/trigger_zone')
    expect(res?.name).toBe('Trigger Area')
  })

  // A master's scripts name the runtime through `~runtime/`, because the folder is
  // written once and placed at whatever slug is free. Nothing in a creator's
  // project maps that alias, so it has to become a real relative path on the way
  // in — one that reaches the project's single src/scripts/runtime/.
  function writeAliasPrefab(dirs: LibraryDirs, name: string, id: string): void {
    const dir = path.join(dirs.builtin, 'board')
    writePrefab(dir, { id, name })
    fs.mkdirSync(path.join(dir, 'scripts/pure'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'scripts/leaderboard.ts'),
      "import { game } from '~runtime/game'\nimport { rows } from './pure/board'\nexport const board = game\n"
    )
    fs.writeFileSync(
      path.join(dir, 'scripts/pure/board.ts'),
      "import { rng } from '~runtime/pure/rng'\nexport const rows = rng\n"
    )
  }

  it('resolves ~runtime into a path to the project’s shared copy', () => {
    const { dirs, project } = fixture()
    writeAliasPrefab(dirs, 'Leaderboard', 'b')

    copyIntoProject(dirs, 'builtin:board', project)

    const placed = fs.readFileSync(
      path.join(project, 'custom/leaderboard/scripts/leaderboard.ts'),
      'utf8'
    )
    expect(placed).toContain("from '../../../src/scripts/runtime/game'")
    expect(placed).not.toContain('~runtime/')
    // computed from where the file actually sits, not assumed: one level deeper
    // is one climb more
    expect(
      fs.readFileSync(path.join(project, 'custom/leaderboard/scripts/pure/board.ts'), 'utf8')
    ).toContain("from '../../../../src/scripts/runtime/pure/rng'")
  })

  it('gives a colliding slug the same climb, because the depth is the folder’s not the name’s', () => {
    const { dirs, project } = fixture()
    writeAliasPrefab(dirs, 'Leaderboard', 'b')
    fs.mkdirSync(path.join(project, 'custom/leaderboard'), { recursive: true })

    const res = copyIntoProject(dirs, 'builtin:board', project)

    expect(res?.folder).toBe('custom/leaderboard_2')
    expect(
      fs.readFileSync(path.join(project, 'custom/leaderboard_2/scripts/leaderboard.ts'), 'utf8')
    ).toContain("from '../../../src/scripts/runtime/game'")
  })

  // The manifest is written by the renderer AFTER this call, over the files as they
  // sit in the project (packages/ui/src/prefabs/hashes.ts, called from
  // prefabs/library.ts). Invert that ordering and every placed prefab hashes as
  // creator-edited, so its next update either refuses or clobbers.
  it('leaves the master untouched, so the manifest records the placed form', () => {
    const { dirs, project } = fixture()
    writeAliasPrefab(dirs, 'Leaderboard', 'b')

    copyIntoProject(dirs, 'builtin:board', project)

    const master = fs.readFileSync(path.join(dirs.builtin, 'board/scripts/leaderboard.ts'), 'utf8')
    const placed = fs.readFileSync(
      path.join(project, 'custom/leaderboard/scripts/leaderboard.ts'),
      'utf8'
    )
    expect(master).toContain("'~runtime/game'")
    expect(placed).not.toBe(master)
  })

  it('keeps the alias in the library, where the folder has no depth yet', () => {
    const { dirs, project } = fixture()
    writePrefab(path.join(project, 'custom/board'), { id: 'b', name: 'Leaderboard' })
    fs.mkdirSync(path.join(project, 'custom/board/scripts'), { recursive: true })
    fs.writeFileSync(
      path.join(project, 'custom/board/scripts/leaderboard.ts'),
      "import { game } from '~runtime/game'\n"
    )

    const entry = copyOutToLibrary(dirs, project, 'custom/board')

    const name = entry.ref.slice('user:'.length)
    expect(fs.readFileSync(path.join(dirs.user, name, 'scripts/leaderboard.ts'), 'utf8')).toContain(
      "'~runtime/game'"
    )
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

  // A master that DROPS a file and rewrites what that file imported is the shape
  // the Leaderboard shipped: board-api.ts deleted, pure/board.ts rewritten. Carry
  // the orphan forward and the creator's scene stops building on ~16 "has no
  // exported member" errors inside code they never wrote — nothing in the app
  // says which file to delete, and Play refuses until they find it.
  function placeWithManifest(
    dirs: LibraryDirs,
    project: string,
    files: Record<string, string>
  ): string {
    writePrefab(path.join(dirs.builtin, 'board'), { id: 'b', name: 'Leaderboard', version: '1.0.0' })
    for (const [rel, text] of Object.entries(files)) {
      const at = path.join(dirs.builtin, 'board', rel)
      fs.mkdirSync(path.dirname(at), { recursive: true })
      fs.writeFileSync(at, text)
    }
    copyIntoProject(dirs, 'builtin:board', project)
    const copyDir = path.join(project, 'custom/leaderboard')
    // what the renderer writes after a copy lands (packages/ui/src/prefabs/hashes.ts):
    // the manifest is the record of which files were the master's
    const manifest: Record<string, string> = { 'data.json': 'h', 'composite.json': 'h' }
    for (const rel of Object.keys(files)) manifest[rel] = 'h'
    fs.writeFileSync(path.join(copyDir, '.origin-hashes.json'), JSON.stringify(manifest))
    return copyDir
  }

  it('removes a file the new master dropped, instead of orphaning it next to its rewrite', () => {
    const { dirs, project } = fixture()
    const copyDir = placeWithManifest(dirs, project, {
      'scripts/board-api.ts': "import { beats } from './pure/board'\nexport const submit = beats\n",
      'scripts/pure/board.ts': 'export function beats(): boolean { return true }\n'
    })

    // the update: board-api.ts gone from the master, pure/board.ts rewritten
    // without the symbols it imported
    fs.rmSync(path.join(dirs.builtin, 'board/scripts/board-api.ts'))
    fs.writeFileSync(
      path.join(dirs.builtin, 'board/scripts/pure/board.ts'),
      'export function boardRows(): string[] { return [] }\n'
    )

    expect(overwriteProjectCopy(dirs, 'builtin:board', project)).toBe('custom/leaderboard')
    expect(fs.existsSync(path.join(copyDir, 'scripts/board-api.ts'))).toBe(false)
    expect(fs.readFileSync(path.join(copyDir, 'scripts/pure/board.ts'), 'utf8')).toContain('boardRows')
  })

  it('still carries forward what the creator added, which the manifest never listed', () => {
    const { dirs, project } = fixture()
    const copyDir = placeWithManifest(dirs, project, {
      'scripts/board-api.ts': 'export const submit = 1\n'
    })
    fs.writeFileSync(path.join(copyDir, 'scripts/my-scoring.ts'), 'export const mine = 1\n')
    fs.writeFileSync(path.join(copyDir, 'notes.md'), 'mine')
    fs.rmSync(path.join(dirs.builtin, 'board/scripts/board-api.ts'))

    overwriteProjectCopy(dirs, 'builtin:board', project)

    expect(fs.readFileSync(path.join(copyDir, 'scripts/my-scoring.ts'), 'utf8')).toBe('export const mine = 1\n')
    expect(fs.readFileSync(path.join(copyDir, 'notes.md'), 'utf8')).toBe('mine')
    expect(fs.existsSync(path.join(copyDir, 'scripts/board-api.ts'))).toBe(false)
  })

  // A copy placed before version tracking has nothing proving whose file it is.
  // An orphan is a mistake a creator can undo; a deleted file of theirs is not.
  it('carries everything forward when no manifest says which files were the master', () => {
    const { dirs, project } = fixture()
    const copyDir = placeWithManifest(dirs, project, { 'scripts/board-api.ts': 'export const submit = 1\n' })
    fs.rmSync(path.join(copyDir, '.origin-hashes.json'))
    fs.rmSync(path.join(dirs.builtin, 'board/scripts/board-api.ts'))

    overwriteProjectCopy(dirs, 'builtin:board', project)

    expect(fs.existsSync(path.join(copyDir, 'scripts/board-api.ts'))).toBe(true)
  })

  it('drops a carried runtime module the master no longer ships, manifest or not', () => {
    const { dirs, project } = fixture()
    const copyDir = placeWithManifest(dirs, project, { 'scripts/runtime/rpc.ts': 'export const rpc = 1\n' })
    fs.rmSync(path.join(copyDir, '.origin-hashes.json'))
    fs.rmSync(path.join(dirs.builtin, 'board/scripts/runtime/rpc.ts'))

    overwriteProjectCopy(dirs, 'builtin:board', project)

    expect(fs.existsSync(path.join(copyDir, 'scripts/runtime/rpc.ts'))).toBe(false)
  })

  // The migration off carried runtime copies, which is the whole point of keeping
  // the unconditional drop above: the folder loses its own runtime/ and gains
  // scripts pointing at the project's shared copy in ONE staged swap. Land them
  // apart and the scene spends the gap importing files that are not there.
  it('drops the carried runtime and repoints the script in the same swap', () => {
    const { dirs, project } = fixture()
    const copyDir = placeWithManifest(dirs, project, {
      'scripts/leaderboard.ts': "import { game } from './runtime/game'\nexport const board = game\n",
      'scripts/runtime/game.ts': 'export const game = 1\n'
    })

    // the new master: no carried runtime, the alias in its place
    fs.rmSync(path.join(dirs.builtin, 'board/scripts/runtime'), { recursive: true })
    fs.writeFileSync(
      path.join(dirs.builtin, 'board/scripts/leaderboard.ts'),
      "import { game } from '~runtime/game'\nexport const board = game\n"
    )

    expect(overwriteProjectCopy(dirs, 'builtin:board', project)).toBe('custom/leaderboard')
    expect(fs.existsSync(path.join(copyDir, 'scripts/runtime/game.ts'))).toBe(false)
    expect(fs.readFileSync(path.join(copyDir, 'scripts/leaderboard.ts'), 'utf8')).toContain(
      "from '../../../src/scripts/runtime/game'"
    )
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
