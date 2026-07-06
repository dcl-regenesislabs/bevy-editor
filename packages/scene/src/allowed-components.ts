// The components a creator can ADD/EDIT in the editor: the SDK7 protobuf set
// (js-sdk-toolchain @dcl/ecs generated) intersected with what bevy-explorer
// actually renders world-side, plus the core-schema Name label component.
// Engine-output components (*Result, *State, PlayerIdentityData, …) and the
// HUD-scene Ui* family are deliberately excluded — they're runtime data, not
// authorable content. Kept free of SDK imports so both bundles can use it.
import { NAME_COMPONENT } from './custom-components'

// The @dcl/inspector Script editor component (EditorComponentNames.Script):
// engine-opaque, carried through the CRDT as raw bytes, persisted in
// main.composite, and executed by @dcl/sdk-commands' script runtime at build.
export const SCRIPT_COMPONENT = 'asset-packs::Script'

export const ALLOWED_COMPONENTS = new Set<string>([
  'Transform',
  'Animator',
  'AudioSource',
  'AudioStream',
  'AvatarAttach',
  'AvatarModifierArea',
  'AvatarShape',
  'Billboard',
  'CameraModeArea',
  'GltfContainer',
  'GltfNodeModifiers',
  'InputModifier',
  'LightSource',
  'MainCamera',
  'Material',
  'MeshCollider',
  'MeshRenderer',
  'NftShape',
  'PointerEvents',
  'SkyboxTime',
  'TextShape',
  'TriggerArea',
  'Tween',
  'TweenSequence',
  'VideoPlayer',
  'VirtualCamera',
  'VisibilityComponent',
  NAME_COMPONENT,
  SCRIPT_COMPONENT
])

export function isAllowedComponent(name: string): boolean {
  return ALLOWED_COMPONENTS.has(name)
}
