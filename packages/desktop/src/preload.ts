// Bridge exposed to the host renderer page (editor-app.html). The editor UI
// uses it for project management and the scene-loading lifecycle; everything
// engine-related goes through the same-origin iframe instead.
import { contextBridge, ipcRenderer } from 'electron'
import { AUTH_SIGNIN_CHANNEL, PUBLISH_EVENT_CHANNEL } from '@dcl-editor/contract'
import type { AiEvent, AiProviderInfo, AiSendParams, AuthSigninPayload, PublishEvent, SceneTemplate } from '@dcl-editor/contract'

// synchronous probe at load — reliable in a sandboxed preload (see main.ts)
const isDev = ipcRenderer.sendSync('editor-is-dev') === true

contextBridge.exposeInMainWorld('editorShell', {
  pickProject: () => ipcRenderer.invoke('pick-project'),
  openProject: (dir: string) => ipcRenderer.invoke('open-project', dir),
  // stop the current project's dev server when returning to the picker
  closeProject: (): Promise<void> => ipcRenderer.invoke('close-project'),
  getState: () => ipcRenderer.invoke('get-state'),
  // Home / scene management
  toggleFavourite: (dir: string): Promise<void> => ipcRenderer.invoke('toggle-favourite', dir),
  removeFromRecents: (dir: string): Promise<void> => ipcRenderer.invoke('remove-from-recents', dir),
  deleteProject: (dir: string): Promise<boolean> => ipcRenderer.invoke('delete-project', dir),
  revealInFinder: (dir: string): Promise<void> => ipcRenderer.invoke('reveal-in-finder', dir),
  renameProject: (dir: string, title: string): Promise<void> => ipcRenderer.invoke('rename-project', dir, title),
  duplicateProject: (dir: string): Promise<string | null> => ipcRenderer.invoke('duplicate-project', dir),
  setViewMode: (mode: 'grid' | 'list'): Promise<void> => ipcRenderer.invoke('set-view-mode', mode),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  sceneTemplates: (): Promise<SceneTemplate[]> => ipcRenderer.invoke('scene-templates'),
  createScene: (parentDir: string, name: string, template: string): Promise<string | null> =>
    ipcRenderer.invoke('create-scene', parentDir, name, template),
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
    ipcRenderer.on('servers-error', (_e, message: string) => cb(message)),
  // Decentraland account: open the auth dapp in the default browser, subscribe
  // to the deep-link callback that carries the identityId back into the app
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  onSignIn: (cb: (payload: AuthSigninPayload) => void): (() => void) => {
    const handler = (_e: unknown, payload: AuthSigninPayload): void => cb(payload)
    ipcRenderer.on(AUTH_SIGNIN_CHANNEL, handler)
    return () => ipcRenderer.off(AUTH_SIGNIN_CHANNEL, handler)
  },
  isDev,
  // dev-only: route a pasted dcl-creator-hub:// callback URL as if the OS had
  // delivered it (the unpackaged app can't receive the scheme on macOS)
  submitSignInLink: (url: string): Promise<boolean> => ipcRenderer.invoke('submit-signin-link', url),
  // Publish to Worlds: set the target world in scene.json, start/stop a deploy
  // job in main, subscribe to its progress stream
  setWorldName: (dir: string, name: string): Promise<void> => ipcRenderer.invoke('set-world-name', dir, name),
  publishStart: (dir: string, targetContent: string): Promise<void> =>
    ipcRenderer.invoke('publish-start', dir, targetContent),
  publishStop: (): Promise<void> => ipcRenderer.invoke('publish-stop'),
  onPublishEvent: (cb: (e: PublishEvent) => void): (() => void) => {
    const handler = (_e: unknown, evt: PublishEvent): void => cb(evt)
    ipcRenderer.on(PUBLISH_EVENT_CHANNEL, handler)
    return () => ipcRenderer.off(PUBLISH_EVENT_CHANNEL, handler)
  },
  // AI assistant bridge: request/response for provider list + turn control, and
  // an 'ai-event' subscription for the streamed chat/tool events
  aiProviders: (): Promise<AiProviderInfo[]> => ipcRenderer.invoke('ai-providers'),
  aiSend: (params: AiSendParams): Promise<{ turnId: string }> => ipcRenderer.invoke('ai-send', params),
  aiStop: (): Promise<void> => ipcRenderer.invoke('ai-stop'),
  aiReset: (): Promise<void> => ipcRenderer.invoke('ai-reset'),
  onAiEvent: (cb: (e: AiEvent) => void) => ipcRenderer.on('ai-event', (_e, evt: AiEvent) => cb(evt))
})
