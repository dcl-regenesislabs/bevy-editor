// Pure readers over a project's scene.json. Kept out of main.ts so they can be
// unit-tested without Electron.

// A spawn point axis is either a number or a range [min, max] the engine picks
// randomly inside — the editor wants one stable spot, so take the middle.
export type SpawnAxis = number | number[]

export interface SceneMeta {
  scene?: { base?: string }
  spawnPoints?: { default?: boolean; position?: { x?: SpawnAxis; y?: SpawnAxis; z?: SpawnAxis } }[]
}

function spawnAxis(v: SpawnAxis | undefined): number {
  if (Array.isArray(v)) return v.length === 0 ? 0 : (Math.min(...v) + Math.max(...v)) / 2
  return typeof v === 'number' ? v : 0
}

// Where Stop puts the player back, in DCL world space ("x,y,z"): the scene's
// authored spawn point (an offset from the base parcel), else that parcel's
// centre — where the engine itself drops someone entering the scene. Empty when
// scene.json has no usable base, which the page reads as "don't move anyone".
export function spawnWorldPosition(meta: SceneMeta): string {
  const [px, py] = (meta.scene?.base ?? '0,0').split(',').map((n) => parseInt(n, 10))
  if (!Number.isFinite(px) || !Number.isFinite(py)) return ''
  const point = meta.spawnPoints?.find((p) => p.default) ?? meta.spawnPoints?.[0]
  const [baseX, baseZ] = [px * 16, py * 16]
  if (point?.position === undefined) return `${baseX + 8},0,${baseZ + 8}`
  const { x, y, z } = point.position
  return `${baseX + spawnAxis(x)},${spawnAxis(y)},${baseZ + spawnAxis(z)}`
}
