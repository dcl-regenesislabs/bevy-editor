import {
  engine,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  pointerEventsSystem,
  InputAction
} from '@dcl/sdk/ecs'
import { Vector3, Color4 } from '@dcl/sdk/math'

export function main(): void {
  // A clickable cube in the middle of the parcel.
  const cube = engine.addEntity()
  Transform.create(cube, { position: Vector3.create(8, 1, 8) })
  MeshRenderer.setBox(cube)
  MeshCollider.setBox(cube)
  Material.setPbrMaterial(cube, { albedoColor: Color4.create(0.6, 0.18, 0.89, 1) })

  pointerEventsSystem.onPointerDown(
    { entity: cube, opts: { button: InputAction.IA_POINTER, hoverText: 'Click me' } },
    () => {
      const t = Transform.getMutable(cube)
      t.scale = Vector3.scale(t.scale, 1.15)
    }
  )
}
