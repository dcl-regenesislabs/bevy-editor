import { ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { startInspector } from './inspector'
import { startCameraProjection } from './camera-projection'
import { setupGizmo } from './gizmo'
import { setupRelations } from './relations'
import { setupCamera } from './free-cam'
import { startSelectBox, inspectorUi } from './overlay'
import { startSystemActions } from './system-actions'
import { startPageUiBridge } from './page-ui'
import { startSelectionHighlight, startGizmoPick } from './click-select'

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
