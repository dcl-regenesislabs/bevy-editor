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
import { state } from '@scene/state'
import { entityName } from '@scene/custom-components'
import { type PrefabPlacement, uiPlaceLibraryPrefab, uiPlacePrefab } from '../actions/prefabs'
import { dataLayerReadFile, dataLayerRemoveFile } from '../engine/datalayer'
import { prefabStore, refreshLibrary, refreshPrefabs } from '../panels/prefab-store'
import { revealInTree } from '../panels/reveal'
import { setScriptParams } from '../script/params'
import { attachScript } from '../script/attach'
import { baseName } from '../script/project-files'
import { log } from '../log'
import {
  REQUESTS_PATH,
  parseRequests,
  resolveEntityRef,
  resolvePrefabSource,
  type AttachScriptRequest,
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

function prefabChoices(): PrefabRefChoice[] {
  return prefabStore.items.map((item) => ({
    id: item.data.id,
    name: item.data.name,
    folder: item.folder
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
