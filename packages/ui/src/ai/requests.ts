// Turn-end request executor. The assistant is a coding CLI with the project as
// its cwd: it can write files and nothing else. Anything that has to happen in
// the LIVE scene — placing a prefab, naming it, sizing it, setting a script
// param on it or on something already placed, attaching a script to a named
// entity — it declares in `.editor/requests.json`, and the renderer performs
// here when the turn ends.
//
// One thing is resolved rather than copied: a `PrefabRef` param stores a prefab
// UUID and the assistant only ever sees NAMES, so a name arrives here and
// request-format's resolvePrefabRef turns it into an id — refusing, with the
// reason, when the name is unknown, shared by two prefabs, or points at a prefab
// that is not Spawnable.
//
// Two rules make this safe. Every mutation runs through the same click path a
// human uses (uiPlaceLibraryPrefab / uiSetComponentValue / attachScript), so undo,
// autosave and the bus mirror come for free and there is no invertible-manifest
// machinery to get wrong. And every failure is local: an unknown request type or
// an entity name that doesn't resolve skips that one request and adds a notice
// line — the turn's other work still lands.
//
// The file is deleted as soon as it is read, so a stale request can never replay.
import { state, componentKey } from '@scene/state'
import { entityName } from '@scene/custom-components'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import { uiSetComponentValue } from '../actions/components'
import { type PrefabPlacement, uiPlaceLibraryPrefab, uiPlacePrefab } from '../actions/prefabs'
import { dataLayerReadFile, dataLayerRemoveFile } from '../engine/datalayer'
import { prefabStore, refreshLibrary, refreshPrefabs } from '../panels/prefab-store'
import { isSpawnable } from '../prefabs/spawnable'
import { revealInTree } from '../panels/reveal'
import { parseLayout, type ScriptLayout, type ScriptParam } from '../script/parser'
import { attachScript, scriptItems } from '../script/attach'
import { baseName } from '../script/project-files'
import { log } from '../log'
import {
  REQUESTS_PATH,
  parseRequests,
  resolveEntityRef,
  resolvePrefabRef,
  resolvePrefabSource,
  type AttachScriptRequest,
  type ParamValue,
  type PlacePrefabRequest,
  type PrefabRefChoice,
  type SetParamsRequest
} from './request-format'

/** One line for the turn's tool strip, in the shape AiPanel already renders. */
export interface RequestOutcome {
  tool: string
  detail: string
}

export interface RequestRun {
  outcomes: RequestOutcome[]
  /** Things that were skipped — surfaced once, as a single notice. */
  problems: string[]
  /** Scripts a request already attached; auto-attach must not place them twice. */
  attached: string[]
}

function labelOf(entityId: string): string {
  return entityName(state.snapshot, entityId) ?? `#${entityId}`
}

type Coerced = { value: ScriptParam['value'] } | { problem: string }

// One prefab name from the assistant → the UUID a `PrefabRef` param stores.
function coerceRef(value: ParamValue, prefabs: PrefabRefChoice[]): { id: string } | { problem: string } {
  if (typeof value !== 'string') return { problem: 'expects one prefab name, not a list' }
  return resolvePrefabRef(value, prefabs)
}

// A request carries JSON scalars; a param carries a declared type. Coerce where
// the intent is unambiguous, refuse WITH A REASON where it isn't — a silently
// wrong enum is the failure mode this whole feature exists to avoid, and a
// refusal the assistant cannot read is one it will repeat next turn.
function coerce(param: ScriptParam, value: ParamValue, prefabs: PrefabRefChoice[]): Coerced {
  switch (param.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(n) ? { value: n } : { problem: `expects a number, not ${JSON.stringify(value)}` }
    }
    case 'boolean':
      if (typeof value === 'boolean') return { value }
      if (value === 'true') return { value: true }
      if (value === 'false') return { value: false }
      return { problem: 'expects true or false' }
    case 'enum': {
      const s = String(value)
      if (param.options?.includes(s) === true) return { value: s }
      return { problem: `only accepts ${(param.options ?? []).map((o) => `"${o}"`).join(', ')}` }
    }
    case 'string':
      return { value: Array.isArray(value) ? value.join(', ') : String(value) }
    case 'prefab': {
      const resolved = coerceRef(value, prefabs)
      return 'problem' in resolved ? resolved : { value: resolved.id }
    }
    case 'prefabList': {
      // A comma-separated string is what a pre-typed layout held, so both read.
      const wanted = Array.isArray(value) ? value : String(value).split(',')
      const ids: string[] = []
      for (const entry of wanted) {
        const resolved = coerceRef(entry, prefabs)
        if ('problem' in resolved) return resolved
        if (resolved.id !== '' && !ids.includes(resolved.id)) ids.push(resolved.id)
      }
      return { value: ids }
    }
    default:
      // entity / action refs point at other entities — not settable by name
      return { problem: 'is an entity picker, which only the inspector can set' }
  }
}

// Set params by name across whichever of the entity's scripts declare them,
// through the Script component's own update path (the same write the inspector's
// param fields and its ↻ refresh make). Answers with the names that landed, so a
// caller can say what it actually changed.
async function setScriptParams(
  entityId: string,
  values: Record<string, ParamValue>,
  prefabs: PrefabRefChoice[],
  problems: string[]
): Promise<string[]> {
  const items = scriptItems(entityId)
  if (items.length === 0) {
    problems.push(`"${labelOf(entityId)}" has no script, so its settings were left alone`)
    return []
  }
  // A param that exists but would not take the value gets ITS OWN reason;
  // "no setting called X" is reserved for a name no script on the entity has.
  const missing = new Set(Object.keys(values))
  const refused = new Map<string, string>()
  let changed = false
  const next = items.map((item) => {
    const layout = parseLayout(item.layout)
    if (layout === undefined) return item
    const params = { ...layout.params }
    let touched = false
    for (const [name, value] of Object.entries(values)) {
      const param = params[name]
      if (param === undefined) continue
      const coerced = coerce(param, value, prefabs)
      if ('problem' in coerced) {
        refused.set(name, coerced.problem)
        continue
      }
      missing.delete(name)
      refused.delete(name)
      params[name] = { ...param, value: coerced.value }
      touched = true
    }
    if (!touched) return item
    changed = true
    const updated: ScriptLayout = { ...layout, params }
    return { ...item, layout: JSON.stringify(updated) }
  })
  if (changed) {
    await uiSetComponentValue(
      componentKey(entityId, SCRIPT_COMPONENT),
      entityId,
      SCRIPT_COMPONENT,
      JSON.stringify({ value: next })
    )
  }
  for (const name of missing) {
    const reason = refused.get(name)
    problems.push(
      reason === undefined
        ? `"${labelOf(entityId)}" has no setting called "${name}"`
        : `"${name}" on "${labelOf(entityId)}" ${reason}`
    )
  }
  return Object.keys(values).filter((name) => !missing.has(name))
}

function prefabChoices(): PrefabRefChoice[] {
  return prefabStore.items.map((item) => ({
    id: item.data.id,
    name: item.data.name,
    folder: item.folder,
    spawnable: isSpawnable(item.data)
  }))
}

async function prefabSources(): Promise<{ folders: string[]; refs: string[] }> {
  await refreshLibrary()
  return {
    folders: prefabStore.items.map((item) => item.folder),
    refs: prefabStore.library.map((entry) => entry.ref)
  }
}

async function runPlace(
  request: PlacePrefabRequest,
  sources: { folders: string[]; refs: string[] },
  out: RequestRun
): Promise<void> {
  const source = resolvePrefabSource(request.slug, sources.folders, sources.refs)
  if (source === null) {
    out.problems.push(`there is no "${request.slug}" prefab, so nothing was placed`)
    return
  }
  const placement: PrefabPlacement = {
    position: request.position,
    scale: request.scale,
    name: request.name
  }
  const rootId =
    source.kind === 'library'
      ? await uiPlaceLibraryPrefab(source.ref, placement)
      : await uiPlacePrefab(source.folder, placement)
  if (rootId === null) {
    out.problems.push(`"${request.slug}" could not be placed`)
    return
  }
  out.outcomes.push({ tool: 'Placed', detail: labelOf(rootId) })
  // Read AFTER the placement: a library prefab copies itself into the project on
  // the way in, so an earlier request this turn may have added the very prefab a
  // later param names.
  if (request.params !== undefined) await setScriptParams(rootId, request.params, prefabChoices(), out.problems)
  // Instantiation already revealed it, but that fires before the snapshot has the
  // new entity, so the tree had nothing to scroll to yet. Ask again now the row
  // exists — same signal a manual placement uses, so the assistant's add lands on
  // the same visible row.
  revealInTree(rootId)
}

async function runAttach(
  request: AttachScriptRequest,
  fallbackTarget: string | null,
  out: RequestRun
): Promise<void> {
  // The AI naming a target is the point: with nothing selected, the script still
  // lands on the door the roster told it about.
  const target = request.to === undefined ? fallbackTarget : resolveEntityRef(state.snapshot, request.to)
  if (target === null || state.snapshot[target] === undefined) {
    out.problems.push(
      request.to === undefined
        ? `nothing was selected, so ${baseName(request.script)} was left unattached`
        : `there is no entity called "${request.to}", so ${baseName(request.script)} was left unattached`
    )
    return
  }
  out.attached.push(request.script)
  if (await attachScript(target, request.script)) {
    out.outcomes.push({ tool: 'Attached', detail: `${baseName(request.script)} to ${labelOf(target)}` })
  }
}

async function runSetParams(request: SetParamsRequest, out: RequestRun): Promise<void> {
  const target = resolveEntityRef(state.snapshot, request.to)
  if (target === null || state.snapshot[target] === undefined) {
    out.problems.push(`there is no entity called "${request.to}", so its settings were left alone`)
    return
  }
  const applied = await setScriptParams(target, request.params, prefabChoices(), out.problems)
  if (applied.length > 0) {
    out.outcomes.push({ tool: 'Set', detail: `${applied.join(', ')} on ${labelOf(target)}` })
  }
}

// Set when a delete didn't take, so the next turn retries it before running.
// Without the flag the retry would be an RPC per turn for a file that almost
// never exists — and the dev server logs every read of a missing path.
let undeleted = false

async function drop(): Promise<boolean> {
  try {
    return await dataLayerRemoveFile(REQUESTS_PATH)
  } catch (e) {
    log.warn('could not delete the assistant request file', e)
    return false
  }
}

// Read the request file and delete it in the same breath: whatever happens next,
// these requests never run twice.
async function takeRequestFile(): Promise<string | null> {
  let text: string
  try {
    text = await dataLayerReadFile(REQUESTS_PATH)
  } catch {
    return null // no requests this turn (the common case), or no data layer
  }
  if (text.trim() === '') return null
  undeleted = !(await drop())
  return text
}

/** Retry a delete that didn't take, before the next turn can replay it. */
export async function clearEditorRequests(): Promise<void> {
  if (!undeleted) return
  undeleted = !(await drop())
}

// Run everything the assistant asked for this turn. `fallbackTarget` is the
// entity that was active when the turn started — what an attach request without
// an explicit target means.
export async function runEditorRequests(fallbackTarget: string | null): Promise<RequestRun> {
  const text = await takeRequestFile()
  if (text === null) return { outcomes: [], problems: [], attached: [] }
  const parsed = parseRequests(text)
  const out: RequestRun = { outcomes: [], problems: [...parsed.problems], attached: [] }
  if (parsed.requests.length === 0) return out

  // Any param may be a PrefabRef, so the project's prefabs are read whenever a
  // request carries settings; the library (a second, slower round trip) only
  // when something is actually being placed.
  const placing = parsed.requests.some((r) => r.type === 'placePrefab')
  const needsPrefabs = placing || parsed.requests.some((r) => r.type === 'setParams')
  if (needsPrefabs) await refreshPrefabs()
  const sources = placing ? await prefabSources() : { folders: [], refs: [] }

  for (const request of parsed.requests) {
    try {
      if (request.type === 'placePrefab') await runPlace(request, sources, out)
      else if (request.type === 'setParams') await runSetParams(request, out)
      else await runAttach(request, fallbackTarget, out)
    } catch (e) {
      log.error('assistant request failed', request, e)
      out.problems.push(`one of the assistant's changes failed: ${String(e)}`)
    }
  }
  return out
}
