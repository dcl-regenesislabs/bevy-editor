// Lint gate for the monorepo (first step of `npm run validate`).
//
// Deliberately syntax-level only: type-aware rules would need per-package
// project wiring and slow the gate, and `npm run typecheck` already runs tsc
// strict on everything. The hard file-size ceiling lives in
// scripts/file-size.test.mjs (shared allowlist: scripts/lint-allowlist.mjs);
// max-lines here is the early warning at 500.
//
// `local/filename-convention` is a rule rather than a test on purpose: naming is
// a per-file property, so the editor can flag it where you are typing instead of
// at the end of a validate run.
import tseslint from 'typescript-eslint'
import local from './eslint-local/index.mjs'

const SCENE_SEAM = {
  group: ['**/scene/src/**'],
  message: 'Import scene modules via @scene/* — that alias is the scene package\u2019s API seam.'
}
const BUS_FUNNEL = {
  group: ['**/bus'],
  message: 'Only the funnels (boot, dev-hmr, actions/*, engine/*, assets, spawn-points) may import the bus; go through actions.'
}
const NO_ACTIONS = {
  group: ['**/actions/*'],
  message: 'This layer sits below the action layer — actions import it, not the other way round (CONVENTIONS.md).'
}
const NO_UI = {
  group: ['**/panels/*', '**/features/*'],
  message: 'The engine bridge must not depend on the editor UI (CONVENTIONS.md).'
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'packages/desktop/staging/**',
      'packages/desktop/release/**',
      'packages/desktop/build/**',
      'packages/desktop/templates/**',
      'packages/desktop/.node-cache/**',
      'packages/scene/bin/**'
    ]
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    plugins: { '@typescript-eslint': tseslint.plugin, local },
    rules: {
      'local/filename-convention': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message:
            'Use a static import. Dynamic import() is allowed only for React.lazy bundle-split boundaries and sandbox-only ~system modules, with a line-disable stating why.'
        }
      ],
      'max-lines': ['warn', { max: 500, skipBlankLines: false, skipComments: false }]
    }
  },
  {
    // ui-side boundaries. no-restricted-imports is REPLACED per config block, not
    // merged, so each block below restates every pattern that applies to it.
    // Default: scene only through the @scene seam, and the editor bus only
    // through its funnels — panels and features go via actions.
    files: ['packages/ui/src/**/*.ts', 'packages/ui/src/**/*.tsx'],
    rules: { 'no-restricted-imports': ['error', { patterns: [SCENE_SEAM, BUS_FUNNEL] }] }
  },
  {
    // core state sits below the action layer: actions import core, never back.
    files: ['packages/ui/src/core/**/*.ts', 'packages/ui/src/core/**/*.tsx'],
    rules: { 'no-restricted-imports': ['error', { patterns: [SCENE_SEAM, BUS_FUNNEL, NO_ACTIONS] }] }
  },
  {
    // The engine bridge is a bus funnel (so no BUS_FUNNEL here) but knows nothing
    // about the editor's UI or command layer. boot/ is the composition root and
    // may import anything. Two back-edges remain, tracked in
    // docs/REFACTOR-PLAN.md: engine/scene-ui -> core, core/autosave -> panels.
    files: ['packages/ui/src/engine/**/*.ts', 'packages/ui/src/engine/**/*.tsx'],
    rules: { 'no-restricted-imports': ['error', { patterns: [SCENE_SEAM, NO_UI, NO_ACTIONS] }] }
  },
  {
    // the remaining bus funnels (boot dispatches; the action layer mutates)
    files: [
      'packages/ui/src/boot/boot.ts',
      'packages/ui/src/boot/dev-hmr.ts',
      'packages/ui/src/actions/*.ts',
      'packages/ui/src/assets.ts',
      'packages/ui/src/spawn-points.ts'
    ],
    rules: { 'no-restricted-imports': ['error', { patterns: [SCENE_SEAM] }] }
    }
)
