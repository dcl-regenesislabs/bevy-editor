import { ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { startInspector } from './inspector'
import { startCameraProjection } from './camera/camera-projection'
import { setupGizmo } from './viewport/gizmo'
import { setupRelations } from './viewport/relations'
import { setupCamera } from './camera/free-cam'
import { startSelectBox, inspectorUi } from './viewport/overlay'
import { startSystemActions } from './system-actions'
import { startPageUiBridge } from './page-ui'
import { startSelectionHighlight, startGizmoPick } from './viewport/click-select'

export function main(): void {
  const _log = console.log
  console.log = (...args: any[]) => {
    _log('[Component Inspector]', ...args)
  }

  startCameraProjection()
  setupGizmo()
  setupRelations()
  setupCamera()
  startSelectBox()
  startSystemActions()
  startPageUiBridge()
  startSelectionHighlight()
  startGizmoPick()
  ReactEcsRenderer.setUiRenderer(inspectorUi)

  startInspector().catch((e) => {
    console.error('fatal error during inspector init')
    console.error(e)
  })
}
