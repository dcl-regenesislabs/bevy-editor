// Entry point. Self-gates on the `editorUi` query param so the shell can load
// the bundle unconditionally; boots the bus handshake and mounts the React app
// inside a Shadow DOM so the host page's stylesheet (the bevy loading UI's
// global button/input rules) can't bleed into the editor chrome.
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CSS } from './styles'
import { boot } from './boot'
import { bump } from './store'
import { state } from '../../scene/src/state'
import { consoleCommand } from './console'
import { startEmbedBridge } from './embed'

declare const __EDITOR_UI_BUILD__: string

function start(): void {
  console.log(`[editor-ui] build ${__EDITOR_UI_BUILD__}`)
  // iframed by the host editor app: the host owns all chrome; this page only
  // runs the engine and forwards viewport input to the parent
  if (new URLSearchParams(window.location.search).has('embed')) {
    startEmbedBridge()
    return
  }
  ;(window as unknown as Record<string, unknown>).__editorUiBuild = __EDITOR_UI_BUILD__
  // debugging hooks: inspect editor state / run engine console commands
  ;(window as unknown as Record<string, unknown>).__eui = state
  ;(window as unknown as Record<string, unknown>).__euiCmd = consoleCommand

  const host = document.createElement('div')
  host.id = 'editor-ui-host'
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = CSS
  shadow.appendChild(style)

  const rootEl = document.createElement('div')
  rootEl.className = 'eui-root'
  shadow.appendChild(rootEl)

  // keep engine/game keybindings from firing while typing in the UI
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    host.addEventListener(type, (e) => {
      e.stopPropagation()
    })
  }

  createRoot(rootEl).render(<App />)
  void boot().then(bump)
}

start()
