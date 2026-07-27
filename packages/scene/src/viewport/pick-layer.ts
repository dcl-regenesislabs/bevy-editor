// The editor's pick-collider overlay layer + its strip-on-ingest logic, kept free
// of any @dcl/sdk/ecs imports so it can be imported by the host UI's build too
// (inspector.ts -> here) without dragging in SDK const enums (isolatedModules).
//
// click-select.ts writes a CL_RESERVED6 (128) collider onto the inspected scene's
// renderable entities — ENGINE ONLY — so an SDK raycast can hit them; reloadSnapshot
// calls stripPickColliders so the logical snapshot (tree + save) never sees it.
export const PICK_LAYER = 128
// Engine default for an UNSET MeshCollider.collisionMask (ClPointer|ClPhysics —
// mesh_collider.rs). The snapshot reports unset as null, so OR-ing the pick bit
// onto `?? 0` was REPLACING the mask with 128 and silently stripping pointer +
// physics: the scene's own click events went dead the moment the editor attached.
export const DEFAULT_COLLIDER_MASK = 3
export const GLTF = 'GltfContainer'
export const MESH_RENDERER = 'MeshRenderer'
export const MESH_COLLIDER = 'MeshCollider'

// Entities we've already given a pick collider on the engine (so we don't re-write
// — re-writing a GltfContainer mask reloads the gltf). `synthesized` are primitive
// MeshRenderers we ADDED a pick-only MeshCollider to (vs OR-ing into a real one),
// which strip-on-ingest must remove wholesale rather than just clearing the bit.
export const pickApplied = new Set<string>()
export const synthesized = new Set<string>()

// An edit to any of these overwrites the engine-side value with the LOGICAL one —
// which never carries the pick bit, because stripPickColliders removes it on
// ingest. Without dropping the entity's "already done" memo the overlay is never
// re-applied and the entity stays unclickable for the rest of the session, so
// retargeting a model or tweaking a collision mask silently loses selection.
const PICK_RELEVANT = new Set([GLTF, MESH_RENDERER, MESH_COLLIDER])

export function invalidatePickLayer(entityId: string, component: string): void {
  if (PICK_RELEVANT.has(component)) pickApplied.delete(entityId)
}

// Remove the editor pick layer from a freshly-ingested snapshot so the logical
// view (tree, editor, save) never sees it.
export function stripPickColliders(snapshot: Record<string, Record<string, unknown>>): void {
  for (const [id, comps] of Object.entries(snapshot)) {
    const gltf = comps[GLTF] as { visibleMeshesCollisionMask?: number } | undefined
    if (gltf?.visibleMeshesCollisionMask != null && (gltf.visibleMeshesCollisionMask & PICK_LAYER) !== 0) {
      gltf.visibleMeshesCollisionMask &= ~PICK_LAYER
      // an author who never set the mask round-trips as unset, not an explicit 0
      // (behaviourally identical to the engine, but keeps the save clean)
      if (gltf.visibleMeshesCollisionMask === 0) delete gltf.visibleMeshesCollisionMask
    }
    const mc = comps[MESH_COLLIDER] as { collisionMask?: number } | undefined
    if (mc?.collisionMask !== undefined && (mc.collisionMask & PICK_LAYER) !== 0) {
      // A collider that is ONLY the pick layer is one we synthesized: nothing
      // else writes CL_RESERVED6 alone. Recognising it by shape matters because
      // `synthesized` is module state of whichever build did the writing — the
      // page ingests its own snapshots and never fills that set, so relying on
      // it left an invented MeshCollider in the page's tree and save dialog.
      if (mc.collisionMask === PICK_LAYER && (synthesized.has(id) || comps[MESH_RENDERER] !== undefined)) {
        delete comps[MESH_COLLIDER]
      } else {
        mc.collisionMask &= ~PICK_LAYER
        // The overlay writes `?? DEFAULT_COLLIDER_MASK | 128` for an unset mask, so
        // the engine default reads back as 131. Strip that to unset — an explicit
        // author-written 3 also lands here, but unset IS 3 to the engine, so the
        // round-trip stays behaviourally identical either way.
        if (mc.collisionMask === DEFAULT_COLLIDER_MASK) delete mc.collisionMask
      }
    }
  }
}
