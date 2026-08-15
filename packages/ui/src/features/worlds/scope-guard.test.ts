// A surface is rendered at the level its API is addressed at, and it says which
// one it is.
//
// The worlds detail used to resolve every scene-scoped surface through one
// field, `WorldEntry.deployment`. That field was `scenes[0]` — and the content
// server orders /world/{name}/scenes by created_at ASC, so it was the world's
// OLDEST scene. Streaming keys, admin and ban lists, server logs and visitor
// numbers were all read for that one scene and printed under a heading that said
// "world". Nothing errored. A creator with three scenes revoked a streaming key
// under a world heading and took down a scene they had not opened in months.
//
// The field is gone. These three scans stop it coming back, in the three
// spellings it would come back as:
//
//   S1  a `.deployment` read — the field itself, restored by anyone who needs
//       "the world's scene" and does not know that no such thing exists.
//   S2  a `'0,0'` fallback — the same bug wearing a coordinate. A scene scope
//       that defaults to the origin addresses whatever scene happens to stand
//       there, which in a world of one scene is usually the right answer and in
//       a world of several never is.
//   S3  a destructive confirmation that cannot name the scene it will hit.
//       Reset, revoke, remove and ban are all irreversible from the creator's
//       side; the sentence that arms them has to say which scene, or the safety
//       is theatre.
//
// Prose does not fail a build, and none of these fail loudly at runtime either —
// the request succeeds against the wrong scene. So they are scanned.
//
// Scans source TEXT (node env, no rendering), scoped to features/worlds and
// modelled on no-whole-world-undeploy.test.ts: same walk, same skip list, same
// comment blanking, same self-exclusion. Executable text only — a ban has to be
// explainable and every explanation names what is banned. The flip side: a
// TRAILING comment may not mention it; put the sentence on its own line.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SELF = fileURLToPath(import.meta.url)
const WORLDS = path.dirname(SELF)
const ROOT = path.resolve(WORLDS, '..', '..', '..', '..', '..')

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
const TEST = /\.test\.tsx?$/

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : walk(full)
    return CODE.test(e.name) ? [full] : []
  })
}

const ALL = walk(WORLDS).filter((f) => f !== SELF)
const SHIPPED = ALL.filter((f) => !TEST.test(f)) // what a creator actually runs
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

// ---- S1: nothing reads a single scene as if it were the world ----

// A property read, not the word. `deployment:` as an object key is the
// world-level PERMISSION kind (permissions.deployment — who may publish here),
// which is a different thing entirely and stays legal.
const DEPLOYMENT_READ = /\.deployment\b|\[\s*['"`]deployment['"`]\s*\]/

export function readsWorldDeployment(line: string): boolean {
  return DEPLOYMENT_READ.test(line)
}

// Deliberately empty. A `.deployment` read inside features/worlds now means one
// of two things: the deleted world-entry field is back, or something is reading
// WorldPermissions.deployment (the publish permission) from in here. The second
// is legitimate but rare enough to be worth writing down, so it goes on this
// list by hand rather than slipping through a looser pattern.
const DEPLOYMENT_ALLOWED: string[] = []

// ---- S2: no scene scope falls back to the origin ----

const ORIGIN_LITERAL = /['"`]\s*0\s*,\s*0\s*['"`]/

export function fallsBackToOrigin(line: string): boolean {
  return ORIGIN_LITERAL.test(line)
}

// ---- S3: a destructive confirmation names the scene it will hit ----

// The confirmation HEADING — Modal's `title`, the line a creator reads before
// they commit. Only a literal is inspected: `title={props.title}` is a passthrough
// and the string it carries is judged where it is written.
const TITLE = /\btitle\s*[=:]\s*\{?(`[^`]*`|"[^"]*"|'[^']*')/
const DESTRUCTIVE = /\b(?:remove|revoke|reset|ban|unban|delete|clear|wipe|undeploy)\b/i

export function destructiveTitle(line: string): string | null {
  const m = TITLE.exec(line)
  if (m === null) return null
  return DESTRUCTIVE.test(m[1]) ? m[1] : null
}

// Every scene name in this feature comes out of scene-label.ts, so "does this
// sentence name a scene" is answerable: collect what the file binds from
// sceneLabel/sceneLabelProse, then look for those identifiers inside the
// title's own interpolations. `props.prose` counts — the prop and the binding
// share a name because the value is passed straight down.
const BINDING = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=[^=].*\bsceneLabel(?:Prose)?\(/
const INTERPOLATION = /\$\{([^}]*)\}/g

export function sceneNameBindings(lines: string[]): Set<string> {
  const names = new Set<string>()
  for (const line of lines) {
    const m = BINDING.exec(line)
    if (m !== null) names.add(m[1])
  }
  return names
}

export function namesAScene(title: string, bindings: Set<string>): boolean {
  for (const m of title.matchAll(INTERPOLATION)) {
    for (const id of m[1].split(/[^\w$]+/)) if (bindings.has(id)) return true
  }
  return false
}

// Deliberately empty. Server storage is the one surface whose true scope is
// still unverified (see docs/WORLDS.md), so it keeps world-level controls — but
// they are ConfirmButtons, not confirmation headings, and none of them trips
// this scan. A genuinely world-level destructive HEADING would go here, with the
// evidence that the API it calls is addressed at a world.
const WORLD_LEVEL_CONFIRMS: string[] = []

describe('no surface stands one scene in for the world', () => {
  it('S1 nothing in features/worlds reads a `.deployment` off a world', () => {
    const hits: string[] = []
    for (const f of ALL) {
      executable(read(f)).forEach((line, i) => {
        const at = `${rel(f)}:${i + 1}`
        if (readsWorldDeployment(line) && !DEPLOYMENT_ALLOWED.includes(at)) hits.push(`${at} — ${line.trim().slice(0, 100)}`)
      })
    }
    expect(
      hits,
      'WorldEntry has no `deployment`, and nothing may reintroduce one. The field held scenes[0], and /world/{name}/scenes comes back created_at ASC — so it was the world\'s OLDEST scene, shown under headings that said "world". A world card or cover that needs a scene\'s face takes the NEWEST one, through newestScene() in scene-label.ts; anything about one scene is read off that scene.'
    ).toEqual([])
  })

  it('S2 no scene scope in features/worlds falls back to the origin', () => {
    const hits: string[] = []
    for (const f of SHIPPED) {
      executable(read(f)).forEach((line, i) => {
        if (fallsBackToOrigin(line)) hits.push(`${rel(f)}:${i + 1} — ${line.trim().slice(0, 100)}`)
      })
    }
    expect(
      hits,
      "a coordinate defaulted to '0,0' is the first-scene bug wearing a parcel: the gatekeeper and the logs stream both resolve a scene by (world, parcel), so a scope that falls back to the origin addresses whatever scene stands there — right by luck in a one-scene world, wrong in every other. A scene that has no readable coordinate never becomes a WorldScene at all (inventory.ts mapScene), so a per-scene surface has a real coordinate or it has no section to render."
    ).toEqual([])
  })

  it('S3 every destructive confirmation names the scene it will hit', () => {
    const hits: string[] = []
    for (const f of SHIPPED) {
      const lines = executable(read(f))
      const bindings = sceneNameBindings(lines)
      lines.forEach((line, i) => {
        const title = destructiveTitle(line)
        const at = `${rel(f)}:${i + 1}`
        if (title === null || WORLD_LEVEL_CONFIRMS.includes(at)) return
        if (!namesAScene(title, bindings)) hits.push(`${at} — ${title.slice(0, 100)}`)
      })
    }
    expect(
      hits,
      'this confirmation is destructive and does not name a scene. Resetting a key, revoking one, removing an admin, banning a visitor and removing a scene each hit exactly one scene, and the creator gets no undo — the heading has to say which, or they are agreeing to something the screen never told them. Name it with sceneLabelProse(scene, world.scenes.length) from scene-label.ts, which reads as “Tower of Madness” at 0,0 and drops the coordinate when the world holds only one scene.'
    ).toEqual([])
  })
})

describe('the guard is not vacuous', () => {
  it('the scan reaches the panels it is about', () => {
    const names = SHIPPED.map((f) => path.basename(f))
    for (const f of ['WorldDetail.tsx', 'StreamingPanel.tsx', 'ModerationPanel.tsx', 'LogsTab.tsx', 'inventory.ts']) {
      expect(names, `${f} is where this rule is broken, so the scan has to be reading it`).toContain(f)
    }
  })

  it('there are destructive confirmations for S3 to have judged', () => {
    const found = SHIPPED.flatMap((f) => executable(read(f)).map(destructiveTitle)).filter((t) => t !== null)
    expect(
      found.length,
      'S3 passes for free if the feature stops confirming anything. Removal, key reset, key revoke, admin removal and ban each raise a confirmation, so several should be here.'
    ).toBeGreaterThanOrEqual(4)
  })

  it('the scene naming S3 asks for is still exported', () => {
    const src = read(path.join(WORLDS, 'scene-label.ts'))
    expect(src).toContain('export function sceneLabelProse')
    expect(src, 'the world card and cover borrow the NEWEST scene, and S1 sends people here for it').toContain(
      'export function newestScene'
    )
  })

  it('WorldEntry declares no scene of its own', () => {
    const entry = /export interface WorldEntry \{[\s\S]*?\n\}/.exec(read(path.join(WORLDS, 'inventory.ts')))
    expect(entry, 'WorldEntry is the type S1 is about').not.toBeNull()
    expect(
      entry?.[0],
      'S1 only has work to do while WorldEntry has no single-scene field. If one is added back under any name, this guard is decoration.'
    ).not.toMatch(/^\s*deployment\s*[?:]/m)
  })
})

describe('the guard itself', () => {
  it('S1 tells a property read from the permission kind of the same name', () => {
    for (const line of [
      'const live = w.deployment !== null',
      "e.image = p?.image ?? e.deployment?.thumbnail ?? null",
      "const d = world['deployment']"
    ]) {
      expect(readsWorldDeployment(line), line).toBe(true)
    }
    for (const line of [
      "    deployment: norm('deployment'),",
      "export type WorldPermissionKind = 'deployment' | 'streaming' | 'access'",
      "permissions: { deployment: { type: 'allow-list', wallets: ['0xAAA'] } },"
    ]) {
      expect(readsWorldDeployment(line), line).toBe(false)
    }
  })

  it('S2 catches an origin fallback however it is spelled, and leaves real coordinates alone', () => {
    for (const line of [
      "return { sceneId: id, realmName: name, parcel: d.base ?? '0,0' }",
      'parcel={`${props.d.base}` ?? `0, 0`}',
      'const at = coord ?? "0,0"'
    ]) {
      expect(fallsBackToOrigin(line), line).toBe(true)
    }
    for (const line of [
      'const parcel = `${scene.x},${scene.y}`',
      'opens.setHours(0, 0, 0, 0)',
      'return { sceneId: s.entityId, realmName: name.toLowerCase(), parcel: sceneCoordinate(s) }'
    ]) {
      expect(fallsBackToOrigin(line), line).toBe(false)
    }
  })

  it('S3 reads a destructive heading and ignores the rest', () => {
    expect(destructiveTitle('title={`Reset the key for ${prose}?`}')).toBe('`Reset the key for ${prose}?`')
    expect(destructiveTitle('title={`Ban ${confirm.who} from ${props.prose}?`}')).toBe('`Ban ${confirm.who} from ${props.prose}?`')
    expect(destructiveTitle('title="Add value"')).toBeNull()
    expect(destructiveTitle('title={props.title}')).toBeNull()
    expect(destructiveTitle('title={`Where ${shortAddr(props.address)} can publish`}')).toBeNull()
  })

  it('S3 knows a heading that names a scene from one that names the world', () => {
    const lines = [
      'const prose = sceneLabelProse(scene, props.world.scenes.length)',
      'const named = (s: WorldScene): string => sceneLabelProse(s, w.scenes.length)'
    ]
    const bindings = sceneNameBindings(lines)
    expect(bindings).toEqual(new Set(['prose', 'named']))
    expect(namesAScene('`Reset the key for ${prose}?`', bindings)).toBe(true)
    expect(namesAScene('`Remove ${props.named} from ${props.world}?`', bindings)).toBe(true)
    expect(namesAScene('`Reset the streaming key for ${w.name}?`', bindings)).toBe(false)
    expect(namesAScene('`Reset the streaming key?`', bindings)).toBe(false)
  })
})
