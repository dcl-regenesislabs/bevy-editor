import { ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { startInspector } from './inspector'
import { startCameraProjection } from './camera/camera-projection'
import { setupGizmo } from './viewport/gizmo'
import { setupRelations } from './viewport/relations'
import { setupSpawnAreas } from './viewport/spawn-area'
import { setupSeatMarkers } from './viewport/seat-marker'
import { setupCamera } from './camera/free-cam'
import { startSelectBox, inspectorUi } from './viewport/overlay'
import { startSystemActions } from './system-actions'
import { startPageUiBridge } from './page-ui'
import { startPlayHud } from './play-hud'
import { startSelectionHighlight, startGizmoPick, setupMeshSelect } from './viewport/click-select'

export function main(): void {
  const _log = console.log
  console.log = (...args: any[]) => {
    _log('[Component Inspector]', ...args)
  }

  startCameraProjection()
  setupGizmo()
  setupRelations()
  setupSpawnAreas()
  setupSeatMarkers()
  setupCamera()
  startSelectBox()
  startSystemActions()
  startPageUiBridge()
  startPlayHud()
  startSelectionHighlight()
  setupMeshSelect()
  startGizmoPick()
  ReactEcsRenderer.setUiRenderer(inspectorUi)

  startInspector().catch((e) => {
    console.error('fatal error during inspector init')
    console.error(e)
  })
}
