import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// Unit tests for the pure logic in the scene package (transform math, save diff,
// authored-scope predicates). These import @dcl/sdk/math + @dcl/sdk/ecs, which
// resolve under Vite the same way the UI build resolves them — no engine/runtime
// needed because the tested functions never call ~system ops. Run with `npm test`.
export default defineConfig({
  resolve: {
    // same @scene seam the ui build uses (packages/ui/vite.config.ts)
    alias: { '@scene': path.resolve(here, 'packages/scene/src') }
  },
  test: {
    environment: 'node',
    // scripts/ holds repo-level guard tests (file-size gate) next to the
    // config they check
    include: ['packages/**/src/**/*.test.ts', 'scripts/*.test.mjs'],
    // the scene build (sdk-commands) and engine assets are not test inputs.
    // staging/ and release/ are COPIES of packages/scene made while packaging —
    // without them excluded the same tests run three times, and a stale copy can
    // fail a run that the sources pass.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/bin/**',
      'packages/desktop/staging/**',
      'packages/desktop/release/**'
    ]
  }
})
