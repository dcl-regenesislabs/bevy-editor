// esbuild bundler for the host-page editor UI.
// Bundles web-ui/src/main.tsx together with the scene's logic modules (../src)
// into a single IIFE served by bevy-explorer's web shell.
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const outfile = path.resolve(
  here,
  '../../../bevy-explorer/deploy/web/editor-ui.js'
)

// In the scene runtime '~system/*' modules are provided by the host; in the
// browser bundle they must not be resolved. Anything reachable that imports
// them gets an empty stub (calls into them are never executed page-side).
// './bevy-api' is swapped for the browser transport (console commands + bus).
const sceneSrc = path.resolve(here, '../scene/src')

// modules that have a scene-runtime dependency and a browser replacement
const redirects = {
  'bevy-api': path.resolve(here, 'src/bevy-api-web.ts'),
  utils: path.resolve(here, 'src/utils-web.ts'),
  login: path.resolve(here, 'src/login-web.ts'),
  'current-scene': path.resolve(here, 'src/current-scene-web.ts')
}

const shims = {
  name: 'scene-shims',
  setup(build) {
    build.onResolve({ filter: /^~system\// }, (args) => ({
      path: args.path,
      namespace: 'system-stub'
    }))
    build.onLoad({ filter: /.*/, namespace: 'system-stub' }, () => ({
      contents: 'module.exports = {}',
      loader: 'js'
    }))
    // swap scene-runtime modules for web implementations, but only for
    // imports coming from the scene's own sources (../src)
    build.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (!args.importer.startsWith(sceneSrc + path.sep)) return null
      const name = args.path.replace(/^\.\.?\//, '').replace(/\.ts$/, '')
      const target = redirects[name]
      return target !== undefined ? { path: target } : null
    })
  }
}

const common = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: 'inline',
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
    __EDITOR_UI_BUILD__: JSON.stringify(new Date().toISOString())
  },
  plugins: [shims],
  logLevel: 'info'
}

// in-page editor (engine + UI share the window)
const config = {
  ...common,
  entryPoints: [path.resolve(here, 'src/main.tsx')],
  outfile
}

// host-app editor (UI in this window, engine in a same-origin iframe) — used
// by the electron shell and by browser tabs pointed at editor-app.html
const hostOutfile = path.resolve(here, '../../../bevy-explorer/deploy/web/editor-app.js')
const hostConfig = {
  ...common,
  entryPoints: [path.resolve(here, 'src/main-embed.tsx')],
  outfile: hostOutfile
}

const hostHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bevy Scene Editor</title>
  <style>html, body { margin: 0; background: hsl(240 6% 10%); }</style>
</head>
<body>
  <script src="editor-app.js"></script>
</body>
</html>
`
fs.writeFileSync(path.resolve(here, '../../../bevy-explorer/deploy/web/editor-app.html'), hostHtml)

if (process.argv.includes('--watch')) {
  for (const c of [config, hostConfig]) {
    const ctx = await esbuild.context(c)
    await ctx.watch()
  }
  console.log(`watching; bundling to ${outfile} and ${hostOutfile}`)
} else {
  await esbuild.build(config)
  await esbuild.build(hostConfig)
}
