// Studio removes one named scene. It never empties a world.
//
// The worlds content server exposes DELETE /entities/{world}: a single request
// that undeploys EVERY scene in a world at once. There is no undo, and most of
// what it takes down belongs to project folders this machine may not even have
// — a collaborator's work vanishes with no way to bring it back. The only
// removal this app performs is the scene-scoped
// DELETE /world/{name}/scenes/{coordinate} in features/worlds/undeploy.ts.
//
// Prose does not fail a build (the ds-contract lesson), and this failure mode is
// worse than drift: the forbidden request SUCCEEDS. Nothing errors, nothing
// warns — the world is just empty afterwards. The endpoint is also one template
// literal away from every module that already knows the worlds server, so the
// scan covers the whole repo rather than one package.
//
// It lives next to the removal it guards, not in ds/: this is a worlds rule, and
// the one place a reviewer touching removal will look.
//
// Scans source TEXT (node env, no rendering), scoped like ds-contract.test.ts:
// walk a root, skip dependencies and build output. Executable text only —
// whole-line comments are blanked first, because a ban has to be explainable and
// every explanation names the endpoint. The flip side: a TRAILING comment may
// not mention it; put the sentence on its own line. This file is excluded from
// its own scan, since it has to spell the violations out to test for them.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..', '..', '..', '..', '..')

// Dependencies, build output, vendored skill docs, gitignored scratch and the
// nested worktree checkout — none of it is this repo's source.
const SKIP = new Set([
  'node_modules',
  'dist',
  'bin',
  'release',
  'staging',
  'artifacts',
  'size-reports',
  'docs',
  '.git',
  '.claude',
  '.agents',
  'agent',
  '.node-cache',
  '.dclcache',
  '.dev-shim'
])
const CODE = /\.(?:ts|tsx|mjs|cjs|js)$/

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : walk(full)
    return CODE.test(e.name) ? [full] : []
  })
}

const ALL = walk(ROOT).filter((f) => f !== SELF)
const rel = (f: string): string => path.relative(ROOT, f).split(path.sep).join('/')
const read = (f: string): string => readFileSync(f, 'utf8')

// Blanks comments while keeping line numbers, so a hit reports where it is.
// Block comments become spaces; a line that starts with // or * (jsdoc) drops.
function executable(text: string): string[] {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*(?:\/\/|\*)/.test(l) ? '' : l))
}

// The endpoint, in every spelling that reaches the network. Deliberately NOT a
// bare "entities" match: the word is the ECS one all over this codebase, and
// './actions/entities' is a module. What is banned is /entities as a URL PATH.
const UNDEPLOY_URL = [
  /\/entities\//, //            the path itself: /entities/{world}
  /\}\/entities\b/, //          `${worldsServer()}/entities`
  /\+\s*['"`]\/entities\b/, //  worldsServer() + '/entities'
  /https?:\/\/[^\s'"`]*\/entities\b/ // a hardcoded absolute URL
]

export function buildsWholeWorldUndeploy(line: string): boolean {
  return UNDEPLOY_URL.some((r) => r.test(line))
}

// The second spelling: a DELETE addressed at a world rather than at something
// inside one. Reads the URL literal out of the statement above the call, so it
// only judges call sites whose URL it can actually see — R1 is the wide net,
// this is the one that catches `${server}/world/${name}` with no sub-resource.
const DELETE_CALL = /method:[^,}]*['"`]DELETE['"`]/
const TEMPLATE = /`[^`]*`/g
const WORLD_SUBRESOURCE = /\/world\/[^/?#`]+\/[^/?#\s`]/
const LOOKBACK = 8

export function worldWideDeletes(lines: string[]): number[] {
  const hits: number[] = []
  lines.forEach((line, i) => {
    if (!DELETE_CALL.test(line)) return
    const window = lines.slice(Math.max(0, i - LOOKBACK), i + 1).join('\n')
    for (const lit of window.match(TEMPLATE) ?? []) {
      if (!lit.includes('/world/')) continue
      if (!WORLD_SUBRESOURCE.test(lit.replace(/\$\{[^}]*\}/g, 'X'))) hits.push(i)
    }
  })
  return hits
}

describe('no whole-world undeploy', () => {
  it('U1 no source file builds the DELETE /entities/{world} path', () => {
    const hits: string[] = []
    for (const f of ALL) {
      executable(read(f)).forEach((line, i) => {
        if (buildsWholeWorldUndeploy(line)) hits.push(`${rel(f)}:${i + 1} — ${line.trim().slice(0, 100)}`)
      })
    }
    expect(
      hits,
      'DELETE /entities/{world} undeploys EVERY scene in that world at once, with no undo, including scenes whose project folders live on other machines. Studio only ever removes one named scene: DELETE /world/{name}/scenes/{coordinate} — see features/worlds/undeploy.ts'
    ).toEqual([])
  })

  it('U2 every DELETE aimed at a world names what inside it goes', () => {
    const hits: string[] = []
    for (const f of ALL) {
      const lines = executable(read(f))
      for (const i of worldWideDeletes(lines)) hits.push(`${rel(f)}:${i + 1} — ${lines[i].trim().slice(0, 100)}`)
    }
    expect(
      hits,
      'this DELETE addresses a world, not a scene in it — removal is per-scene, addressed by the parcel the scene sits on'
    ).toEqual([])
  })

  it('the scene-scoped removal is still the one that exists', () => {
    // U1 and U2 pass trivially if removal ever stops being implemented; this
    // pins the sanctioned path so the guard cannot go quietly vacuous.
    const undeploy = read(path.join(ROOT, 'packages/ui/src/features/worlds/undeploy.ts'))
    expect(undeploy).toContain('/scenes/')
    expect(executable(undeploy).some((l) => DELETE_CALL.test(l))).toBe(true)
  })
})

describe('the guard itself', () => {
  it('U1 catches every spelling that reaches the network', () => {
    const forbidden = [
      'const res = await fetch(`${worldsServer()}/entities/${world}`, { method: "DELETE" })',
      "const url = worldsServer() + '/entities/' + world",
      'signedFetch("https://worlds-content-server.decentraland.org/entities/boedo.dcl.eth", { method: "DELETE" })',
      'const path = `/entities/${name}`'
    ]
    for (const line of forbidden) expect(buildsWholeWorldUndeploy(line), line).toBe(true)
  })

  it('U1 leaves ECS entities, module paths and assertions alone', () => {
    const fine = [
      "import { uiDeleteSelected } from './actions/entities'",
      'for (const entity of snapshot.entities) render(entity)',
      "expect(url).not.toContain('/entities')",
      'const url = `${worldsServer()}/world/${name}/scenes/${coordinate}`'
    ]
    for (const line of fine) expect(buildsWholeWorldUndeploy(line), line).toBe(false)
  })

  it('U2 tells a world-wide DELETE from a scene-scoped one', () => {
    const whole = ['const url = `${server}/world/${encodeURIComponent(name)}`', "await signedFetch(url, { method: 'DELETE' })"]
    const scoped = ['const url = `${server}/world/${encodeURIComponent(name)}/scenes/${coord}`', "await signedFetch(url, { method: 'DELETE' })"]
    const permissions = [
      'const url = `${server}/world/${encodeURIComponent(name)}/permissions/${kind}/${addr}`',
      "await signedFetch(url, { method: grant ? 'PUT' : 'DELETE' })"
    ]
    expect(worldWideDeletes(whole)).toEqual([1])
    expect(worldWideDeletes(scoped)).toEqual([])
    expect(worldWideDeletes(permissions)).toEqual([])
  })
})
