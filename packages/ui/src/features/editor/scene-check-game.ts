// The game's three authoring hints: an area nothing is named for, a request
// nothing answers, and a round nothing ends. Each is the inverse of something
// the editor already knows — which is why none of them needs a new parser.
//
// They are hints, never blockers. Each one describes a scene that builds, runs
// and simply does nothing at the moment the creator expects something, which is
// exactly the failure Play cannot explain afterwards. A wrong hint must cost
// nothing, so all three go quiet the moment a name is computed rather than
// written: an unreadable name is not a missing one.
//
// The parse is the runs-on scanner's (`gameUse`) — the same one the script
// card's line is drawn from, so a hint can never disagree with the chip sitting
// above it.
import { entityName, nameKey } from '@scene/custom-components'
import { gameUse, type GameUse } from '../../script/runs-on'
import { baseName } from '../../script/project-files'
import { sceneScriptRows, type ScriptRow } from './scene-check-model'
import type { SceneCheck, SceneCheckContext, SceneFinding } from './scene-checks'

export const GAME_CHECK_IDS = {
  /** a script listens on an area name no entity carries */
  zoneName: 'zone-name-unmatched',
  /** a client asks for something no script on the server answers */
  unanswered: 'message-unanswered',
  /** the round is handed to a script, and no script ends it */
  endlessRound: 'round-never-ends'
} as const

// A carried runtime module is the machinery, not the creator's code.
function isConsumerScript(path: string): boolean {
  return !path.includes('/runtime/')
}

function gameUses(ctx: SceneCheckContext): Map<string, GameUse> {
  const uses = new Map<string, GameUse>()
  for (const [path, text] of Object.entries(ctx.scripts)) {
    if (isConsumerScript(path)) uses.set(path, gameUse(text))
  }
  return uses
}

/** The scripts that actually run: one row per placed entity, with its parse. */
function placed(ctx: SceneCheckContext, uses: Map<string, GameUse>): Array<{ row: ScriptRow; use: GameUse }> {
  const out: Array<{ row: ScriptRow; use: GameUse }> = []
  for (const row of sceneScriptRows(ctx.snapshot)) {
    const use = uses.get(row.path)
    if (use !== undefined) out.push({ row, use })
  }
  return out
}

function selectFix(row: ScriptRow): SceneFinding['fix'] {
  return row.entityId === undefined ? undefined : { label: 'Select entity', action: 'select-entity' }
}

// --- 1. zone-name-unmatched ---

// A zone's id IS an entity's Name, matched trimmed and lower-cased (nameKey) —
// the same compare zone-listeners.ts runs from the other end, where the zone
// asks what reacts to it. Here the script asks whether the area exists at all.
const zoneNameUnmatched: SceneCheck = (ctx) => {
  const uses = gameUses(ctx)
  const names = new Set<string>()
  for (const id of Object.keys(ctx.snapshot)) {
    const name = entityName(ctx.snapshot, id)
    if (name !== undefined) names.add(nameKey(name))
  }
  const seen = new Set<string>()
  const out: SceneFinding[] = []
  for (const { row, use } of placed(ctx, uses)) {
    for (const zone of use.zones) {
      if (names.has(nameKey(zone))) continue
      const key = `${row.path}|${nameKey(zone)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: GAME_CHECK_IDS.zoneName,
        level: 'warning',
        title: `No area named “${zone}”`,
        detail: `${baseName(row.path)} waits for players to enter “${zone}” and nothing in the scene has that name — name a Trigger Area that.`,
        entityId: row.entityId,
        fix: selectFix(row)
      })
    }
  }
  return out
}

// --- 2. message-unanswered ---

// The answering side is read from every script the project holds, not only the
// placed ones: a handler the creator has written but not placed yet is a scene
// half-built, and a hint that fires between two gestures is noise.
const messageUnanswered: SceneCheck = (ctx) => {
  const uses = gameUses(ctx)
  const answered = new Set<string>()
  for (const use of uses.values()) for (const name of use.handles) answered.add(name)
  const seen = new Set<string>()
  const out: SceneFinding[] = []
  for (const { row, use } of placed(ctx, uses)) {
    for (const message of use.sends) {
      if (answered.has(message)) continue
      const key = `${row.path}|${message}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: GAME_CHECK_IDS.unanswered,
        level: 'warning',
        title: `Nothing on the server answers “${message}”`,
        detail: `${baseName(row.path)} asks the server for it from the client and no script answers — add \`game.onRequest('${message}', …)\` inside the if (isServer()) branch of any script in the scene.`,
        entityId: row.entityId,
        fix: selectFix(row)
      })
    }
  }
  return out
}

// --- 3. round-never-ends ---

// Game Flow's round length is a ceiling, not the ending, once "Who ends a round"
// is set to your own script — so with nobody calling game.newRound() the first
// round is the last one, and nothing anywhere says so.
const ENDS_WHEN_PARAM = 'endsWhen'
const ENDS_WHEN_SCRIPT = 'script'

const roundNeverEnds: SceneCheck = (ctx) => {
  const flows = sceneScriptRows(ctx.snapshot).filter(
    (row) => row.params.find((p) => p.name === ENDS_WHEN_PARAM)?.value === ENDS_WHEN_SCRIPT
  )
  if (flows.length === 0) return []
  // Game Flow calls game.newRound() itself when the ceiling runs out, so its own
  // script can never answer the question — the question is whether anything ELSE
  // ends the round before that.
  const own = new Set(flows.map((row) => row.path))
  for (const [path, use] of gameUses(ctx)) if (!own.has(path) && use.endsRound) return []
  const out: SceneFinding[] = []
  for (const row of flows) {
    out.push({
      id: GAME_CHECK_IDS.endlessRound,
      level: 'warning',
      title: 'This round never ends',
      detail: `${baseName(row.path)} is set to end the round from your own script, and no script of yours calls \`game.newRound()\` — call it when the round should end.`,
      entityId: row.entityId,
      fix: selectFix(row)
    })
  }
  return out
}

export const GAME_SCENE_CHECKS: ReadonlyArray<readonly [string, SceneCheck]> = [
  [GAME_CHECK_IDS.zoneName, zoneNameUnmatched],
  [GAME_CHECK_IDS.unanswered, messageUnanswered],
  [GAME_CHECK_IDS.endlessRound, roundNeverEnds]
]
