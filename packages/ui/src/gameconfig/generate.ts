// Writes `src/scripts/game-config.ts` from the Game Config component on the
// scene root. Impure orchestrator: the text is built entirely in memory, then
// one dataLayerSaveFile.
//
// Write-if-changed is not an optimisation, it is the loop breaker: autosave
// calls this after every composite write, and an unconditional write would
// re-dirty the project on every save. Nothing here touches the composite, so a
// frozen scene is never reloaded as a side effect.
import { state, type Snapshot } from '@scene/state'
import { dataLayerAvailable, dataLayerReadFile, dataLayerSaveFile } from '../engine/datalayer'
import { log } from '../log'
import { gameConfigProblems, renderGameConfig } from './codegen'
import { GAME_CONFIG_COMPONENT, normalizeGameConfig, type GameConfigValue } from './normalize'

export const GAME_CONFIG_PATH = 'src/scripts/game-config.ts'

export type GameConfigGenerateReason =
  | 'written'
  | 'unchanged'
  | 'no-component'
  | 'no-data-layer'
  | 'error'

export interface GameConfigGenerateResult {
  written: boolean
  path: string
  reason: GameConfigGenerateReason
  /** generation-time lint; warnings only, never blocks the write */
  problems: string[]
}

/**
 * The component lives on entity 0 (the scene root) but is read wherever it is
 * found, so a project that grew one elsewhere still generates instead of
 * silently emitting nothing.
 */
export function findGameConfig(snapshot: Snapshot): { entityId: string; value: GameConfigValue } | null {
  const root = snapshot['0']?.[GAME_CONFIG_COMPONENT]
  if (root !== undefined) return { entityId: '0', value: normalizeGameConfig(root) }
  for (const [entityId, components] of Object.entries(snapshot)) {
    const found = components[GAME_CONFIG_COMPONENT]
    if (found !== undefined) return { entityId, value: normalizeGameConfig(found) }
  }
  return null
}

async function currentText(path: string): Promise<string | null> {
  try {
    return await dataLayerReadFile(path)
  } catch {
    return null
  }
}

export async function regenerateGameConfig(): Promise<GameConfigGenerateResult> {
  const base = { written: false, path: GAME_CONFIG_PATH }
  if (dataLayerAvailable() !== true) return { ...base, reason: 'no-data-layer', problems: [] }

  const found = findGameConfig(state.snapshot)
  if (found === null) return { ...base, reason: 'no-component', problems: [] }

  const problems = gameConfigProblems(found.value)
  const text = renderGameConfig(found.value)
  if ((await currentText(GAME_CONFIG_PATH)) === text) return { ...base, reason: 'unchanged', problems }

  try {
    await dataLayerSaveFile(GAME_CONFIG_PATH, text)
  } catch (e) {
    log.error('game-config generation failed', e)
    return { ...base, reason: 'error', problems }
  }
  return { written: true, path: GAME_CONFIG_PATH, reason: 'written', problems }
}
