// How a prefab reads to the creator: where it came from, and whether an entity is
// an instance of one. Pure (no data-layer, no browser globals) so the panels and
// the unit tests share one source of truth.
import { CUSTOM_ASSET_COMPONENT, isRecord, type PrefabOrigin, type PrefabOriginSource } from './format'

const LABEL: Record<PrefabOriginSource, string> = {
  builtin: 'Built in',
  user: 'Made here',
  import: 'Imported',
  github: 'GitHub'
}

// A prefab without an origin was written by an older editor (or the Creator Hub),
// where "made in this project" is the only thing it can have been.
export function originLabel(origin: PrefabOrigin | undefined): string {
  return LABEL[origin?.source ?? 'user']
}

export function originTip(origin: PrefabOrigin | undefined): string {
  switch (origin?.source) {
    case 'builtin':
      return 'Ships with the editor'
    case 'import':
      return origin.url === undefined ? 'Imported into this project' : `Imported from ${origin.url}`
    case 'github':
      return `From ${origin.url ?? 'GitHub'}${origin.commit === undefined ? '' : ` @ ${origin.commit.slice(0, 7)}`}`
    default:
      return origin?.project === undefined
        ? 'Saved from a selection in this project'
        : `Saved from a selection in ${origin.project}`
  }
}

// A prefab folder with no `origin` predates the field (or came from the Creator
// Hub); where it is filed is then the only provenance there is.
export function scopeOrigin(
  origin: PrefabOrigin | undefined,
  scope: 'project' | 'user' | 'builtin'
): PrefabOrigin | undefined {
  if (origin !== undefined) return origin
  if (scope === 'builtin') return { source: 'builtin' }
  return scope === 'user' ? { source: 'user' } : undefined
}

// The one-line "where from" a card shows under its name: the source scene for a
// user prefab, the repo/file for an imported one.
export function originDetail(origin: PrefabOrigin | undefined): string | null {
  if (origin === undefined) return null
  if (origin.source === 'user') {
    return origin.project === undefined ? null : `made in ${origin.project}`
  }
  if (origin.source === 'github') {
    const repo = origin.url?.replace(/^https:\/\/(www\.)?github\.com\//, '').split('/').slice(0, 2).join('/')
    const commit = origin.commit === undefined ? '' : `@${origin.commit.slice(0, 7)}`
    return repo === undefined || repo === '' ? `GitHub ${commit}`.trim() : `${repo} ${commit}`.trim()
  }
  if (origin.source === 'import') {
    const name = origin.url?.split(/[\\/]/).filter((p) => p !== '').pop()
    return name === undefined ? 'imported' : `from ${name}`
  }
  return null
}

// The prefab an entity is an instance of, from its `inspector::CustomAsset`.
export function prefabAssetId(components: Record<string, unknown> | undefined): string | null {
  const value = components?.[CUSTOM_ASSET_COMPONENT]
  if (!isRecord(value) || typeof value.assetId !== 'string' || value.assetId === '') return null
  return value.assetId
}
