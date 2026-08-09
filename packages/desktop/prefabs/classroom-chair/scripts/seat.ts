// Sit on this seat: click a sit spot -> the avatar is placed on it facing forward
// and a looping sitting emote plays; moving cancels the emote engine-side (the
// same mechanism the Creator Hub's seat smart items and Genesis Plaza use — no
// avatar attach). Spots are child entities named "Sit Spot…" carrying only a
// Transform; this script gives them their collider and pointer event at runtime.
// With no such children (the standalone Sit Spot prefab), the entity itself is
// the spot.
import {
  ColliderLayer,
  InputAction,
  Material,
  MeshCollider,
  MeshRenderer,
  Schemas,
  Transform,
  VisibilityComponent,
  engine,
  pointerEventsSystem,
  type Entity,
  type LastWriteWinElementSetComponentDefinition
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { isServer } from '@dcl/sdk/network'
import { movePlayerTo, triggerEmote, triggerSceneEmote } from '~system/RestrictedActions'

const SPOT_NAME_PREFIX = 'sit spot'
const HOVER_TEXT = 'Sit Here'
const MAX_DISTANCE = 6
const EMOTE_DELAY_S = 0.25
const SITTING_EMOTES = ['sittingChair1', 'sittingChair2']
// emote .glb files bundled in this prefab's folder (Genesis Plaza-style custom
// poses, played via triggerSceneEmote); empty = the predefined chair emotes
const SCENE_EMOTES: string[] = []

// the Plaza-style "you can sit here" hint: a small glowing dot floating over
// each free spot, pulsing gently, shown only to nearby players
const DOT_VISIBLE_DIST = 10
const DOT_OCCUPIED_DIST = 0.9
const DOT_HEIGHT = 0.55
const DOT_SIZE = 0.09
const DOT_PULSE = 0.25

type NameValue = { value: string }
type NameComponent = LastWriteWinElementSetComponentDefinition<NameValue>

// Every placed seat prefab bundles its own copy of this script (prefab folders are
// self-contained), so the component may already be defined by a sibling copy.
function nameComponent(): NameComponent {
  const existing = engine.getComponentOrNull('core-schema::Name')
  if (existing !== null) return existing as NameComponent
  return engine.defineComponent('core-schema::Name', { value: Schemas.String })
}

function isSpotName(name: unknown): boolean {
  return typeof name === 'string' && name.toLowerCase().startsWith(SPOT_NAME_PREFIX)
}

function sceneRelativeTransform(entity: Entity): { position: Vector3; rotation: Quaternion } {
  const chain: Entity[] = []
  let cursor = entity
  while (cursor !== engine.RootEntity && chain.length < 32) {
    chain.push(cursor)
    const t = Transform.getOrNull(cursor)
    if (t === null) break
    cursor = t.parent ?? engine.RootEntity
  }
  let position = Vector3.Zero()
  let rotation = Quaternion.Identity()
  let scale = Vector3.One()
  for (const link of chain.reverse()) {
    const t = Transform.getOrNull(link)
    if (t === null) continue
    const local = Vector3.create(
      t.position.x * scale.x,
      t.position.y * scale.y,
      t.position.z * scale.z
    )
    position = Vector3.add(position, Vector3.rotate(local, rotation))
    rotation = Quaternion.multiply(rotation, t.rotation)
    scale = Vector3.create(scale.x * t.scale.x, scale.y * t.scale.y, scale.z * t.scale.z)
  }
  return { position, rotation }
}

export class Seat {
  private emoteIn = 0
  private time = 0
  private dots: Array<{ spot: Entity; dot: Entity; visible: boolean }> = []

  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start(): void {
    if (isServer()) { return }
    const Name = nameComponent()
    const spots: Entity[] = []
    for (const [child, transform] of engine.getEntitiesWith(Transform)) {
      if (transform.parent !== this.entity) continue
      const name = Name.getOrNull(child)
      if (name !== null && isSpotName(name.value)) spots.push(child)
    }
    if (spots.length === 0) spots.push(this.entity)

    for (const spot of spots) {
      MeshCollider.setBox(spot, ColliderLayer.CL_POINTER)
      pointerEventsSystem.onPointerDown(
        {
          entity: spot,
          opts: { button: InputAction.IA_POINTER, hoverText: HOVER_TEXT, maxDistance: MAX_DISTANCE }
        },
        () => this.sit(spot)
      )
      // no collider on the dot: clicks pass through to the spot beneath it
      const dot = engine.addEntity()
      Transform.create(dot, {
        parent: spot,
        position: Vector3.create(0, DOT_HEIGHT, 0),
        scale: Vector3.create(DOT_SIZE, DOT_SIZE, DOT_SIZE)
      })
      MeshRenderer.setSphere(dot)
      Material.setPbrMaterial(dot, {
        albedoColor: { r: 1, g: 1, b: 1, a: 0.85 },
        emissiveColor: { r: 1, g: 1, b: 1 },
        emissiveIntensity: 2,
        roughness: 1
      })
      VisibilityComponent.create(dot, { visible: false })
      this.dots.push({ spot, dot, visible: false })
    }
  }

  update(dt: number): void {
    // The hint walks a transform chain per spot per frame, and a seat is placed
    // by the dozen: without this the Multiplayer Server pays for every one.
    if (isServer()) { return }
    this.time += dt
    this.updateDots()
    if (this.emoteIn <= 0) return
    this.emoteIn -= dt
    if (this.emoteIn > 0) return
    if (SCENE_EMOTES.length > 0) {
      // src is the script's directory (custom/<slug>/scripts) — the emotes live
      // one level up, in the placed prefab's own folder
      const root = this.src.replace(/\/scripts\/?$/, '')
      const emote = SCENE_EMOTES[Math.floor(Math.random() * SCENE_EMOTES.length)]
      void triggerSceneEmote({ src: `${root}/${emote}`, loop: true })
      return
    }
    const emote = SITTING_EMOTES[Math.floor(Math.random() * SITTING_EMOTES.length)]
    void triggerEmote({ predefinedEmote: emote })
  }

  private updateDots(): void {
    const player = Transform.getOrNull(engine.PlayerEntity)?.position
    const pulse = 1 + DOT_PULSE * Math.sin(this.time * 3)
    for (const entry of this.dots) {
      let visible = false
      if (player !== undefined) {
        const world = sceneRelativeTransform(entry.spot).position
        const dist = Vector3.distance(player, world)
        // hidden while someone (you) is on the spot — a glow over a seated
        // avatar's head reads as a bug, not a hint
        visible = dist < DOT_VISIBLE_DIST && dist > DOT_OCCUPIED_DIST
      }
      if (entry.visible !== visible) {
        entry.visible = visible
        VisibilityComponent.getMutable(entry.dot).visible = visible
      }
      if (visible) {
        Transform.getMutable(entry.dot).scale = Vector3.create(
          DOT_SIZE * pulse,
          DOT_SIZE * pulse,
          DOT_SIZE * pulse
        )
      }
    }
  }

  private sit(spot: Entity): void {
    const world = sceneRelativeTransform(spot)
    const forward = Vector3.rotate(Vector3.Forward(), world.rotation)
    void movePlayerTo({
      newRelativePosition: world.position,
      avatarTarget: Vector3.add(world.position, forward)
    })
    // let the teleport settle before the emote starts, or the walk cancels it
    this.emoteIn = EMOTE_DELAY_S
  }
}
