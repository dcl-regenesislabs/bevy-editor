import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// Render tests for the React surfaces. Kept apart from the repo's node project
// (vitest.config.ts) on purpose: a DOM environment is ~10x slower to spin up and
// the 1000+ pure-logic tests do not need one. `vitest.workspace.ts` runs both.
export default defineConfig({
  resolve: {
    // same @scene seam the ui build uses (packages/ui/vite.config.ts)
    alias: { '@scene': path.resolve(here, '../scene/src') }
  },
  test: {
    name: 'ui-dom',
    root: here,
    environment: 'happy-dom',
    include: ['src/**/*.test.tsx'],
    setupFiles: [path.resolve(here, 'src/test/setup-dom.ts')]
  }
})
