// Host-app entry (editor-app.html): mounts the editor React app into a shadow
// root, injects the registered stylesheet, and routes by URL params. Runs in
// the Electron shell (which exposes window.editorShell) and in a plain browser
// tab against terminal-run servers. Components live in features/; the design
// system in ds/. Never add components here.
// Inter Variable is registered at document level (@font-face penetrates the
// shadow DOM even though regular selectors don't).
import '@fontsource-variable/inter/index.css'
import { createRoot } from 'react-dom/client'
import './ds/styles'
import { collectCss } from './ds/styles/registry'
import { state } from '../../scene/src/state'
import { consoleCommand } from './console'
import { TooltipLayer } from './panels/Tooltip'
import { Editor } from './features/editor/Editor'
import { SceneLoader } from './features/editor/SceneLoader'
import { Picker } from './features/home/Picker'
import type { EditorShell } from '@dcl-editor/contract'

declare const __EDITOR_UI_BUILD__: string

declare global {
  interface Window {
    editorShell?: EditorShell
  }
}

function start(): void {
  console.log(`[editor-app] build ${__EDITOR_UI_BUILD__}`)
  ;(window as unknown as Record<string, unknown>).__editorAppBuild = __EDITOR_UI_BUILD__
  // debugging / validation hooks (same contract as the in-page editor)
  ;(window as unknown as Record<string, unknown>).__eui = state
  ;(window as unknown as Record<string, unknown>).__euiCmd = consoleCommand

  const host = document.createElement('div')
  host.id = 'editor-ui-host'
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = collectCss()
  shadow.appendChild(style)

  const rootEl = document.createElement('div')
  rootEl.className = 'eui-root'
  shadow.appendChild(rootEl)

  const params = new URLSearchParams(window.location.search)
  // routing:
  //  ?realm=…      → attach straight to a running stack (browser tab / harness)
  //  ?project=…    → scene-loading lifecycle (electron started the servers)
  //  (none)        → home / project picker
  const root = createRoot(rootEl)
  const view =
    params.has('realm') || params.has('attach') ? (
      <Editor params={params} />
    ) : params.has('project') ? (
      <SceneLoader project={params.get('project') as string} />
    ) : (
      <Picker />
    )
  // TooltipLayer is app-wide: one delegated listener styles every [data-tip] hover.
  root.render(
    <>
      {view}
      <TooltipLayer />
    </>
  )
}

start()
