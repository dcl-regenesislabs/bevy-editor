// A ~100-line stand-in for the Creator Hub's smart-items Actions interpreter.
// The admin panel only ever needs "read the target entity's asset-packs::Actions
// and run the one the admin picked", so this reads the component, decodes the
// action's jsonPayload and applies it. The full interpreter (triggers, states
// machine, tweens, delays, counters) is deliberately not ported.
import {
  Animator,
  AudioSource,
  GltfContainer,
  Material,
  MeshCollider,
  VideoPlayer,
  VisibilityComponent,
  type Entity
} from '@dcl/sdk/ecs'
import { Actions, States, type ActionEntry } from './components'

export enum ActionType {
  PLAY_ANIMATION = 'play_animation',
  PLAY_SOUND = 'play_sound',
  SET_VISIBILITY = 'set_visibility',
  SET_STATE = 'set_state',
  PLAY_VIDEO_STREAM = 'play_video_stream'
}

export const SUPPORTED_ACTIONS: readonly string[] = [
  ActionType.PLAY_ANIMATION,
  ActionType.PLAY_SOUND,
  ActionType.SET_VISIBILITY,
  ActionType.SET_STATE,
  ActionType.PLAY_VIDEO_STREAM
]

type Listener = (action: ActionEntry) => void

// Replaces the `mitt` registry from @dcl/asset-packs/src/events.ts: one listener
// list per entity, so other scripts can observe what the admin panel fires.
const listeners = new Map<number, Listener[]>()

export function onAction(entity: Entity, listener: Listener): () => void {
  const key = entity as number
  const list = listeners.get(key) ?? []
  list.push(listener)
  listeners.set(key, list)
  return () => {
    const current = listeners.get(key)
    if (current === undefined) return
    const index = current.indexOf(listener)
    if (index > -1) current.splice(index, 1)
  }
}

function notify(entity: Entity, action: ActionEntry): void {
  for (const listener of [...(listeners.get(entity as number) ?? [])]) listener(action)
}

export function getActions(entity: Entity): ActionEntry[] {
  const actions = Actions.getOrNull(entity)
  if (actions === null) return []
  return actions.value.map((action) => ({
    name: action.name,
    type: action.type,
    jsonPayload: action.jsonPayload
  }))
}

export function getActionNames(entity: Entity): string[] {
  return getActions(entity).map((action) => action.name)
}

function payloadOf(action: ActionEntry): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(action.jsonPayload === '' ? '{}' : action.jsonPayload)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Runs the named action on `entity`. Returns false when there is no such action. */
export function dispatchAction(entity: Entity, name: string): boolean {
  const action = getActions(entity).find((candidate) => candidate.name === name)
  if (action === undefined) return false
  runAction(entity, action)
  return true
}

export function runAction(entity: Entity, action: ActionEntry): void {
  const payload = payloadOf(action)
  switch (action.type) {
    case ActionType.PLAY_ANIMATION:
      playAnimation(entity, payload)
      break
    case ActionType.PLAY_SOUND:
      playSound(entity, payload)
      break
    case ActionType.SET_VISIBILITY:
      setVisibility(entity, payload)
      break
    case ActionType.SET_STATE:
      setState(entity, payload)
      break
    case ActionType.PLAY_VIDEO_STREAM:
      playVideoStream(entity, payload)
      break
    default:
      console.log(`admin-tools: action type "${action.type}" is not supported by this prefab`)
  }
  notify(entity, action)
}

function playAnimation(entity: Entity, payload: Record<string, unknown>): void {
  const clipName = asString(payload.animation)
  if (clipName === '') return
  const animator = Animator.getMutableOrNull(entity)
  if (animator === null) return
  if (!animator.states.some((state) => state.clip === clipName)) {
    animator.states = [...animator.states, { clip: clipName }]
  }
  Animator.stopAllAnimations(entity)
  try {
    const clip = Animator.getClip(entity, clipName)
    clip.playing = true
    clip.loop = asBoolean(payload.loop, false)
    clip.weight = 1
    if (payload.shouldReset !== undefined) clip.shouldReset = asBoolean(payload.shouldReset, false)
  } catch (error) {
    console.log('admin-tools: could not play animation', error)
  }
}

function playSound(entity: Entity, payload: Record<string, unknown>): void {
  const src = asString(payload.src)
  if (src === '') return
  const loop = asBoolean(payload.loop, false)
  const volume = asNumber(payload.volume, 1)
  const global = asBoolean(payload.global, false)
  if (AudioSource.has(entity)) {
    AudioSource.playSound(entity, src)
    const audio = AudioSource.getMutable(entity)
    audio.loop = loop
    audio.volume = volume
    audio.global = global
    return
  }
  AudioSource.create(entity, { audioClipUrl: src, loop, playing: true, volume, global })
}

function setVisibility(entity: Entity, payload: Record<string, unknown>): void {
  const visible = asBoolean(payload.visible, true)
  VisibilityComponent.createOrReplace(entity, { visible })
  if (payload.collider === undefined) return
  const collider = asNumber(payload.collider, 0)
  const gltf = GltfContainer.getMutableOrNull(entity)
  if (gltf !== null) {
    gltf.invisibleMeshesCollisionMask = collider
    if (collider === 0) gltf.visibleMeshesCollisionMask = 0
    return
  }
  const mesh = MeshCollider.getMutableOrNull(entity)
  if (mesh !== null) mesh.collisionMask = collider
}

function setState(entity: Entity, payload: Record<string, unknown>): void {
  const states = States.getMutableOrNull(entity)
  if (states === null) return
  const requested = asString(payload.state)
  const fallback = states.defaultValue ?? states.value[0]
  const next = states.value.includes(requested) ? requested : fallback
  states.previousValue = states.currentValue ?? fallback
  states.currentValue = next
}

function playVideoStream(entity: Entity, payload: Record<string, unknown>): void {
  const src = asString(payload.src)
  const existing = VideoPlayer.getMutableOrNull(entity)
  if (existing === null) {
    if (src === '') return
    VideoPlayer.createOrReplace(entity, {
      src,
      volume: asNumber(payload.volume, 1),
      loop: asBoolean(payload.loop, false),
      playing: true
    })
    if (Material.getOrNull(entity) === null) {
      Material.setBasicMaterial(entity, { texture: Material.Texture.Video({ videoPlayerEntity: entity }) })
    }
    return
  }
  if (src !== '' && existing.src !== src) existing.src = src
  existing.volume = asNumber(payload.volume, existing.volume ?? 1)
  existing.loop = asBoolean(payload.loop, existing.loop ?? false)
  existing.playing = true
}
