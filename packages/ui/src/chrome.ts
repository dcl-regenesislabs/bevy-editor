// Whether the editor chrome (topbar, panels, toolbar, assistant) is drawn over
// the viewport. Hiding it is pure page-side state — the engine iframe keeps
// rendering underneath, so a clean look at the scene costs nothing and asks
// nothing of bevy. The scene-health banner stays outside this flag on purpose:
// a crash must be visible even when the creator is admiring their work.
import { reactive } from './store'

export const chrome = reactive({ uiHidden: false })

export function toggleUiHidden(): void {
  chrome.uiHidden = !chrome.uiHidden
}
