// The two blocks the turn context gained when prefabs became spawnable and
// numbers moved to Game Config: what this project can clone at run time, and
// what it has already tuned. Both are DATA — the rules that go with them live in
// DCL_SYSTEM_PROMPT, which is O(1) in project size, while these grow with the
// scene and so belong here, next to the roster.
//
// Pure: the caller reads the prefab list and the scene-root component, these
// only render them.
import { isKeyedTable, type ConfigTable, type GameConfigValue } from '../gameconfig/normalize'

export interface SpawnableEntry {
  name: string
  /** project-relative folder, e.g. `custom/zombie_basic` */
  folder: string
  /** clones the pool may hold at once */
  max: number
  instancing: 'onDemand' | 'perPlayer'
}

// Imported prefab names reach the prompt, so each arrives as one truncated line
// and cannot fake a block of its own — the same rule buildGuideIndex follows.
const MAX_NAME = 80
const MAX_LISTED = 12

function oneLine(text: string, max = MAX_NAME): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function listed(names: string[], max = MAX_LISTED): string {
  const shown = names.slice(0, max).map((name) => oneLine(name, 40))
  const rest = names.length - shown.length
  return rest > 0 ? `${shown.join(', ')}, +${rest} more` : shown.join(', ')
}

/**
 * The `[Spawnable prefabs]` block: every prefab this project can clone at run
 * time, by the NAME a request or a guide refers to it by. Empty when nothing is
 * spawnable — the rule that says to make one lives in the system prompt, so a
 * scene with no spawnables spends no tokens here.
 */
export function buildSpawnableIndex(entries: SpawnableEntry[]): string {
  if (entries.length === 0) return ''
  const head =
    '[Spawnable prefabs] Prefabs in this project with Spawnable ON — the only content the running scene can create. ' +
    'Runtime copies are CLONED from these by a placed kit prefab (the Wave Director clones an enemy, Level Slots an ' +
    'arena, a per-player prefab clones itself once per player); nothing here is placed in the scene until code asks ' +
    'for it. Name one of these in a prefab-typed setting and the editor resolves the name to the id it stores. ' +
    '"Max alive" is the pool ceiling the creator set on the prefab — the scene never holds more clones than that.'
  const rows = entries.map((entry) => {
    const how = entry.instancing === 'perPlayer' ? 'one clone per player, opened for you' : 'cloned on demand'
    return `- "${oneLine(entry.name)}" — ${entry.folder} — ${entry.max} alive at once — ${how}`
  })
  const tail =
    'Their snapshots and the typed `Spawnables.<Alias>` keys are in src/scripts/spawnables.ts, regenerated on every ' +
    'save: read it to get an alias right, never edit it.'
  return [head, ...rows, tail].join('\n')
}

function tableLine(table: ConfigTable): string | null {
  const name = table.name.trim()
  if (name === '') return null
  const keyed = isKeyedTable(table)
  const columns = table.columns.filter((column) => column.name !== '')
  if (keyed && table.columns.length === 1 && columns.length === 1) {
    const keys = table.rows.map((row) => row.key.trim()).filter((key) => key !== '')
    return `- gameConfig.${name}.<name> (${columns[0].kind}) — ${listed(keys)}`
  }
  if (columns.length === 0) return `- gameConfig.${name} — no named columns yet`
  const shape = keyed ? `gameConfig.${name}[name]` : `gameConfig.${name}[i]`
  const fields = listed(columns.map((column) => `${column.name}: ${column.kind}`))
  return `- ${shape} — ${fields} — ${table.rows.length} row${table.rows.length === 1 ? '' : 's'}`
}

/**
 * The `[Game Config]` block: the shape of every tuned number, plus the accessor
 * that reads it. Values are deliberately NOT listed — the generated
 * src/scripts/game-config.ts holds them, and the assistant can read that file;
 * what the prompt cannot afford to leave it guessing is which names exist.
 */
export function buildGameConfigIndex(value: GameConfigValue | null): string {
  if (value === null) return ''
  const lines: string[] = []
  for (const table of value.tables) {
    const line = tableLine(table)
    if (line !== null) lines.push(line)
  }
  for (const scalar of value.values) {
    const name = scalar.name.trim()
    if (name !== '') lines.push(`- gameConfig.${name} (${scalar.kind})`)
  }
  if (lines.length === 0) return ''
  const head =
    `[Game Config] This scene's tuned numbers, held on the scene root (config version ${value.version}). A script in ` +
    "src/ reads them with `import { gameConfig } from './game-config'` — that file is GENERATED on save, so never " +
    'edit it and never copy a number out of it into code. ONE PLACE PER VALUE: anything listed below must not also ' +
    'be a script param, and the editor flags a param that shadows one.'
  const tail =
    'You cannot change these tables — they are a component in the live scene, not a file. When a number here is the ' +
    'right answer, say which table, row and value, and let the creator type it in the Game Config panel.'
  return [head, ...lines, tail].join('\n')
}
