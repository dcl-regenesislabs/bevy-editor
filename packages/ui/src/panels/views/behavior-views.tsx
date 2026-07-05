// Curated views for behavior/media components (animator, tweens, audio/video,
// pointer events, avatar, cameras, areas). Each entry is a ViewConfig rendered
// by the shared CuratedView; unregistered components fall back to SchemaEditor.
// Some fields (AudioStream spatial*, VideoPlayer spatial*, TweenSequence) aren't
// in the current engine schema yet — configured paths that don't resolve are
// skipped, so they light up automatically when the engine grows them.
import type { ComponentView } from './types'
import { curatedView, COLLIDER_BITS, type SliderSpec, type ViewConfig } from './curated'

const pct: SliderSpec = { min: 0, max: 1, step: 0.01 }

const animator: ViewConfig = {
  groups: [{ fields: ['states'] }],
  labels: { states: 'animation states' },
  sliders: { 'states.*.weight': pct },
  docs: {
    states: 'Animation clips packaged in the model, each independently controllable.',
    'states.*.clip': 'Animation clip path in the model’s files.',
    'states.*.playing': 'Whether this clip is currently playing.',
    'states.*.weight': 'Blend weight of this clip when several play at once.',
    'states.*.speed': 'Playback speed multiplier.',
    'states.*.loop': 'Whether the clip repeats until stopped.'
  }
}

const tween: ViewConfig = {
  groups: [
    { title: 'Playback', fields: ['playing', 'duration', 'easingFunction', 'currentTime'] },
    { fields: ['mode'] }
  ],
  labels: { easingFunction: 'easing', duration: 'duration (ms)' },
  docs: {
    playing: 'Whether the tween is running (vs paused).',
    duration: 'Tween length in milliseconds.',
    easingFunction: 'Interpolation curve applied over the duration.',
    currentTime: 'Current progress through the tween (0–1).',
    mode: 'What the tween animates: move, rotate, scale, or texture movement.'
  }
}

const tweenSequence: ViewConfig = {
  groups: [{ fields: ['sequence', 'loop'] }]
}

const audioSource: ViewConfig = {
  groups: [
    { title: 'Clip', fields: ['audioClipUrl', 'playing', 'loop'] },
    { title: 'Sound', fields: ['volume', 'pitch', 'global', 'currentTime'] }
  ],
  labels: { audioClipUrl: 'clip url' },
  sliders: { volume: pct },
  docs: {
    audioClipUrl: 'Audio file path from the scene manifest.',
    playing: 'Whether the clip is currently playing.',
    loop: 'Restart the clip when it finishes.',
    volume: 'Playback volume.',
    pitch: 'Playback pitch multiplier.',
    global: 'Play at constant volume everywhere (non-positional).',
    currentTime: 'Current playback position, in seconds.'
  }
}

const audioStream: ViewConfig = {
  groups: [
    { fields: ['url', 'playing', 'volume'] },
    { title: 'Spatial', fields: ['spatial', 'spatialMinDistance', 'spatialMaxDistance'] }
  ],
  sliders: { volume: pct },
  docs: {
    url: 'URL of the audio stream.',
    playing: 'Whether the stream is playing.',
    volume: 'Playback volume.',
    spatial: 'Position the sound in 3D space instead of playing globally.',
    spatialMinDistance: 'Within this distance the sound stays at full volume.',
    spatialMaxDistance: 'Beyond this distance the sound is inaudible.'
  }
}

const videoPlayer: ViewConfig = {
  groups: [
    { title: 'Source', fields: ['src', 'playing', 'loop'] },
    { title: 'Playback', fields: ['position', 'playbackRate', 'volume'] },
    { title: 'Spatial', fields: ['spatial', 'spatialMinDistance', 'spatialMaxDistance'] }
  ],
  sliders: { volume: pct },
  docs: {
    src: 'Video file path or URL to play.',
    playing: 'Whether the video is playing.',
    loop: 'Restart the video when it finishes.',
    position: 'Current playback position, in seconds.',
    playbackRate: 'Playback speed multiplier.',
    volume: 'Audio volume of the video.',
    spatial: 'Position the audio in 3D space instead of playing globally.',
    spatialMinDistance: 'Within this distance the audio stays at full volume.',
    spatialMaxDistance: 'Beyond this distance the audio is inaudible.'
  }
}

const pointerEvents: ViewConfig = {
  groups: [{ fields: ['pointerEvents'] }],
  labels: {
    pointerEvents: 'events',
    'pointerEvents.*.eventType': 'event type',
    'pointerEvents.*.eventInfo': 'event info'
  },
  docs: {
    pointerEvents: 'Interactions this entity responds to (click, hover, proximity).',
    'pointerEvents.*.eventType': 'Which pointer interaction triggers this entry.',
    'pointerEvents.*.eventInfo.button': 'Input button that triggers the event.',
    'pointerEvents.*.eventInfo.hoverText': 'Prompt shown to the player on hover.',
    'pointerEvents.*.eventInfo.maxDistance': 'Maximum distance the player can trigger it from.'
  }
}

const avatarShape: ViewConfig = {
  groups: [
    { title: 'Identity', fields: ['id', 'name', 'bodyShape'] },
    { title: 'Colors', fields: ['skinColor', 'hairColor', 'eyeColor'] },
    { title: 'Wearables', fields: ['wearables', 'emotes', 'showOnlyWearables', 'forceRender'] },
    { title: 'Expression', fields: ['expressionTriggerId', 'talking'] }
  ],
  hide: ['expressionTriggerTimestamp'],
  docs: {
    id: 'Unique identifier for this avatar.',
    name: 'Display name shown above the avatar.',
    bodyShape: 'Base body shape urn (male/female).',
    skinColor: 'Skin tone.',
    hairColor: 'Hair color.',
    eyeColor: 'Eye color.',
    wearables: 'Wearable urns equipped on the avatar.',
    emotes: 'Emote urns available to the avatar.',
    talking: 'Show the talking indicator.'
  }
}

const avatarAttach: ViewConfig = {
  groups: [{ fields: ['avatarId', 'anchorPointId'] }],
  labels: { anchorPointId: 'anchor point' },
  docs: {
    avatarId: 'Which avatar to attach this entity to.',
    anchorPointId: 'Body anchor point the entity follows (hand, head, spine, …).'
  }
}

const virtualCamera: ViewConfig = {
  groups: [{ fields: ['lookAtEntity', 'defaultTransition'] }],
  docs: {
    lookAtEntity: 'Entity this camera keeps framed.',
    defaultTransition: 'How the camera eases in when it becomes active.'
  }
}

const mainCamera: ViewConfig = {
  groups: [{ fields: ['virtualCameraEntity'] }],
  labels: { virtualCameraEntity: 'virtual camera' },
  docs: { virtualCameraEntity: 'Virtual camera currently driving the player’s view.' }
}

const cameraModeArea: ViewConfig = {
  groups: [
    { title: 'Area', fields: ['area', 'useColliderRange'] },
    { title: 'Camera', fields: ['mode', 'cinematicSettings'] }
  ],
  labels: { mode: 'camera mode' },
  docs: {
    area: 'Box region (in meters) that forces a camera mode while the player is inside.',
    mode: 'Camera mode enforced inside the area (first-person, third-person, cinematic).'
  }
}

const avatarModifierArea: ViewConfig = {
  groups: [
    { title: 'Area', fields: ['area', 'useColliderRange', 'excludeIds'] },
    { title: 'Modifiers', fields: ['modifiers'] },
    { title: 'Movement', fields: ['movementSettings'] }
  ],
  docs: {
    area: 'Box region (in meters) where the modifiers apply.',
    modifiers: 'Effects applied to avatars inside (hide avatars, disable passports).',
    excludeIds: 'Avatar ids exempt from the modifiers.'
  }
}

const inputModifier: ViewConfig = {
  groups: [{ fields: ['mode'] }],
  docs: { mode: 'Which player inputs to disable (walk, jog, run, jump, emote).' }
}

const triggerArea: ViewConfig = {
  groups: [{ fields: ['mesh', 'collisionMask'] }],
  labels: { mesh: 'shape', collisionMask: 'collision layers' },
  masks: { collisionMask: { bits: COLLIDER_BITS, default: 4 } },
  docs: {
    mesh: 'Shape of the trigger volume.',
    collisionMask: 'Which collision layers activate the trigger.'
  }
}

const skyboxTime: ViewConfig = {
  groups: [{ fields: ['fixedTime', 'transitionMode'] }],
  labels: { fixedTime: 'time of day' },
  sliders: { fixedTime: { min: 0, max: 86400, step: 60 } },
  docs: {
    fixedTime: 'Fixed time of day for the sky, in seconds (0–86400).',
    transitionMode: 'How the sky transitions to the fixed time (forward or backward).'
  }
}

export const behaviorViews: Record<string, ComponentView> = {
  Animator: curatedView(animator),
  Tween: curatedView(tween),
  TweenSequence: curatedView(tweenSequence),
  AudioSource: curatedView(audioSource),
  AudioStream: curatedView(audioStream),
  VideoPlayer: curatedView(videoPlayer),
  PointerEvents: curatedView(pointerEvents),
  AvatarShape: curatedView(avatarShape),
  AvatarAttach: curatedView(avatarAttach),
  VirtualCamera: curatedView(virtualCamera),
  MainCamera: curatedView(mainCamera),
  CameraModeArea: curatedView(cameraModeArea),
  AvatarModifierArea: curatedView(avatarModifierArea),
  InputModifier: curatedView(inputModifier),
  TriggerArea: curatedView(triggerArea),
  SkyboxTime: curatedView(skyboxTime)
}
