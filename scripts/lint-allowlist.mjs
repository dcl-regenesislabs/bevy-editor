// Shrink-only allowlist for the file-size gate (scripts/file-size.test.mjs).
//
// Files here predate the 800-line ceiling (structure audit 2026-08). Each entry
// is capped at the size the file had when the gate landed, so it can only
// shrink; once a file drops to 800 or less its entry MUST be removed — a stale
// entry fails the build. Never add a new entry: split the file instead — the
// phase 3-4 splits (docs/REFACTOR-PLAN.md) already retired AiPanel.tsx,
// inspector.ts and main.ts from this list.
export const MAX_LINES = 800

export const OVERSIZE_ALLOWLIST = [{ file: 'packages/scene/src/viewport/gizmo.ts', max: 839 }]
