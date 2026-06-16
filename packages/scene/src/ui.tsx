import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { state } from './state'
import { overlayUi } from './overlay'
import { relationsCameraEntity } from './relations'

// The host-page React app (packages/ui) is the editor's one and only UI. The scene
// renders ONLY the viewport layers it must own because they need engine camera
// projection: the parent/child relations overlay and the select-tool drag-box.
// (The old in-scene SDK7 panels lived here too — they're gone; the host UI replaced
// them in both the electron and electron-less/browser modes.)
export function inspectorUi(): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        pointerFilter: 'none'
      }}
    >
      {relationsPanel() ?? []}
      {overlayUi() ?? []}
    </UiEntity>
  )
}

// Parent/child links: a dedicated camera (relations.ts) renders the link lines to a
// texture; paint it over the viewport while something is selected.
function relationsPanel(): ReactEcs.JSX.Element | null {
  if (state.selected.size === 0) return null
  const cam = relationsCameraEntity()
  if (cam === null) return null
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        pointerFilter: 'none'
      }}
      uiBackground={{ textureMode: 'stretch', videoTexture: { videoPlayerEntity: cam } }}
    />
  )
}
