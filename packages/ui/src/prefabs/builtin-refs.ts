// Library refs for the built-in prefabs the app reaches for by name, rather than
// through whatever the drawer happens to list. A ref is `<scope>:<folder>`
// (packages/desktop/src/prefab-library.ts), so the second half is a folder name
// under packages/desktop/prefabs/ — builtin.test.ts fails if one is renamed away.
export const TRIGGER_ZONE_REF = 'builtin:trigger-zone'

// The Spawner is reached by SLUG, not by ref: once a project has its own
// `custom/spawner/` copy, that copy is the one to place, and resolvePrefabSource
// picks between the two.
export const SPAWNER_SLUG = 'spawner'
