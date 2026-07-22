// Browser implementation of the scene's BevyApi surface. Console commands go
// straight to the engine; system-api calls (login, liveSceneInfo, ...) are
// proxied to the editor scene over the message bus, where the real
// `~system/BevyExplorerApi` is available.
import { type BevyApiInterface } from '../../scene/src/bevy-api/interface'
import { consoleCommand } from './console'
import { sceneRpc } from './bus'

export const BevyApi: BevyApiInterface = {
  consoleCommand,
  getParams: async () => Object.fromEntries(new URLSearchParams(window.location.search)),
  getPreviousLogin: async () => await sceneRpc('getPreviousLogin'),
  loginPrevious: async () => await sceneRpc('loginPrevious'),
  loginGuest: () => {
    void sceneRpc('loginGuest')
  },
  liveSceneInfo: async () => await sceneRpc('liveSceneInfo'),
  getSettings: async () => await sceneRpc('getSettings'),
  setSetting: async (name, value) => await sceneRpc('setSetting', [name, value]),
  getSystemActionStream: async () => {
    // system actions stay scene-side (gizmo/camera input); nothing to consume here
    return (async function* () {})()
  }
}
