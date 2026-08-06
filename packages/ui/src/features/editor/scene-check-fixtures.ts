// Shared fixtures for the scene-check tests: a couple of prefab folders and the
// builders that shape a snapshot the way the editor's own state does.
import type { PrefabComposite, PrefabData, PrefabSnapshot } from '../../prefabs/format'
import { BUILTIN_SCENE_CHECKS } from './scene-check-rules'
import type { SceneCheck, SceneCheckContext, SceneCheckPrefab } from './scene-checks'

export function check(id: string): SceneCheck {
  const found = BUILTIN_SCENE_CHECKS.find(([key]) => key === id)
  if (found === undefined) throw new Error(`no check registered as ${id}`)
  return found[1]
}

export const ZOMBIE_ID = '9f1c3a5e-0000-4000-8000-000000000001'
export const ARENA_ID = '9f1c3a5e-0000-4000-8000-000000000002'
export const RIG_ID = '9f1c3a5e-0000-4000-8000-000000000003'

export function data(over: Partial<PrefabData> & { id: string; name: string }): PrefabData {
  return { category: 'custom', tags: [], ...over }
}

export function composite(components: PrefabComposite['components']): PrefabComposite {
  return { version: 1, components }
}

export function transformComponent(entries: Record<string, unknown>): PrefabComposite['components'][number] {
  const out: Record<string, { json: unknown }> = {}
  for (const [localId, json] of Object.entries(entries)) out[localId] = { json }
  return { name: 'core::Transform', data: out }
}

export function scriptComponent(localId: string, rows: unknown[]): PrefabComposite['components'][number] {
  return { name: 'asset-packs::Script', data: { [localId]: { json: { value: rows } } } }
}

export function scriptRow(path: string, params: Record<string, { type: string; value: unknown }> = {}): unknown {
  return { path, priority: 0, layout: JSON.stringify({ params, actions: [] }) }
}

export function entityScripts(rows: unknown[]): PrefabSnapshot[string] {
  return { 'asset-packs::Script': { value: rows } }
}

const ORIGIN = { x: 0, y: 0, z: 0 }
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }
const UNIT = { x: 1, y: 1, z: 1 }

export function transform(position = ORIGIN, parent = 0): Record<string, unknown> {
  return { position, rotation: IDENTITY, scale: UNIT, parent }
}

export const zombiePrefab: SceneCheckPrefab = {
  folder: 'custom/zombie_basic',
  data: data({ id: ZOMBIE_ID, name: 'Zombie Basic', spawnable: { max: 8 } }),
  composite: composite([
    transformComponent({ '0': transform() }),
    scriptComponent('0', [scriptRow('{assetPath}/scripts/zombie-brain.ts', { speed: { type: 'number', value: 2.5 } })])
  ])
}

export const arenaPrefab: SceneCheckPrefab = {
  folder: 'custom/arena_graveyard',
  data: data({ id: ARENA_ID, name: 'Arena Graveyard', spawnable: { max: 2 } }),
  composite: composite([transformComponent({ '512': transform(), '513': { ...transform(), parent: 512 } })])
}

export function context(over: Partial<SceneCheckContext> = {}): SceneCheckContext {
  return { snapshot: {}, prefabs: [], scripts: {}, gameConfig: null, ...over }
}
