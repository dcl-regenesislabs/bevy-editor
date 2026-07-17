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

// @alpha engine helpers that @dcl/playground-assets strips from its public
// rolled-up .d.ts (api-extractor drops @alpha members — grep the bundle for
// "Excluded from this release type"), but that the editor runtime and the
// project's own @dcl/ecs expose. VS Code sees them because it resolves the
// project's real @dcl/ecs (a ~500-file .d.ts tree); the editor uses the SDK's
// single-file rollup, so we re-declare the alpha members here — signatures
// copied verbatim from @dcl/ecs/dist/engine/types.d.ts. Add more as needed.
const ENGINE_ALPHA_AUGMENT = `import type { Entity } from '@dcl/playground-assets'
declare module '@dcl/playground-assets' {
  interface IEngine {
    /** @alpha Search for the entity that matches the label defined in the editor. */
    getEntityOrNullByName<T = string>(label: T): Entity | null
  }
}
`

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
  map.set('/dcl-engine-alpha.d.ts', ENGINE_ALPHA_AUGMENT)

  baseMap = map
  return map
}

// The project's runtime globals + ambient modules, from its own
// node_modules/@dcl/js-runtime (fetched once per session; empty strings on
// failure — editor stays usable, just less typed):
//   index.d.ts → runtime globals (console, fetch, …)
//   sdk.d.ts   → ~sdk/* modules
//   apis.d.ts  → ~system/* modules (RestrictedActions, Runtime, …) — the file
//                that makes `import … from '~system/…'` resolve
let runtimeTypesPromise: Promise<{ globals: string; sdk: string; apis: string }> | null = null
function projectRuntimeTypes(): Promise<{ globals: string; sdk: string; apis: string }> {
  if (runtimeTypesPromise === null) {
    runtimeTypesPromise = (async () => {
      const read = async (p: string): Promise<string> => {
        try {
          return await dataLayerReadFile(p)
        } catch {
          return ''
        }
      }
      const [globals, sdk, apis] = await Promise.all([
        read('node_modules/@dcl/js-runtime/index.d.ts'),
        read('node_modules/@dcl/js-runtime/sdk.d.ts'),
        read('node_modules/@dcl/js-runtime/apis.d.ts')
      ])
      return { globals, sdk, apis }
    })()
  }
  return runtimeTypesPromise
}

export type ScriptTsEnv = { env: VirtualTypeScriptEnvironment; path: string }

// Build a language-service environment for one script file. `scriptPath` is the
// project-relative path; `content` its current source.
export async function createScriptTsEnv(scriptPath: string, content: string): Promise<ScriptTsEnv> {
  const { globals, sdk, apis } = await projectRuntimeTypes()
  const fsMap = new Map(buildBaseMap())
  const path = `/${scriptPath}`
  fsMap.set(path, content === '' ? ' ' : content)
  // the alpha augmentation must be a program root so its declaration-merge takes
  const roots = [path, '/dcl-engine-alpha.d.ts']
  if (globals !== '') {
    fsMap.set('/dcl-runtime-globals.d.ts', globals)
    roots.push('/dcl-runtime-globals.d.ts')
  }
  if (sdk !== '') {
    fsMap.set('/dcl-runtime-sdk.d.ts', sdk)
    roots.push('/dcl-runtime-sdk.d.ts')
  }
  if (apis !== '') {
    fsMap.set('/dcl-runtime-apis.d.ts', apis) // ~system/* modules (RestrictedActions, …)
    roots.push('/dcl-runtime-apis.d.ts')
  }
  const system = createSystem(fsMap)
  const env = createVirtualTypeScriptEnvironment(system, roots, ts, COMPILER_OPTIONS)
  return { env, path }
}
