// Renders `src/scripts/spawnables.ts` — the generated registry the runtime clones
// prefabs from — and lints what it is about to emit.
//
// Pure: text in, text out. Nothing here reads the data layer, so the whole file
// is built in memory and the caller (generate.ts) decides whether it is safe to
// write. Every invariant the shape depends on is checked here, because a wrong
// registry does not fail the build — it silently constructs the wrong class, or
// constructs the right one with no arguments.
import { parse } from '@babel/parser'
import { ALLOWED_COMPONENTS } from '@scene/allowed-components'
import { parseLayout } from '../script/parser'
import { aliasFor, compileSnapshot, type SpawnableSnapshot } from './spawnable'
import type { PrefabComposite, PrefabData } from './format'

export const SPAWNABLES_PATH = 'src/scripts/spawnables.ts'
export const SPAWNER_MODULE_PATH = 'src/scripts/runtime/spawner.ts'
/** the registry's own runtime dependency — never a prefab folder's copy */
export const SPAWNER_IMPORT = './runtime/spawner'
/**
 * The spawner signature the emitted `registerSpawnables(SNAPSHOTS, COMPONENTS)`
 * call needs. A copy of the runtime module older than the component table does
 * not have it, and a project holding one has to be re-vendored before the
 * registry is written — see generate.ts.
 */
export const SPAWNER_COMPONENTS_CONTRACT = 'components: Record<string, unknown> = {}'
// the generated Game Config accessor, imported for its side effect only
export const GAME_CONFIG_IMPORT = './game-config'
/** the entity-0 Script row that installs the registry; priority per decision D2 */
export const REGISTRY_PRIORITY = -100
export const REGISTRY_LAYOUT = '{"params":{},"actions":[]}'

export interface SpawnableSource {
  folder: string
  data: PrefabData
  composite: PrefabComposite
}

export interface RenderSpawnablesInput {
  /**
   * Every prefab folder in the project, spawnable or not — a PrefabRef pointing
   * at a prefab that exists but is not Spawnable is a different mistake from one
   * pointing at nothing, and only the full list can tell them apart.
   */
  prefabs: SpawnableSource[]
  /** file text by project-relative path, for the export-shape and param lints */
  scripts: Record<string, string>
  /**
   * `src/scripts/game-config.ts` exists on disk. The registry side-effect-imports
   * it when it does, because nothing else does: the generated accessor publishes
   * itself on `globalThis.__dclGameConfig_v1` at module scope, and a module no
   * bundle entry reaches never runs — every kit prefab would silently fall back
   * to its hard-coded defaults. Keyed on the file, not on the component, so the
   * emitted import can never point at a file that is not there.
   */
  gameConfig?: boolean
  /**
   * Prefab UUIDs picked in prefab-typed script params anywhere in the scene.
   * Every prefab is spawnable; a reference is what ships one — the registry
   * emits a snapshot for each referenced prefab (plus any that still carries the
   * legacy data.json flag), the tree-shaking half of "no toggle to forget".
   */
  referenced?: string[]
}

export interface RenderSpawnablesResult {
  text: string
  problems: string[]
  /**
   * At least one problem makes the emitted file semantically wrong (the runtime
   * would construct a different class than the placed instance does). generate.ts
   * writes nothing in that case, so the last good registry stays on disk.
   */
  blocking: boolean
}

const SCRIPT_EXT = /\.(ts|tsx)$/

function withoutExtension(path: string): string {
  return path.replace(SCRIPT_EXT, '')
}

// `src/scripts` → `custom/zombie_basic/scripts/zombie-brain` becomes
// `../../custom/zombie_basic/scripts/zombie-brain`.
export function relativeImport(fromDir: string, path: string): string {
  const from = fromDir.split('/').filter((s) => s !== '')
  const to = withoutExtension(path).split('/')
  let shared = 0
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared++
  const up = from.length - shared
  const rest = to.slice(shared).join('/')
  return up === 0 ? `./${rest}` : `${'../'.repeat(up)}${rest}`
}

export function moduleIdentifier(path: string): string {
  return `script_${withoutExtension(path).replace(/[^A-Za-z0-9]+/g, '_')}`
}

interface ExportShape {
  functions: string[]
  reexports: boolean
  error?: string
}

function tryParse(text: string): ReturnType<typeof parse> | string {
  try {
    return parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// What `Object.values(module).find(exp => typeof exp === 'function')` would see.
// Syntactic, deliberately: the file is not evaluated here, and a script whose
// class is chosen by a runtime condition is not something a registry can support.
export function exportShape(text: string): ExportShape {
  const functions: string[] = []
  let reexports = false
  const ast = tryParse(text)
  if (typeof ast === 'string') return { functions, reexports, error: ast }

  const localFunctions = new Set<string>()
  for (const statement of ast.program.body) {
    if (statement.type === 'FunctionDeclaration' && statement.id != null) {
      localFunctions.add(statement.id.name)
    }
    if (statement.type === 'ClassDeclaration' && statement.id != null) {
      localFunctions.add(statement.id.name)
    }
    if (statement.type === 'VariableDeclaration') {
      for (const declarator of statement.declarations) {
        if (declarator.id.type !== 'Identifier' || declarator.init == null) continue
        if (isFunctionValued(declarator.init.type)) localFunctions.add(declarator.id.name)
      }
    }
  }

  for (const statement of ast.program.body) {
    if (statement.type === 'ExportAllDeclaration') {
      reexports = true
      continue
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      if (isFunctionValued(statement.declaration.type)) functions.push('default')
      continue
    }
    if (statement.type !== 'ExportNamedDeclaration') continue
    if (statement.exportKind === 'type') continue
    if (statement.source != null) {
      reexports = true
      continue
    }
    const declaration = statement.declaration
    if (declaration != null) {
      if (declaration.type === 'FunctionDeclaration' && declaration.id != null) {
        functions.push(declaration.id.name)
      } else if (declaration.type === 'ClassDeclaration' && declaration.id != null) {
        functions.push(declaration.id.name)
      } else if (declaration.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type !== 'Identifier' || declarator.init == null) continue
          if (isFunctionValued(declarator.init.type)) functions.push(declarator.id.name)
        }
      }
      continue
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ExportSpecifier') continue
      if (specifier.exportKind === 'type') continue
      if (specifier.local.type === 'Identifier' && localFunctions.has(specifier.local.name)) {
        functions.push(
          specifier.exported.type === 'Identifier' ? specifier.exported.name : specifier.local.name
        )
      }
    }
  }
  return { functions, reexports }
}

function isFunctionValued(type: string): boolean {
  return (
    type === 'ArrowFunctionExpression' ||
    type === 'FunctionExpression' ||
    type === 'FunctionDeclaration' ||
    type === 'ClassExpression' ||
    type === 'ClassDeclaration'
  )
}

// `zombie: PrefabRef` / `arenas: PrefabRef[]` in a constructor signature. The
// babel-port parser types both as plain strings today, so the annotation is what
// tells a prefab reference from an ordinary string param.
export function prefabRefParams(text: string): string[] {
  const names: string[] = []
  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*[?]?\s*:\s*PrefabRef\b/g)) {
    if (!names.includes(m[1])) names.push(m[1])
  }
  return names
}

function refValues(value: unknown): string[] {
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter((v) => v !== '')
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return []
}

// --- rendering ---

const CORE_PREFIX = 'core::'

// Every component in @dcl/sdk/ecs is defined behind a /* @__PURE__ */ call, so
// esbuild drops the ones the scene's own code never imports and the engine never
// hears about them. A placed Billboard survives (the composite carries it), a
// CLONE does not: the spawner asks the engine for the definition by name and gets
// null. Naming the export here is what keeps it in the bundle.
//
// Only the components the editor can author are mapped, and only by their SDK
// export name — an import of something the scene's own SDK pin does not export
// would break the build, which is a far worse failure than a missing Billboard.
// Anything else (asset-packs::…, a hand-written composite's own component) is
// left to the engine, where its composite defines it at load.
function sdkComponentExports(snapshots: SpawnableSnapshot[]): Array<[string, string]> {
  const names = new Set<string>()
  for (const snapshot of snapshots) {
    for (const entity of snapshot.entities) {
      for (const component of entity.components) {
        if (!component.name.startsWith(CORE_PREFIX)) continue
        const exported = component.name.slice(CORE_PREFIX.length)
        if (ALLOWED_COMPONENTS.has(exported)) names.add(exported)
      }
    }
  }
  return [...names].sort().map((exported) => [`${CORE_PREFIX}${exported}`, exported])
}

function tsString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

function renderEntity(entity: SpawnableSnapshot['entities'][number]): string {
  const components = entity.components
    .map((c) => `{ name: ${tsString(c.name)}, json: ${JSON.stringify(c.json)} }`)
    .join(', ')
  const parent = entity.parent === null ? 'null' : String(entity.parent)
  return `      { localId: ${entity.localId}, parent: ${parent}, components: [${components}] }`
}

function renderScript(script: SpawnableSnapshot['scripts'][number]): string {
  return [
    '      {',
    `        localId: ${script.localId},`,
    `        path: ${tsString(script.path)},`,
    `        priority: ${script.priority},`,
    `        layout: ${tsString(script.layout)},`,
    `        module: ${moduleIdentifier(script.path)}`,
    '      }'
  ].join('\n')
}

function renderSnapshot(snapshot: SpawnableSnapshot): string {
  const entities = snapshot.entities.map(renderEntity).join(',\n')
  const scripts = snapshot.scripts.map(renderScript).join(',\n')
  return [
    '  {',
    `    prefab: ${tsString(snapshot.prefab)},`,
    `    alias: ${tsString(snapshot.alias)},`,
    `    max: ${snapshot.max},`,
    `    instancing: ${tsString(snapshot.instancing)},`,
    entities === '' ? '    entities: [],' : `    entities: [\n${entities}\n    ],`,
    scripts === '' ? '    scripts: []' : `    scripts: [\n${scripts}\n    ]`,
    '  }'
  ].join('\n')
}

const HEADER = [
  '// GENERATED by Decentraland Studio. Do not edit.',
  "// Regenerated whenever a prefab's Spawnable setting changes or the scene is saved.",
  '// Source of truth: custom/<slug>/data.json (spawnable) + custom/<slug>/composite.json'
]

// A per-player prefab's pool is opened here rather than by whoever placed the
// anchor: the roster is the same for every one of them, so the registry is the
// one place that knows to open it exactly once. The prefab's own script keeps
// its `poolFor(...) === null` fallback for a scene whose registry is stale, and
// the guard here is what lets the two coexist in either start() order.
function renderFooter(snapshots: SpawnableSnapshot[]): string[] {
  const perPlayer = snapshots.filter((s) => s.instancing === 'perPlayer')
  const body =
    perPlayer.length === 0
      ? ['  start(): void {}']
      : [
          '  start(): void {',
          ...perPlayer.map(
            (s) =>
              `    if (poolFor(Spawnables.${s.alias}) === null) perPlayer(Spawnables.${s.alias})`
          ),
          '  }'
        ]
  return [
    'export class SpawnableRegistry {',
    '  constructor(public src: string, public entity: Entity) {}',
    ...body,
    '}'
  ]
}

function renderText(snapshots: SpawnableSnapshot[], scriptPaths: string[], gameConfig: boolean): string {
  const spawnerImports = snapshots.some((s) => s.instancing === 'perPlayer')
    ? 'perPlayer, poolFor, registerSpawnables, type PrefabSnapshot'
    : 'registerSpawnables, type PrefabSnapshot'
  const components = sdkComponentExports(snapshots)
  const ecsImports = ['type Entity', ...components.map(([, exported]) => exported)].join(', ')
  const imports = [
    `import { ${ecsImports} } from '@dcl/sdk/ecs'`,
    `import { ${spawnerImports} } from '${SPAWNER_IMPORT}'`,
    ...(gameConfig ? [`import '${GAME_CONFIG_IMPORT}'   // publishes globalThis.__dclGameConfig_v1`] : []),
    ...scriptPaths.map(
      (path) => `import * as ${moduleIdentifier(path)} from '${relativeImport('src/scripts', path)}'`
    )
  ]
  const aliases = snapshots.map((s) => `  ${s.alias}: ${tsString(s.prefab)} as PrefabRef`).join(',\n')
  const table =
    snapshots.length === 0
      ? 'const SNAPSHOTS: PrefabSnapshot[] = []'
      : `const SNAPSHOTS: PrefabSnapshot[] = [\n${snapshots.map(renderSnapshot).join(',\n')}\n]`
  const componentTable =
    components.length === 0
      ? []
      : [
          '// The components the snapshots name, handed to the runtime so the bundle keeps',
          '// them: an SDK component the scene never imports is tree-shaken away, and a clone',
          '// would silently lose what the placed copy has.',
          `const COMPONENTS: Record<string, unknown> = {\n${components
            .map(([name, exported]) => `  ${tsString(name)}: ${exported}`)
            .join(',\n')}\n}`,
          ''
        ]
  return [
    ...HEADER,
    ...imports,
    '',
    'export type PrefabRef = string & { readonly __prefabRef: unique symbol }',
    '',
    aliases === ''
      ? 'export const Spawnables = {} as const'
      : `export const Spawnables = {\n${aliases}\n} as const`,
    '',
    table,
    '',
    ...componentTable,
    components.length === 0
      ? 'registerSpawnables(SNAPSHOTS)   // MODULE SCOPE — see decision D2'
      : 'registerSpawnables(SNAPSHOTS, COMPONENTS)   // MODULE SCOPE — see decision D2',
    '',
    ...renderFooter(snapshots),
    ''
  ].join('\n')
}

// --- lint ---

function lintScripts(
  snapshots: SpawnableSnapshot[],
  input: RenderSpawnablesInput,
  spawnableIds: Map<string, string>,
  problems: string[]
): boolean {
  const allIds = new Map(input.prefabs.map((p) => [p.data.id, p.data.name]))
  let blocking = false
  const linted = new Set<string>()
  for (const snapshot of snapshots) {
    for (const script of snapshot.scripts) {
      const layout = parseLayout(script.layout)
      for (const [name, param] of Object.entries(layout?.params ?? {})) {
        if (param.type === 'action') {
          problems.push(
            `${script.path}: param \`${name}\` is an action — action params are not supported on spawnable clones in v1 and will be ignored.`
          )
        }
      }
      if (linted.has(script.path)) continue
      linted.add(script.path)

      const text = input.scripts[script.path]
      if (text === undefined) {
        problems.push(`${script.path}: could not be read, so its exports were not checked.`)
        continue
      }
      const shape = exportShape(text)
      if (shape.error !== undefined) {
        problems.push(`${script.path}: could not be parsed — ${shape.error}`)
        blocking = true
        continue
      }
      if (shape.functions.length !== 1) {
        const found = shape.functions.length === 0 ? 'none' : shape.functions.join(', ')
        problems.push(
          `${script.path}: a spawnable prefab's script must export exactly one class — the runtime constructs the first function-valued export (found ${found}).`
        )
        blocking = true
      }
      if (shape.reexports) {
        problems.push(
          `${script.path}: re-exports another module — the runtime picks the first function-valued export, which may not be this script's class.`
        )
      }

      for (const name of prefabRefParams(text)) {
        for (const id of refValues(layout?.params?.[name]?.value)) {
          if (spawnableIds.has(id)) continue
          const known = allIds.get(id)
          problems.push(
            known === undefined
              ? `${script.path}: param \`${name}\` points at a prefab that is not in this project.`
              : `${script.path}: param \`${name}\` points at ${known}, which is not Spawnable — turn Spawnable on for it, or clear the param.`
          )
        }
      }
    }
  }
  return blocking
}

// `Spawnables.ZombieBasic` in a hand- or AI-written script is a reference too:
// nothing else declares the intent, so the usage itself ships the snapshot.
function aliasesUsedInScripts(scripts: Record<string, string>): Set<string> {
  const used = new Set<string>()
  for (const text of Object.values(scripts)) {
    for (const m of text.matchAll(/\bSpawnables\.([A-Za-z_$][\w$]*)/g)) used.add(m[1])
  }
  return used
}

export function renderSpawnables(input: RenderSpawnablesInput): RenderSpawnablesResult {
  const problems: string[] = []
  const referenced = new Set(input.referenced ?? [])
  const usedAliases = aliasesUsedInScripts(input.scripts)
  const sources = input.prefabs
    .filter(
      (p) =>
        p.data.spawnable !== undefined ||
        referenced.has(p.data.id) ||
        usedAliases.has(aliasFor(p.data.name))
    )
    .sort((a, b) => a.folder.localeCompare(b.folder))

  const snapshots: SpawnableSnapshot[] = []
  const aliases = new Map<string, string>()
  for (const source of sources) {
    const snapshot = compileSnapshot({
      folder: source.folder,
      data: source.data,
      composite: source.composite,
      scripts: input.scripts
    })
    if (snapshot === null) continue
    const owner = aliases.get(snapshot.alias)
    if (owner !== undefined) {
      const unique = aliasFor(snapshot.alias, aliases.keys())
      problems.push(
        `${source.folder} and ${owner} both read as \`${snapshot.alias}\` — this one is exposed as \`${unique}\`. Rename one of them.`
      )
      snapshot.alias = unique
    }
    aliases.set(snapshot.alias, source.folder)
    snapshots.push(snapshot)
  }

  const spawnableIds = new Map(snapshots.map((s) => [s.prefab, s.alias]))
  const scriptPaths: string[] = []
  for (const snapshot of snapshots) {
    for (const script of snapshot.scripts) {
      if (!scriptPaths.includes(script.path)) scriptPaths.push(script.path)
    }
  }

  // one script attached to two entities of the same prefab reports its problems
  // twice; the creator gets one line per distinct thing to fix
  const blocking = lintScripts(snapshots, input, spawnableIds, problems)
  return {
    text: renderText(snapshots, scriptPaths, input.gameConfig === true),
    problems: [...new Set(problems)],
    blocking
  }
}
