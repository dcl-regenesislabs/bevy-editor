// Typed wrapper over the explorer's editor console commands. Every command used
// by the editor gets a named method with typed args and a parsed/typed return,
// replacing stringly-typed `consoleCommand('foo', [...])` + blind `JSON.parse`.
//
// Transport-agnostic: `makeCommands(raw)` takes the raw console transport, so the
// SAME typed surface works on both sides — the scene binds it to BevyApi
// (scene/cmd.ts), the host UI binds it to the engine console (ui/cmd.ts).
import { type Snapshot } from './state'

// Run `cmd` (no leading slash) with string args; resolve the reply string,
// reject with the failure message.
export type RawConsole = (cmd: string, args?: string[]) => Promise<string>

// `/scene_stats` reports `status: blocked({"frozen", "gltfs loading"})` — one set
// holding EVERY reason the scene isn't ticking. A scene still loading its models
// is blocked too, so a bare "blocked" test reads as frozen while the scene is
// merely busy: the editor then skips its auto-pause and the scene runs free the
// moment loading finishes, with the toolbar still offering Play.
export function isFrozenStatus(stats: string): boolean {
  const blocked = /status:\s*blocked\(([^)]*)\)/i.exec(stats)
  return blocked !== null && /"frozen"/i.test(blocked[1])
}

export function makeCommands(raw: RawConsole) {
  const parse = async <T>(cmd: string, args?: string[]): Promise<T> =>
    JSON.parse(await raw(cmd, args)) as T

  return {
    // --- inspection / CRDT (structured returns) ---
    crdtSnapshot: (): Promise<Snapshot> => parse<Snapshot>('crdt_snapshot'),
    crdtInitial: (): Promise<Snapshot> => parse<Snapshot>('crdt_initial'),
    sceneContent: (): Promise<string[]> => parse<string[]>('scene_content'),
    componentNames: (): Promise<string[]> => parse<string[]>('component_names'),
    componentSchema: (name: string): Promise<string> => raw('component_schema', [name]),
    componentDefault: (name: string): Promise<string> => raw('component_default', [name]),
    sceneStats: (): Promise<string> => raw('scene_stats'),
    sceneLogs: (count: number): Promise<string> => raw('scene_logs', [String(count)]),

    // --- mutation ---
    setComponent: (entityId: string, name: string, json: string): Promise<string> =>
      raw('set_component', [entityId, name, json]),
    setComponentRaw: (
      entityId: string,
      componentId: number,
      timestamp: number,
      base64: string
    ): Promise<string> =>
      raw('set_component_raw', [entityId, String(componentId), String(timestamp), base64]),
    deleteComponent: (entityId: string, name: string): Promise<string> =>
      raw('delete_component', [entityId, name]),
    deleteEntity: (id: string, recursive: boolean): Promise<string> =>
      raw('delete_entity', recursive ? [id, '-r'] : [id]),
    newEntity: async (componentId: number, base64: string, count: number): Promise<number[]> => {
      const ids = await parse<unknown>('new_entity', [String(componentId), base64, String(count)])
      return Array.isArray(ids) ? ids.filter((n): n is number => typeof n === 'number') : []
    },

    // --- content / save ---
    saveComposite: (base64: string): Promise<string> => raw('save_composite', [base64]),

    // (The page<->scene editor bus moved off console commands to a same-origin
    // BroadcastChannel — see editor-channel.ts — so it works on stock main.)

    // --- scene lifecycle ---
    setScene: (hash: string): Promise<string> => raw('set_scene', [hash]),
    reload: (hash?: string): Promise<string> => raw('reload', hash === undefined ? [] : [hash]),
    freezeScene: (): Promise<string> => raw('freeze_scene'),
    unfreezeScene: (): Promise<string> => raw('unfreeze_scene'),
    tickScene: (count: number): Promise<string> => raw('tick_scene', [String(count)]),

    // --- viewport ---
    highlight: (ids: string[]): Promise<string> => raw('highlight', ids),
    // Draw collider volumes for the given layer mask (0 = off). Trigger areas,
    // camera/avatar-modifier areas and colliders on invisible meshes have no
    // geometry of their own, so without this they can't be seen or reasoned about.
    debugColliders: (mask: number): Promise<string> => raw('debug_colliders', [String(mask)]),
    // hours 0-24 and clock speed (0 = stopped). The engine's day/night clock runs
    // off real time at speed 12 — a full cycle every ~2h — independent of scene
    // freeze, so an editing session drifts into night unless we pin it.
    time: (hours: number, speed: number): Promise<string> =>
      raw('time', [String(hours), String(speed)]),
    // console-sourced move: unlike the SDK's movePlayerTo (which the engine bounds-
    // checks against the calling scene) this one is unrestricted.
    movePlayerTo: (x: number, y: number, z: number): Promise<string> =>
      raw('move_player_to', [String(x), String(y), String(z)])
  }
}

export type Commands = ReturnType<typeof makeCommands>
