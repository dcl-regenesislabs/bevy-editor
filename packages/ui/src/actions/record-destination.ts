// Set a mover's end position by dragging a ghost of it.
//
// A script param of type `position` is an offset in the owning entity's local
// frame — hard to type, easy to show. Entering the state spawns a copy of the
// entity's own model at the current end pose (same model, same orientation, no
// collisions) and selects it — the engine's selection highlight is what makes
// it read as the ghost — with the translate gizmo. The
// creator drags THE GHOST — the real entity never moves — and Done reads the
// ghost's pose back into the param and removes it. Cancel just removes it.
//
// History: the gizmo pipeline pushes a step per drag while the state is
// active. Done/cancel truncate back to the entry depth and Done pushes ONE
// composed step (the Script component before/after), so the whole gesture is
// a single ⌘Z and a mid-state crash leaves an ordinary, deletable entity.
import { createEntities, deleteEntityRecursive } from '@scene/inspector'
import { state } from '@scene/state'
import { NAME_COMPONENT } from '@scene/custom-components'
import { PICK_LAYER } from '@scene/viewport/pick-layer'
import {
  historyDepth,
  pushHistory,
  snapshotValue,
  truncateHistory,
  withHistorySuppressed
} from '../core/history'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import { scriptItems } from '../script/attach'
import { parseLayout, positionOf, type PositionValue } from '../script/parser'
import { writeScriptParamValues } from '../script/params'
import { uiSelectEntity, uiSetTool } from './selection'
import { endPoseFor, dragOffset, type TransformValue } from './record-math'

export interface RecordTarget {
  param: string
  /** Which entry of a `positionList` param; absent = a scalar `position`. */
  index?: number
}

interface RecordSession {
  entityId: string
  target: RecordTarget
  ghostId: string
  enteredAtDepth: number
  before: TransformValue
}

let session: RecordSession | null = null

const GHOST_TINT = { r: 0.25, g: 0.8, b: 0.69, a: 0.45 }

// What the right-click gesture records into: the first `position` param, or
// the first entry of the first `positionList`. Later rows of a list get their
// own Set buttons, which name their target explicitly.
export function recordableParam(entityId: string): RecordTarget | null {
  for (const item of scriptItems(entityId)) {
    const layout = parseLayout(typeof item.layout === 'string' ? item.layout : undefined)
    if (layout === undefined) continue
    for (const [name, param] of Object.entries(layout.params)) {
      if (param.type === 'position') return { param: name }
      if (param.type === 'positionList' && Array.isArray(param.value) && param.value.length > 0) {
        return { param: name, index: 0 }
      }
    }
  }
  return null
}

// The stored offset the target names right now, or null when it stopped
// existing (a row deleted while its ghost was up).
function targetValue(entityId: string, target: RecordTarget): PositionValue | null {
  for (const item of scriptItems(entityId)) {
    const layout = parseLayout(typeof item.layout === 'string' ? item.layout : undefined)
    const param = layout?.params[target.param]
    if (param === undefined) continue
    if (target.index === undefined) {
      return param.type === 'position' ? positionOf(param.value) : null
    }
    if (param.type !== 'positionList' || !Array.isArray(param.value)) return null
    const entry = (param.value as unknown[])[target.index]
    return entry === undefined ? null : positionOf(entry as PositionValue)
  }
  return null
}

// A list edit replaces the whole list — one value, one write, one undo step.
function valueToWrite(
  entityId: string,
  target: RecordTarget,
  offset: PositionValue
): PositionValue | PositionValue[] | null {
  if (target.index === undefined) return offset
  for (const item of scriptItems(entityId)) {
    const layout = parseLayout(typeof item.layout === 'string' ? item.layout : undefined)
    const param = layout?.params[target.param]
    if (param === undefined) continue
    if (param.type !== 'positionList' || !Array.isArray(param.value)) return null
    const list = (param.value as unknown[]).map((entry) => positionOf(entry as PositionValue))
    if (target.index >= list.length) return null
    list[target.index] = offset
    return list
  }
  return null
}

export function isRecordingDestination(): boolean {
  return session !== null
}

// The ghost is the entity's own model, see-through, colliders off. Two rules
// hold this together. The pick mask is PRE-BAKED: the editor's pick sync
// rewrites any GltfContainer that lacks the bit, a rewrite reloads the gltf,
// and that reload racing the material override blanks the ghost. And every
// value here is ENGINE-form JSON — oneofs as { caseName: value }, never the
// composite's { $case } shape, which the engine's serde rejects outright
// (schema.ts's toSdkValue converts engine→SDK on save, not the other way).
// An entity without a model gets a translucent box instead.
function ghostVisual(entityId: string): Record<string, unknown> {
  const gltf = snapshotValue(entityId, 'GltfContainer') as { src?: string } | null
  if (gltf !== null && typeof gltf?.src === 'string' && gltf.src !== '') {
    return {
      GltfContainer: {
        src: gltf.src,
        visibleMeshesCollisionMask: PICK_LAYER,
        invisibleMeshesCollisionMask: 0
      },
      GltfNodeModifiers: {
        modifiers: [
          {
            path: '',
            castShadows: false,
            material: { material: { pbr: { albedoColor: GHOST_TINT } } }
          }
        ]
      }
    }
  }
  return {
    MeshRenderer: { mesh: { box: { uvs: [] } } },
    Material: {
      material: { unlit: { diffuseColor: GHOST_TINT, castShadows: false } }
    }
  }
}

export async function enterRecordDestination(entityId: string, target?: RecordTarget): Promise<void> {
  if (session !== null) await cancelRecordDestination()
  const resolved = target ?? recordableParam(entityId) ?? undefined
  if (resolved === undefined) return
  const value = targetValue(entityId, resolved)
  if (value === null) return
  const found = { target: resolved, value }
  const before = (snapshotValue(entityId, 'Transform') ?? {}) as TransformValue
  const enteredAtDepth = historyDepth()
  let ghostId: string | null = null
  await withHistorySuppressed(async () => {
    const ids = await createEntities([
      {
        [NAME_COMPONENT]: { value: 'End position' },
        Transform: {
          position: endPoseFor(before, found.value),
          rotation: before.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
          scale: before.scale ?? { x: 1, y: 1, z: 1 },
          parent: before.parent ?? 0
        },
        ...ghostVisual(entityId)
      }
    ])
    ghostId = ids.length > 0 ? String(ids[0]) : null
  })
  if (ghostId === null) return
  session = { entityId, target: found.target, ghostId, enteredAtDepth, before }
  uiSelectEntity(ghostId, false, false)
  uiSetTool('translate')
  state.recordingDestination = { entityId, param: found.target.param, ghostId }
}

async function removeGhost(active: RecordSession): Promise<void> {
  await withHistorySuppressed(async () => {
    if (state.snapshot[active.ghostId] !== undefined) await deleteEntityRecursive(active.ghostId)
  })
}

// Both exits clear the state before doing any awaiting work, so a re-entrant
// call (uiPlay cancels, so does the pill when selection moves away) finds
// nothing left to undo.
function takeSession(): RecordSession | null {
  const active = session
  session = null
  state.recordingDestination = null
  return active
}

export async function cancelRecordDestination(): Promise<void> {
  const active = takeSession()
  if (active === null) return
  await removeGhost(active)
  truncateHistory(active.enteredAtDepth)
  uiSelectEntity(active.entityId, false, false)
}

export async function confirmRecordDestination(): Promise<void> {
  const active = takeSession()
  if (active === null) return
  const ghost = (snapshotValue(active.ghostId, 'Transform') ?? {}) as TransformValue
  const offset = dragOffset(active.before, ghost.position ?? { x: 0, y: 0, z: 0 })
  const value = valueToWrite(active.entityId, active.target, offset)
  const scriptBefore = snapshotValue(active.entityId, SCRIPT_COMPONENT)
  const problems: string[] = []
  await withHistorySuppressed(async () => {
    if (value !== null) {
      await writeScriptParamValues(active.entityId, { [active.target.param]: value }, problems)
    }
  })
  await removeGhost(active)
  truncateHistory(active.enteredAtDepth)
  const scriptAfter = snapshotValue(active.entityId, SCRIPT_COMPONENT)
  if (JSON.stringify(scriptBefore) !== JSON.stringify(scriptAfter)) {
    pushHistory([
      { entityId: active.entityId, name: SCRIPT_COMPONENT, before: scriptBefore, after: scriptAfter }
    ])
  }
  uiSelectEntity(active.entityId, false, false)
}
