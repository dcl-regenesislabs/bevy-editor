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
    highlight: (ids: string[]): Promise<string> => raw('highlight', ids)
  }
}

export type Commands = ReturnType<typeof makeCommands>
