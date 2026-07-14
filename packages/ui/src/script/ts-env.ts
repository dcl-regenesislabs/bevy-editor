// Virtual TypeScript environment for the in-app script editor: a real TS
// language service (diagnostics, hover, completions) over an in-memory file
// system. The SDK7 surface comes from @dcl/playground-assets' single rolled-up
// .d.ts (the same file the official SDK playground feeds Monaco), aliased in as
// '@dcl/sdk/ecs' / '@dcl/sdk/math' / '@dcl/sdk/react-ecs'. The runtime globals
// (console, fetch, ~sdk modules) come from the opened project's own
// node_modules/@dcl/js-runtime typings, fetched over the data-layer —
// best-effort: the editor still works untyped if any of this fails.
import ts from 'typescript'
import {
  createSystem,
  createVirtualTypeScriptEnvironment,
  knownLibFilesForCompilerOptions,
  type VirtualTypeScriptEnvironment
} from '@typescript/vfs'
import sdkBundledTypes from '@dcl/playground-assets/dist/index.bundled.d.ts?raw'
import { dataLayerReadFile } from '../datalayer'

// TS default libs, bundled as raw strings (ES chain only — scene scripts run in
// the SDK runtime, so no DOM lib)
const LIB_SOURCES = import.meta.glob(
  [
    '../../../../node_modules/typescript/lib/lib.es5.d.ts',
    '../../../../node_modules/typescript/lib/lib.es20*.d.ts',
    '../../../../node_modules/typescript/lib/lib.esnext*.d.ts',
    '../../../../node_modules/typescript/lib/lib.decorators*.d.ts'
  ],
  { eager: true, query: '?raw', import: 'default' }
) as Record<string, string>

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  lib: ['lib.es2020.d.ts'],
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  jsx: ts.JsxEmit.React,
  jsxFactory: 'ReactEcs.createElement',
  strict: true,
  skipLibCheck: true,
  allowJs: true,
  noEmit: true
}

const SDK_REEXPORT = "export * from '@dcl/playground-assets'\n"

// `import _m0 from 'protobufjs/minimal'` inside the bundled dts — stub it
const PROTOBUF_STUB = `declare namespace _m0 {
  export type Writer = unknown
  export type Reader = unknown
}
export default _m0
`

// static part of the virtual fs (libs + sdk types), built once
let baseMap: Map<string, string> | null = null

function buildBaseMap(): Map<string, string> {
  if (baseMap !== null) return baseMap
  const map = new Map<string, string>()

  const byName = new Map<string, string>()
  for (const [path, source] of Object.entries(LIB_SOURCES)) {
    const name = path.split('/').pop() as string
    byName.set(name, source)
  }
  for (const lib of knownLibFilesForCompilerOptions(COMPILER_OPTIONS, ts)) {
    const source = byName.get(lib)
    if (source !== undefined) map.set(`/${lib}`, source)
  }

  map.set('/node_modules/@dcl/playground-assets/package.json', JSON.stringify({ name: '@dcl/playground-assets', types: 'index.d.ts' }))
  map.set('/node_modules/@dcl/playground-assets/index.d.ts', sdkBundledTypes)
  map.set('/node_modules/@dcl/sdk/package.json', JSON.stringify({ name: '@dcl/sdk', types: 'index.d.ts' }))
  map.set('/node_modules/@dcl/sdk/index.d.ts', SDK_REEXPORT)
  map.set('/node_modules/@dcl/sdk/ecs/index.d.ts', SDK_REEXPORT)
  map.set('/node_modules/@dcl/sdk/math/index.d.ts', SDK_REEXPORT)
  map.set('/node_modules/@dcl/sdk/react-ecs/index.d.ts', SDK_REEXPORT)
  map.set('/node_modules/@dcl/ecs/package.json', JSON.stringify({ name: '@dcl/ecs', types: 'index.d.ts' }))
  map.set('/node_modules/@dcl/ecs/index.d.ts', SDK_REEXPORT)
  map.set('/node_modules/protobufjs/package.json', JSON.stringify({ name: 'protobufjs' }))
  map.set('/node_modules/protobufjs/minimal.d.ts', PROTOBUF_STUB)

  baseMap = map
  return map
}

// The project's runtime globals + ~sdk ambient modules. Fetched once per
// session; empty strings on failure (editor stays usable, just less typed).
let runtimeTypesPromise: Promise<{ globals: string; sdk: string }> | null = null
function projectRuntimeTypes(): Promise<{ globals: string; sdk: string }> {
  if (runtimeTypesPromise === null) {
    runtimeTypesPromise = (async () => {
      const read = async (p: string): Promise<string> => {
        try {
          return await dataLayerReadFile(p)
        } catch {
          return ''
        }
      }
      const [globals, sdk] = await Promise.all([
        read('node_modules/@dcl/js-runtime/index.d.ts'),
        read('node_modules/@dcl/js-runtime/sdk.d.ts')
      ])
      return { globals, sdk }
    })()
  }
  return runtimeTypesPromise
}

export type ScriptTsEnv = { env: VirtualTypeScriptEnvironment; path: string }

// Build a language-service environment for one script file. `scriptPath` is the
// project-relative path; `content` its current source.
export async function createScriptTsEnv(scriptPath: string, content: string): Promise<ScriptTsEnv> {
  const { globals, sdk } = await projectRuntimeTypes()
  const fsMap = new Map(buildBaseMap())
  const path = `/${scriptPath}`
  fsMap.set(path, content === '' ? ' ' : content)
  const roots = [path]
  if (globals !== '') {
    fsMap.set('/dcl-runtime-globals.d.ts', globals)
    roots.push('/dcl-runtime-globals.d.ts')
  }
  if (sdk !== '') {
    fsMap.set('/dcl-runtime-sdk.d.ts', sdk)
    roots.push('/dcl-runtime-sdk.d.ts')
  }
  const system = createSystem(fsMap)
  const env = createVirtualTypeScriptEnvironment(system, roots, ts, COMPILER_OPTIONS)
  return { env, path }
}
