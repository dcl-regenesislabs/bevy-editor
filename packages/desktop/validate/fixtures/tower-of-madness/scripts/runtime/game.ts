// REPO-ONLY STAND-IN. Not part of the scene.
//
// In a real project the editor writes this file (and the rest of its closure)
// into src/scripts/runtime/ the moment a script imports './runtime/game'. Here
// the one line points tsc — and the vitest suite that boots these scripts — at
// the master the editor would have copied, so the fixture is checked against the
// real signatures instead of a stale transcription.
//
// probe-tower.mjs never copies this directory: the scene it materialises gets
// the module from the editor's own generation pass, which is the thing under
// test.
export * from '../../../../../runtime-modules/game'
