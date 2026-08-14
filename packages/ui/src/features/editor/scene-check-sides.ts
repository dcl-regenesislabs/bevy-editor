// The two hints the sides model needs: a script that asks which side it is on
// before the platform can answer, and a client-only call made on the Multiplayer
// Server.
//
// Both are hints, never blockers — the scene builds, Play boots, and one side
// simply behaves as if the branch had been written the other way round. Neither
// throws, neither logs, so a creator has nothing to search for afterwards; that
// silence is the whole reason they are worth a card line.
//
// The parse is the runs-on scanner's (`sideSlips`) — the same one the script
// card's side line is drawn from, so a hint can never disagree with it.
import { baseName } from '../../script/project-files'
import { sideSlips } from '../../script/runs-on'
import { sceneScriptRows, type ScriptRow } from './scene-check-model'
import type { SceneCheck, SceneCheckContext, SceneFinding } from './scene-checks'

export const SIDES_CHECK_IDS = {
  /** `isServer()` read in module-body code, where it answers false for every side */
  moduleScopeServer: 'server-read-at-module-scope',
  /** a call only a player's own client can carry out, made on the Multiplayer Server */
  clientOnlyOnServer: 'client-only-call-on-server'
} as const

// A carried runtime module is the machinery, not the creator's code.
function isConsumerScript(path: string): boolean {
  return !path.includes('/runtime/')
}

interface Placed {
  row: ScriptRow
  text: string
}

// One row per script FILE, not per placement: a seat placed twenty times is one
// mistake in one file, and twenty identical lines on the card is not twenty
// times the help.
function placedScripts(ctx: SceneCheckContext): Placed[] {
  const out: Placed[] = []
  const seen = new Set<string>()
  for (const row of sceneScriptRows(ctx.snapshot)) {
    if (!isConsumerScript(row.path) || seen.has(row.path)) continue
    const text = ctx.scripts[row.path]
    if (text === undefined) continue
    seen.add(row.path)
    out.push({ row, text })
  }
  return out
}

function selectFix(row: ScriptRow): SceneFinding['fix'] {
  return row.entityId === undefined ? undefined : { label: 'Select entity', action: 'select-entity' }
}

// --- 1. server-read-at-module-scope ---

const serverReadAtModuleScope: SceneCheck = (ctx) => {
  const out: SceneFinding[] = []
  for (const { row, text } of placedScripts(ctx)) {
    if (!sideSlips(text).readsServerAtModuleScope) continue
    out.push({
      id: SIDES_CHECK_IDS.moduleScopeServer,
      level: 'warning',
      title: `isServer() answers false at the top of ${baseName(row.path)}`,
      detail:
        'isServer() is not answered yet at the top of a file — it reads false there on the Multiplayer Server as well as on every client. Move this call inside start() or update(), where the answer is real.',
      entityId: row.entityId,
      fix: selectFix(row)
    })
  }
  return out
}

// --- 2. client-only-call-on-server ---

const clientOnlyOnServer: SceneCheck = (ctx) => {
  const out: SceneFinding[] = []
  for (const { row, text } of placedScripts(ctx)) {
    const file = baseName(row.path)
    const slips = sideSlips(text)
    for (const call of slips.clientOnlyOnServer) {
      out.push({
        id: SIDES_CHECK_IDS.clientOnlyOnServer,
        level: 'warning',
        title: `${file} calls ${call}() on the Multiplayer Server`,
        detail: `${call}() only works on a player’s own client — on the Multiplayer Server it resolves with no error and nothing happens. Move this call out of the if (isServer()) branch.`,
        entityId: row.entityId,
        fix: selectFix(row)
      })
    }
    if (!slips.makesMessageBusAtModuleScope) continue
    out.push({
      id: SIDES_CHECK_IDS.clientOnlyOnServer,
      level: 'warning',
      title: `${file} builds a MessageBus at the top of the file`,
      detail:
        'new MessageBus() only works on a client, and the top of a file runs on the Multiplayer Server too — there it fails with “not implemented”. Move it inside start(), on the client side of the if (isServer()) branch.',
      entityId: row.entityId,
      fix: selectFix(row)
    })
  }
  return out
}

export const SIDES_SCENE_CHECKS: ReadonlyArray<readonly [string, SceneCheck]> = [
  [SIDES_CHECK_IDS.moduleScopeServer, serverReadAtModuleScope],
  [SIDES_CHECK_IDS.clientOnlyOnServer, clientOnlyOnServer]
]
