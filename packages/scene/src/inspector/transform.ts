import { rotateVec3ByQuat } from '../camera/perspective-to-screen'
import { state } from '../state'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

type V3 = { x: number; y: number; z: number }
type Q = { x: number; y: number; z: number; w: number }
export type TransformValue = { position: V3; rotation: Q; scale: V3; parent: number }

export function readTransform(id: string): TransformValue {
  const t = state.snapshot[id]?.Transform as Partial<TransformValue> | undefined
  return {
    position: t?.position ?? { x: 0, y: 0, z: 0 },
    rotation: t?.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
    scale: t?.scale ?? { x: 1, y: 1, z: 1 },
    parent: t?.parent ?? 0
  }
}

export function directChildren(id: string): string[] {
  const pid = Number(id)
  return Object.keys(state.snapshot).filter(
    (c) => (state.snapshot[c]?.Transform as TransformValue | undefined)?.parent === pid
  )
}

// Express `child` (currently local to `parent`) in `parent`'s parent frame, so
// it keeps its world placement when `parent` is removed: parent ∘ child.
export function composeIntoGrandparent(
  parent: TransformValue,
  child: TransformValue,
  grandparent: number
): string {
  const pPos = Vector3.create(parent.position.x, parent.position.y, parent.position.z)
  const pRot = Quaternion.create(parent.rotation.x, parent.rotation.y, parent.rotation.z, parent.rotation.w)
  const pScale = Vector3.create(parent.scale.x, parent.scale.y, parent.scale.z)
  const cPos = Vector3.create(child.position.x, child.position.y, child.position.z)
  const cRot = Quaternion.create(child.rotation.x, child.rotation.y, child.rotation.z, child.rotation.w)
  const cScale = Vector3.create(child.scale.x, child.scale.y, child.scale.z)

  const pos = Vector3.add(pPos, rotateVec3ByQuat(Vector3.multiply(cPos, pScale), pRot))
  const rot = Quaternion.multiply(pRot, cRot)
  const scale = Vector3.multiply(pScale, cScale)

  return JSON.stringify({
    position: { x: pos.x, y: pos.y, z: pos.z },
    rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
    scale: { x: scale.x, y: scale.y, z: scale.z },
    parent: grandparent
  })
}

// How many direct children an entity has (for the confirm dialog).
export function childCount(id: string): number {
  return directChildren(id).length
}

// Everything under it, at any depth — what the Delete key takes.
export function descendantCount(id: string): number {
  let n = 0
  const stack = [id]
  while (stack.length > 0) {
    for (const child of directChildren(stack.pop() as string)) {
      n++
      stack.push(child)
    }
  }
  return n
}
