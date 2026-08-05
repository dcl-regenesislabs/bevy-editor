// The turn-end request file the assistant may leave behind, and the pure rules
// for reading it. The CLI can only write files; anything that has to happen in
// the live scene (placing a prefab, naming it, setting a script param, attaching
// a script) is declared here and executed by the renderer through the ordinary
// click paths — see requests.ts.
//
// Everything is tolerant on purpose: a malformed entry costs one skipped request
// and one notice line, never the turn. The assistant is a language model writing
// JSON by hand, so "half the file is good" is the common case, not the edge.
import { attachablePath } from '../script/template'
import type { Snapshot } from '@scene/state'
import { entityName, nameKey } from '@scene/custom-components'

/** Project-root-relative; read and deleted through the data layer. */
export const REQUESTS_PATH = '.editor/requests.json'

// A runaway file must not be able to fill a scene with prefabs.
const MAX_REQUESTS = 24

export interface Vec3 {
  x: number
  y: number
  z: number
}

// A list is the shape a `PrefabRef[]` param wants (Level Slots' arenas), so an
// array of strings is a param value like any scalar.
export type ParamValue = string | number | boolean | string[]

export interface PlacePrefabRequest {
  type: 'placePrefab'
  slug: string
  name?: string
  /** World metres, the frame the roster reports. Omitted = the camera drop point. */
  position?: Vec3
  scale?: Vec3
  params?: Record<string, ParamValue>
}

export interface AttachScriptRequest {
  type: 'attachScript'
  script: string
  /** Entity Name or id. Omitted = whatever was selected when the turn started. */
  to?: string
}

/** Set params on a script that is ALREADY in the scene — the repair path for
 * everything the creator placed by hand, and the only way to reach a param on a
 * prefab's child (a Player Rig's gun sits on the Hand Anchor, not the root). */
export interface SetParamsRequest {
  type: 'setParams'
  /** Entity Name or id; required, since there is no placement to imply it. */
  to: string
  params: Record<string, ParamValue>
}

export type EditorRequest = PlacePrefabRequest | AttachScriptRequest | SetParamsRequest

export interface ParsedRequests {
  requests: EditorRequest[]
  problems: string[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const trimmed = v.trim()
  return trimmed === '' ? undefined : trimmed
}

function vec3(v: unknown): Vec3 | undefined {
  if (!isRecord(v)) return undefined
  const n = (k: string): number | undefined =>
    typeof v[k] === 'number' && Number.isFinite(v[k]) ? v[k] : undefined
  const x = n('x')
  const y = n('y')
  const z = n('z')
  if (x === undefined || y === undefined || z === undefined) return undefined
  return { x, y, z }
}

// A list only ever means "several prefabs", so it is read as text: the numbers
// and booleans inside one would be a mistake nothing downstream could interpret.
function stringList(value: unknown[]): string[] | null {
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    const trimmed = item.trim()
    if (trimmed !== '') out.push(trimmed)
  }
  return out
}

function params(v: unknown, problems: string[]): Record<string, ParamValue> | undefined {
  if (v === undefined) return undefined
  if (!isRecord(v)) {
    problems.push('ignored a params block that was not an object')
    return undefined
  }
  const out: Record<string, ParamValue> = {}
  for (const [name, value] of Object.entries(v)) {
    if (typeof value === 'string' || typeof value === 'boolean') out[name] = value
    else if (typeof value === 'number' && Number.isFinite(value)) out[name] = value
    else if (Array.isArray(value)) {
      const list = stringList(value)
      if (list === null) problems.push(`ignored the param "${name}" — a list may only hold prefab names`)
      else out[name] = list
    } else problems.push(`ignored the param "${name}" — only text, numbers, true/false and lists are settable`)
  }
  return Object.keys(out).length === 0 ? undefined : out
}

// `custom/trigger_zone` and `builtin:trigger-zone` both mean the same prefab, so
// this is a match KEY, not a folder name: strip the scope/folder dressing and
// fold the separators. Project copies are slugged from the prefab's NAME with
// `[^a-z0-9]+ → _` (library.ts's copyIntoProject), while the library ref and the
// slug the assistant is given use `-` — without the fold the project-copy branch
// of resolvePrefabSource can never match.
export function prefabSlug(raw: string): string {
  const afterScope = raw.includes(':') ? (raw.split(':').pop() ?? raw) : raw
  const segments = afterScope.split('/').filter((s) => s !== '')
  return (segments.pop() ?? '').toLowerCase().replace(/[-_]+/g, '-')
}

function place(entry: Record<string, unknown>, problems: string[]): PlacePrefabRequest | null {
  const slug = str(entry.slug) ?? str(entry.prefab)
  if (slug === undefined) {
    problems.push('skipped a place request with no prefab named')
    return null
  }
  const request: PlacePrefabRequest = { type: 'placePrefab', slug }
  const name = str(entry.name)
  if (name !== undefined) request.name = name
  if (entry.position !== undefined) {
    const position = vec3(entry.position)
    if (position === undefined) problems.push(`ignored an unreadable position for "${slug}"`)
    else request.position = position
  }
  if (entry.scale !== undefined) {
    const scale = vec3(entry.scale)
    if (scale === undefined) problems.push(`ignored an unreadable size for "${slug}"`)
    else request.scale = scale
  }
  const values = params(entry.params, problems)
  if (values !== undefined) request.params = values
  return request
}

function attach(entry: Record<string, unknown>, problems: string[]): AttachScriptRequest | null {
  const raw = str(entry.script) ?? str(entry.path)
  const script = raw === undefined ? null : attachablePath(raw)
  if (script === null) {
    problems.push(
      raw === undefined
        ? 'skipped an attach request with no script named'
        : `skipped "${raw}" — only files in src/scripts/ attach to an entity`
    )
    return null
  }
  const request: AttachScriptRequest = { type: 'attachScript', script }
  const to = str(entry.to) ?? str(entry.entity)
  if (to !== undefined) request.to = to
  return request
}

function setParams(entry: Record<string, unknown>, problems: string[]): SetParamsRequest | null {
  const to = str(entry.to) ?? str(entry.entity)
  if (to === undefined) {
    problems.push('skipped a settings change with no entity named')
    return null
  }
  const values = params(entry.params ?? entry.values, problems)
  if (values === undefined) {
    problems.push(`skipped the settings change for "${to}" — it named no settings`)
    return null
  }
  return { type: 'setParams', to, params: values }
}

// Parse `.editor/requests.json`. Never throws: a broken file is reported as a
// problem line and yields no requests.
export function parseRequests(text: string): ParsedRequests {
  const problems: string[] = []
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return { requests: [], problems: ['the assistant left a request file that is not valid JSON'] }
  }
  const list = Array.isArray(root) ? root : isRecord(root) ? root.requests : undefined
  if (!Array.isArray(list)) {
    return { requests: [], problems: ['the assistant left a request file with no requests list'] }
  }
  if (isRecord(root) && root.version !== undefined && root.version !== 1) {
    problems.push(`the request file claims version ${String(root.version)} — reading it as version 1`)
  }

  const requests: EditorRequest[] = []
  for (const entry of list.slice(0, MAX_REQUESTS)) {
    if (!isRecord(entry)) {
      problems.push('skipped a request that was not an object')
      continue
    }
    const type = str(entry.type)
    if (type === 'placePrefab') {
      const request = place(entry, problems)
      if (request !== null) requests.push(request)
    } else if (type === 'attachScript') {
      const request = attach(entry, problems)
      if (request !== null) requests.push(request)
    } else if (type === 'setParams') {
      const request = setParams(entry, problems)
      if (request !== null) requests.push(request)
    } else {
      problems.push(`skipped an unknown request "${type ?? 'untyped'}"`)
    }
  }
  if (list.length > MAX_REQUESTS) {
    problems.push(`only the first ${MAX_REQUESTS} requests were run`)
  }
  return { requests, problems }
}

// Names are matched through nameKey, exactly as zoneBus matches zone names — the
// assistant reads the name out of the roster and types it back.
export function resolveEntityRef(snapshot: Snapshot, ref: string): string | null {
  if (snapshot[ref] !== undefined) return ref
  const wanted = nameKey(ref)
  if (wanted === '') return null
  for (const id of Object.keys(snapshot)) {
    if (nameKey(entityName(snapshot, id) ?? '') === wanted) return id
  }
  return null
}

/** Where a slug's prefab actually lives. The library copies itself into the
 * project on placement, so it wins when both know the slug. */
export function resolvePrefabSource(
  slug: string,
  projectFolders: string[],
  libraryRefs: string[]
): { kind: 'library'; ref: string } | { kind: 'project'; folder: string } | null {
  const wanted = prefabSlug(slug)
  if (wanted === '') return null
  const ref = libraryRefs.find((r) => prefabSlug(r) === wanted)
  if (ref !== undefined) return { kind: 'library', ref }
  const folder = projectFolders.find((f) => prefabSlug(f) === wanted)
  if (folder !== undefined) return { kind: 'project', folder }
  return null
}

/** One project prefab, as a `PrefabRef` param's picker sees it. */
export interface PrefabRefChoice {
  id: string
  name: string
  /** project-relative folder, e.g. `custom/zombie_basic` */
  folder: string
  spawnable: boolean
}

/** Resolved id, or the sentence explaining why nothing was set. */
export type PrefabRefResult = { id: string } | { problem: string }

// A `PrefabRef` param stores a prefab UUID, but the assistant only ever sees
// NAMES — in the roster, in a guide, in the creator's own sentence. So it names
// the prefab and this resolves it, refusing rather than guessing: a wrong id is
// a param that silently points at other content, which is exactly the failure
// the whole request file exists to avoid. An id it did read off disk still
// works, so nothing is lost by being strict about names.
export function resolvePrefabRef(ref: string, choices: PrefabRefChoice[]): PrefabRefResult {
  const wanted = ref.trim()
  if (wanted === '') return { id: '' } // clearing the setting is a legitimate ask
  const byId = choices.find((choice) => choice.id === wanted)
  const matches =
    byId !== undefined
      ? [byId]
      : (() => {
          const name = nameKey(wanted)
          const byName = choices.filter((choice) => nameKey(choice.name) === name)
          if (byName.length > 0) return byName
          const slug = prefabSlug(wanted)
          return slug === '' ? [] : choices.filter((choice) => prefabSlug(choice.folder) === slug)
        })()
  if (matches.length === 0) return { problem: `there is no prefab called "${wanted}" in this project` }
  if (matches.length > 1) {
    const folders = matches.map((choice) => choice.folder).join(', ')
    return { problem: `"${wanted}" matches ${matches.length} prefabs (${folders}) — name one of those folders instead` }
  }
  const match = matches[0]
  if (!match.spawnable) {
    return { problem: `"${match.name}" is not Spawnable, and only Spawnable prefabs can be cloned at run time` }
  }
  return { id: match.id }
}
