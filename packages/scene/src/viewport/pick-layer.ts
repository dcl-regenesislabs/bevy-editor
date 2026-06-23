// The editor's pick-collider overlay layer + its strip-on-ingest logic, kept free
// of any @dcl/sdk/ecs imports so it can be imported by the host UI's build too
// (inspector.ts -> here) without dragging in SDK const enums (isolatedModules).
//
// click-select.ts writes a CL_RESERVED6 (128) collider onto the inspected scene's
// renderable entities — ENGINE ONLY — so an SDK raycast can hit them; reloadSnapshot
// calls stripPickColliders so the logical snapshot (tree + save) never sees it.
export const PICK_LAYER = 128
export const GLTF = 'GltfContainer'
export const MESH_RENDERER = 'MeshRenderer'
export const MESH_COLLIDER = 'MeshCollider'

// Entities we've already given a pick collider on the engine (so we don't re-write
// — re-writing a GltfContainer mask reloads the gltf). `synthesized` are primitive
// MeshRenderers we ADDED a pick-only MeshCollider to (vs OR-ing into a real one),
// which strip-on-ingest must remove wholesale rather than just clearing the bit.
export const pickApplied = new Set<string>()
export const synthesized = new Set<string>()

// Remove the editor pick layer from a freshly-ingested snapshot so the logical
// view (tree, editor, save) never sees it.
export function stripPickColliders(snapshot: Record<string, Record<string, unknown>>): void {
  for (const [id, comps] of Object.entries(snapshot)) {
    const gltf = comps[GLTF] as { visibleMeshesCollisionMask?: number } | undefined
    if (gltf?.visibleMeshesCollisionMask !== undefined && (gltf.visibleMeshesCollisionMask & PICK_LAYER) !== 0) {
      gltf.visibleMeshesCollisionMask &= ~PICK_LAYER
    }
    const mc = comps[MESH_COLLIDER] as { collisionMask?: number } | undefined
    if (mc?.collisionMask !== undefined && (mc.collisionMask & PICK_LAYER) !== 0) {
      if (synthesized.has(id) && mc.collisionMask === PICK_LAYER) delete comps[MESH_COLLIDER]
      else mc.collisionMask &= ~PICK_LAYER
    }
  }
}
