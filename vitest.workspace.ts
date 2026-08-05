import { defineWorkspace } from 'vitest/config'

// Two projects, one `npm test`: the node project (vitest.config.ts) runs every
// pure-logic `.test.ts`, the ui-dom project mounts the React surfaces in
// happy-dom. Split because the environments differ, not the code under test.
export default defineWorkspace(['./vitest.config.ts', './packages/ui/vitest.dom.config.ts'])
