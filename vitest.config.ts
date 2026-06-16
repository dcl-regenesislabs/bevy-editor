import { defineConfig } from 'vitest/config'

// Unit tests for the pure logic in the scene package (transform math, save diff,
// authored-scope predicates). These import @dcl/sdk/math + @dcl/sdk/ecs, which
// resolve under Vite the same way the UI build resolves them — no engine/runtime
// needed because the tested functions never call ~system ops. Run with `npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts'],
    // the scene build (sdk-commands) and engine assets are not test inputs
    exclude: ['**/node_modules/**', '**/dist/**', '**/bin/**']
  }
})
