// Builds the electron main + preload (TypeScript → dist/, CommonJS).
// The renderer is NOT built here: it is editor-scene/web-ui's `editor-app`
// bundle, served from bevy-explorer/deploy/web (npm run build:ui).
import * as esbuild from 'esbuild'

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // typescript stays external: the UI round-trip parser require()s it at runtime
  // (it's large and resolves from node_modules), so don't bundle it into main.cjs.
  external: ['electron', 'typescript'],
  sourcemap: true,
  logLevel: 'info'
}

await esbuild.build({
  ...common,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs'
})

await esbuild.build({
  ...common,
  entryPoints: ['src/preload.ts'],
  outfile: 'dist/preload.cjs'
})
