import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// The scene package's sources: scene-runtime imports coming FROM these files get
// redirected to the browser replacements below; `~system/*` is stubbed.
const sceneSrc = path.resolve(here, '../scene/src')
const systemStub = path.resolve(here, 'src/system-stub.ts')
const redirects: Record<string, string> = {
  'bevy-api': path.resolve(here, 'src/bevy-api-web.ts'),
  utils: path.resolve(here, 'src/utils-web.ts'),
  login: path.resolve(here, 'src/login-web.ts'),
  'current-scene': path.resolve(here, 'src/current-scene-web.ts')
}

// Port of the esbuild `scene-shims` plugin: swap scene-runtime modules for their
// browser implementations, but only for imports coming from the scene's own
// sources; stub `~system/*` everywhere.
function sceneShims(): Plugin {
  return {
    name: 'scene-shims',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source.startsWith('~system/')) return systemStub
      if (
        importer !== undefined &&
        importer.startsWith(sceneSrc + path.sep) &&
        /^\.\.?\//.test(source)
      ) {
        const name = source.replace(/^\.\.?\//, '').replace(/\.ts$/, '')
        if (redirects[name] !== undefined) return redirects[name]
      }
      return null
    }
  }
}

export default defineConfig({
  root: here,
  plugins: [sceneShims(), react()],
  define: {
    'process.env.NODE_ENV': '"production"',
    __EDITOR_UI_BUILD__: JSON.stringify(new Date().toISOString())
  },
  server: {
    // the engine iframe needs crossOriginIsolation (wasm threads / SharedArrayBuffer);
    // the embedding host page must be isolated too. Applied to dev responses.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'editor-app': path.resolve(here, 'editor-app.html'),
        // standalone design-system showcase — ships next to the editor bundle
        'design-system': path.resolve(here, 'design-system.html')
      }
    }
  }
})
