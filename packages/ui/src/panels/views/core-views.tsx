// Curated views for the core visual components (Material, meshes, gltf, text,
// light, nft, billboard, visibility). Each entry is a ViewConfig rendered by the
// shared CuratedView; anything not registered here falls back to SchemaEditor.
import type { ComponentView } from './types'
import { curatedView, COLLIDER_BITS, type SliderSpec, type ViewConfig } from './curated'

const pct: SliderSpec = { min: 0, max: 1, step: 0.01 }

// Material slider/label overlays at a path prefix — GltfNodeModifiers embeds the
// same Material message per node modifier ('modifiers.*.material.').
function materialSliders(prefix: string): Record<string, SliderSpec> {
  return {
    [`${prefix}material.pbr.metallic`]: pct,
    [`${prefix}material.pbr.roughness`]: pct,
    [`${prefix}material.pbr.alphaTest`]: pct,
    [`${prefix}material.unlit.alphaTest`]: pct
  }
}

const gltfContainer: ViewConfig = {
  groups: [
    { title: 'Model', fields: ['src'] },
    { title: 'Colliders', fields: ['visibleMeshesCollisionMask', 'invisibleMeshesCollisionMask'] }
  ],
  labels: {
    visibleMeshesCollisionMask: 'visible meshes',
    invisibleMeshesCollisionMask: 'invisible meshes'
  },
  masks: {
    visibleMeshesCollisionMask: { bits: COLLIDER_BITS, default: 0 },
    invisibleMeshesCollisionMask: { bits: COLLIDER_BITS, default: 3 }
  },
  docs: {
    src: 'Path to the .glb/.gltf model in the scene files.',
    visibleMeshesCollisionMask: 'Which collision layers the model’s visible meshes participate in.',
    invisibleMeshesCollisionMask: 'Which collision layers the model’s invisible collider meshes participate in.'
  }
}

const gltfNodeModifiers: ViewConfig = {
  groups: [{ fields: ['modifiers'] }],
  labels: {
    modifiers: 'node modifiers',
    'modifiers.*.path': 'node path',
    'modifiers.*.material.material': 'mode'
  },
  sliders: materialSliders('modifiers.*.'),
  docs: {
    modifiers: 'Per-node overrides applied to meshes inside the loaded glTF.',
    'modifiers.*.path': 'Path of the glTF node this override targets.'
  }
}

const meshRenderer: ViewConfig = {
  groups: [{ fields: ['mesh'] }],
  labels: { mesh: 'shape' },
  docs: { mesh: 'Primitive shape rendered by the engine (box, sphere, cylinder or plane).' }
}

const meshCollider: ViewConfig = {
  groups: [{ fields: ['mesh', 'collisionMask'] }],
  labels: { mesh: 'shape', collisionMask: 'collision layers' },
  masks: { collisionMask: { bits: COLLIDER_BITS, default: 3 } },
  docs: {
    mesh: 'Primitive collider shape. Complex shapes need a GltfContainer instead.',
    collisionMask: 'Which collision layers this collider participates in.'
  }
}

const material: ViewConfig = {
  groups: [
    { fields: ['material'] },
    {
      title: 'Surface',
      fields: [
        'material.pbr.albedoColor',
        'material.pbr.metallic',
        'material.pbr.roughness',
        'material.pbr.specularIntensity',
        'material.pbr.directIntensity',
        'material.pbr.reflectivityColor'
      ]
    },
    { title: 'Emissive', fields: ['material.pbr.emissiveColor', 'material.pbr.emissiveIntensity'] },
    {
      title: 'Transparency',
      fields: ['material.pbr.transparencyMode', 'material.pbr.alphaTest', 'material.pbr.castShadows']
    },
    {
      title: 'Textures',
      fields: [
        'material.pbr.texture',
        'material.pbr.emissiveTexture',
        'material.pbr.bumpTexture',
        'material.pbr.alphaTexture'
      ]
    }
  ],
  labels: { material: 'mode', 'material.pbr.transparencyMode': 'transparency' },
  sliders: materialSliders(''),
  docs: {
    material: 'Lighting model: unlit (flat, ignores lights) or PBR (physically-based).',
    'material.pbr.albedoColor': 'Base surface color.',
    'material.pbr.metallic': 'How metallic the surface is (0 dielectric → 1 metal).',
    'material.pbr.roughness': 'Surface microroughness (0 mirror → 1 matte).',
    'material.pbr.specularIntensity': 'Strength of specular reflections.',
    'material.pbr.directIntensity': 'Intensity of direct lighting on the material.',
    'material.pbr.reflectivityColor': 'Tint of reflections on the surface.',
    'material.pbr.emissiveColor': 'Color the material emits (glows) regardless of lighting.',
    'material.pbr.emissiveIntensity': 'Strength of the emissive glow.',
    'material.pbr.transparencyMode': 'How transparency is resolved (opaque, alpha test, blend, or auto).',
    'material.pbr.alphaTest': 'Alpha cutoff threshold for alpha-test transparency.',
    'material.pbr.castShadows': 'Whether the surface casts shadows.',
    'material.pbr.texture': 'Albedo (base color) texture.',
    'material.pbr.emissiveTexture': 'Texture that drives the emissive glow.',
    'material.pbr.bumpTexture': 'Normal/bump map for surface detail.'
  }
}

const textShape: ViewConfig = {
  groups: [
    { title: 'Text', fields: ['text', 'font', 'fontSize', 'textColor', 'textAlign'] },
    {
      title: 'Layout',
      fields: [
        'width',
        'height',
        'textWrapping',
        'lineSpacing',
        'lineCount',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        'fontAutoSize'
      ]
    },
    {
      title: 'Effects',
      fields: ['outlineWidth', 'outlineColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'shadowColor']
    }
  ],
  docs: {
    text: 'The text content to display.',
    font: 'Typeface used to render the text.',
    fontSize: 'Font size of the text.',
    textColor: 'Color of the text.',
    textAlign: 'Horizontal and vertical alignment within the text box.',
    width: 'Available horizontal space for the text box.',
    height: 'Available vertical space for the text box.',
    textWrapping: 'Wrap text onto new lines when it reaches the border.',
    lineSpacing: 'Extra distance between lines.',
    lineCount: 'Maximum number of lines to display.',
    fontAutoSize: 'Auto-fit the font size to the width/height instead of a fixed size.',
    outlineWidth: 'Width of the stroke outlining each letter.',
    outlineColor: 'Color of the letter outline.',
    shadowBlur: 'Blurriness of the drop shadow.',
    shadowOffsetX: 'Horizontal offset of the drop shadow.',
    shadowOffsetY: 'Vertical offset of the drop shadow.',
    shadowColor: 'Color of the drop shadow.'
  }
}

const billboard: ViewConfig = {
  groups: [{ fields: ['billboardMode'] }],
  labels: { billboardMode: 'mode' },
  docs: { billboardMode: 'Which axes auto-rotate to face the camera (none, X, Y, Z, or all).' }
}

const visibility: ViewConfig = {
  groups: [{ fields: ['visible', 'propagateToChildren'] }],
  docs: {
    visible: 'Whether the entity is rendered.',
    propagateToChildren: 'Apply this visibility to descendants that have no visibility component of their own.'
  }
}

const lightSource: ViewConfig = {
  groups: [
    { title: 'Light', fields: ['active', 'color', 'intensity', 'range'] },
    { fields: ['type'] },
    { title: 'Shadows', fields: ['shadow', 'shadowMaskTexture'] }
  ],
  labels: { shadowMaskTexture: 'shadow mask' },
  docs: {
    active: 'Whether the light is on.',
    color: 'Tint of the emitted light.',
    intensity: 'Light intensity, in candela.',
    range: 'How far the light travels, in meters (-1 = unlimited).',
    type: 'Point light (radiates in all directions) or spot light (a cone).',
    shadow: 'Whether the light casts shadows.',
    shadowMaskTexture: 'Texture mask projected through the light (caustics, gobos, soft shadows).'
  }
}

const nftShape: ViewConfig = {
  groups: [{ fields: ['urn', 'style', 'color'] }],
  labels: { style: 'frame style' },
  docs: {
    urn: 'NFT URI: urn:decentraland:<chain>:<standard>:<contract>:<tokenId>.',
    style: 'Picture-frame style around the NFT.',
    color: 'Background color shown behind transparent pixels.'
  }
}

export const coreViews: Record<string, ComponentView> = {
  GltfContainer: curatedView(gltfContainer),
  GltfNodeModifiers: curatedView(gltfNodeModifiers),
  MeshRenderer: curatedView(meshRenderer),
  MeshCollider: curatedView(meshCollider),
  Material: curatedView(material),
  TextShape: curatedView(textShape),
  Billboard: curatedView(billboard),
  VisibilityComponent: curatedView(visibility),
  LightSource: curatedView(lightSource),
  NftShape: curatedView(nftShape)
}
