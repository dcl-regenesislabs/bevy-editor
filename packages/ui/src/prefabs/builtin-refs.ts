// Library refs for the built-in prefabs the app reaches for by name, rather than
// through whatever the drawer happens to list. A ref is `<scope>:<folder>`
// (packages/desktop/src/prefab-library.ts), so the second half is a folder name
// under packages/desktop/prefabs/ — builtin.test.ts fails if one is renamed away.
export const TRIGGER_ZONE_REF = 'builtin:trigger-zone'
