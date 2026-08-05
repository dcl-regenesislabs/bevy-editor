// Game Config mutations: the programmatic path (assistant requests, first-run
// seeding) into `editor::GameConfig`. The inspector view writes through the
// ordinary component funnel instead — it already has the component key.
//
// Every write bumps `version`. That number is the `configVersion` a plan tuple
// pins, so a change that does not bump it would be invisible to the running
// scene: clients would keep reconstructing from the config the phase pinned.
import { state } from '@scene/state'
import { writeComponent } from '@scene/inspector'
import {
  GAME_CONFIG_COMPONENT,
  defaultGameConfig,
  gameConfigJson,
  normalizeGameConfig,
  type GameConfigValue
} from '../gameconfig/normalize'
import { regenerateGameConfig } from '../gameconfig/generate'
import { run } from './run'

const ROOT_ENTITY = '0'

export function readGameConfig(entityId = ROOT_ENTITY): GameConfigValue | null {
  const raw = state.snapshot[entityId]?.[GAME_CONFIG_COMPONENT]
  return raw === undefined ? null : normalizeGameConfig(raw)
}

export const uiSetGameConfig = async (
  value: GameConfigValue,
  entityId = ROOT_ENTITY
): Promise<void> => {
  const next = { ...value, version: value.version + 1 }
  await run(writeComponent(entityId, GAME_CONFIG_COMPONENT, gameConfigJson(next)))
  await regenerateGameConfig()
}

/** Adds the component, seeded with the starter tables, when the scene has none. */
export const uiEnsureGameConfig = async (entityId = ROOT_ENTITY): Promise<void> => {
  if (readGameConfig(entityId) !== null) return
  await run(writeComponent(entityId, GAME_CONFIG_COMPONENT, gameConfigJson(defaultGameConfig())))
  await regenerateGameConfig()
}

export const uiRegenerateGameConfig = async (): Promise<void> => {
  await regenerateGameConfig()
}
