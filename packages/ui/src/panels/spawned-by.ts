// What a selected entity's spawners say from the HOST's side.
//
// The wiring is derived from placement (a spawner parented to a zone fires on
// that zone; on a model, on that model's click), which reads perfectly from the
// spawner — and not at all from the thing it sits on. Selecting the zone shows
// nothing unless you notice the child in the tree. This derives the reverse
// line: "spawns X — when …", one per spawner child, so the host answers "what
// do you do" from its own inspector.
import type { PrefabData } from '../prefabs/format'
import { SCRIPT_COMPONENT } from '../prefabs/format'
import { spawnerWhenWords } from './views/spawner-words'
import { refsOf } from './views/prefab-options'

type Snapshot = Record<string, Record<string, unknown> | undefined>

export interface SpawnedByLine {
  /** the spawner child carrying the wiring — clicking the line selects it */
  spawnerId: string
  /** "Zombie Basic" or null while nothing is picked */
  prefabName: string | null
  /** creator words for the trigger ("when a player walks in") */
  when: string
}

function spawnerRow(components: Record<string, unknown> | undefined): { spawn: unknown; when: unknown } | null {
  const value = components?.[SCRIPT_COMPONENT] as { value?: unknown } | undefined
  const rows = Array.isArray(value?.value) ? value.value : []
  for (const row of rows) {
    const path = (row as { path?: unknown }).path
    if (typeof path !== 'string' || !/(^|\/)spawner\.ts$/.test(path) || path.includes('/runtime/')) continue
    const layout = (row as { layout?: unknown }).layout
    if (typeof layout !== 'string') continue
    try {
      const params = (JSON.parse(layout) as { params?: Record<string, { value?: unknown }> }).params ?? {}
      return { spawn: params.spawn?.value, when: params.when?.value }
    } catch {
      return null
    }
  }
  return null
}

export function spawnedByLines(
  snapshot: Snapshot,
  hostId: string,
  prefabs: ReadonlyArray<{ data: PrefabData }>
): SpawnedByLine[] {
  const host = Number(hostId)
  const lines: SpawnedByLine[] = []
  for (const [id, components] of Object.entries(snapshot)) {
    const transform = components?.Transform as { parent?: unknown } | undefined
    if (transform?.parent !== host) continue
    const row = spawnerRow(components)
    if (row === null) continue
    const ref = refsOf(row.spawn)[0]
    const prefabName = prefabs.find((p) => p.data.id === ref)?.data.name ?? null
    const stored = typeof row.when === 'string' ? row.when : ''
    lines.push({ spawnerId: id, prefabName, when: spawnerWhenWords(stored).label })
  }
  return lines
}
