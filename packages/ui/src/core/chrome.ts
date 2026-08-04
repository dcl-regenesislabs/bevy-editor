// Whether the editor chrome (topbar, panels, toolbar, assistant) is drawn over
// the viewport. Hiding it is pure page-side state — the engine iframe keeps
// rendering underneath, so a clean look at the scene costs nothing and asks
// nothing of bevy. The scene-health banner stays outside this flag on purpose:
// a crash must be visible even when the creator is admiring their work.
import { reactive } from './store'
import { setStoredFlag, storedFlag } from './persist'

// The right dock is ONE unit — the inspector and the assistant live and hide
// together, so its visibility is a single flag. It lives here rather than in a
// component's usePersistentFlag because module code has to be able to raise the
// dock: an "ask the assistant" chip or a jump to an error line has to reach a
// panel the creator may have hidden.
export const chrome = reactive({ uiHidden: false, rightOpen: storedFlag('right', true) })

export function toggleUiHidden(): void {
  chrome.uiHidden = !chrome.uiHidden
}

export function setRightOpen(open: boolean): void {
  chrome.rightOpen = open
  setStoredFlag('right', open)
}

export function toggleRightPanel(): void {
  setRightOpen(!chrome.rightOpen)
}
