// Bridge exposed to the host renderer page (editor-app.html). The editor UI
// uses it for project management and the scene-loading lifecycle; everything
// engine-related goes through the same-origin iframe instead.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('editorShell', {
  pickProject: () => ipcRenderer.invoke('pick-project'),
  openProject: (dir: string) => ipcRenderer.invoke('open-project', dir),
  getState: () => ipcRenderer.invoke('get-state'),
  // clear corrupt engine browser storage when boot stalls; resolves true if cleared
  recoverEngineStorage: (): Promise<boolean> => ipcRenderer.invoke('recover-engine-storage'),
  onStackLog: (cb: (line: string) => void) =>
    ipcRenderer.on('stack-log', (_e, line: string) => cb(line)),
  // scene-loading lifecycle: main starts the servers after navigation, then
  // reports readiness (with the realm/systemScene to attach) or failure
  onServersReady: (cb: (info: { realm: string; systemScene: string; position: string }) => void) =>
    ipcRenderer.on('servers-ready', (_e, info) => cb(info)),
  // pull the cached ready payload on (re)mount — covers Cmd+R, where the push
  // doesn't re-fire; resolves null on first load (servers not up yet)
  requestReady: (): Promise<{ realm: string; systemScene: string; position: string } | null> =>
    ipcRenderer.invoke('request-ready'),
  onServersError: (cb: (message: string) => void) =>
    ipcRenderer.on('servers-error', (_e, message: string) => cb(message))
})
