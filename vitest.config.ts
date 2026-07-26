import { defineConfig } from 'vitest/config'

// Unit tests for the pure logic in the scene package (transform math, save diff,
// authored-scope predicates). These import @dcl/sdk/math + @dcl/sdk/ecs, which
// resolve under Vite the same way the UI build resolves them — no engine/runtime
// needed because the tested functions never call ~system ops. Run with `npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts'],
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
