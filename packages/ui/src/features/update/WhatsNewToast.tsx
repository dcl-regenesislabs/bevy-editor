// One-time "you just got updated" toast on Home — the silent updater's only
// announcement. Links to the hand-written notes on the GitHub release.
import { Toast } from '../../ds'
import { dismissWhatsNew, useWhatsNew } from './update'

export function WhatsNewToast(): JSX.Element | null {
  const version = useWhatsNew()
  if (version === null) return null
  const notes = (): void => {
    void window.editorShell?.openExternal?.(
      `https://github.com/dcl-regenesislabs/bevy-editor/releases/tag/v${version}`
    )
    dismissWhatsNew()
  }
  return (
    <Toast>
      Updated to v{version}
      <button className="eui-link" onClick={notes}>What's new</button>
      <button className="eui-link" onClick={dismissWhatsNew}>Dismiss</button>
    </Toast>
  )
}
