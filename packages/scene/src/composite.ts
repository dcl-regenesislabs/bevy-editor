// Build an on-disk main.composite from authored component data. The format (CompositeDefinition
// JSON via Composite.toJson) is:
//   { version, components: [ { name, jsonSchema, data: { "<entityId>": { "json": <value> } } } ] }
// Every component embeds its jsonSchema (protocol and custom alike), so a name -> SDK definition
// map is needed to recover each component's composite name (e.g. "core::Transform") and schema.

import * as ecs from '@dcl/sdk/ecs'
import { Composite } from '@dcl/sdk/ecs'
import { customComponentDefs, isCustomComponent } from './custom-components'
import { state } from './state'

type CompositeDef = { componentName: string; jsonSchema: unknown }

// snapshot component name -> { composite name, jsonSchema }. Protocol components are keyed by
// their SDK export name (which matches the engine registry / snapshot name); custom components by
// their namespaced componentName (which is the snapshot name after decode).
const DEFS = new Map<string, CompositeDef>()

function isComponentDef(
  v: unknown
): v is { componentName: string; schema: { jsonSchema: unknown } } {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const schema = o.schema as Record<string, unknown> | undefined
  return (
    typeof o.componentName === 'string' &&
    typeof schema === 'object' &&
    schema !== null &&
    'jsonSchema' in schema
  )
}

for (const [key, val] of Object.entries(ecs as Record<string, unknown>)) {
  if (isComponentDef(val)) {
    DEFS.set(key, { componentName: val.componentName, jsonSchema: val.schema.jsonSchema })
  }
}
for (const d of customComponentDefs()) {
  DEFS.set(d.componentName, d)
}

type AuthoredData = Record<string, Record<string, unknown>>

// Entities 1..511 are reserved for the engine (player, camera, etc.) — they're referenced by
// scenes but never authored, and writing scene components onto them breaks composite instancing.
// The authored set is the root (0) plus scene entities (>=512).
export function isAuthoredEntity(eid: number): boolean {
  return eid === 0 || eid >= 512
}

// Whether a component is one we can author into a composite: we must have its SDK definition (for
// the schema), and it must be authored rather than engine-managed. Custom components
// (asset-packs/inspector/core-schema) are always authored; protocol components only if the engine
// reports them writable (i.e. they have a scene-write CRDT interface — `/component_names`). That
// drops the engine→scene state/results (TweenState, RaycastResult, RealmInfo, …) automatically.
export function isSavableComponent(name: string): boolean {
  if (!DEFS.has(name)) return false
  return isCustomComponent(name) || state.componentNames.includes(name)
}

const INSPECTOR_NODES = 'inspector::Nodes'

// inspector::Nodes flat tree entry; children are entity ids. ROOT is entity 0.
type Node = { entity: number; open?: boolean; children: number[] }

// Regenerate the inspector::Nodes tree from the authored Transform hierarchy: a root (entity 0)
// node plus a node per authored entity, each listing its direct children (by Transform.parent).
// Derived fresh at save time from exactly what's being written, so it always matches the saved
// scene (and the dialog's per-component choices) rather than drifting and without ever being a
// tracked session edit. Order is by entity id (we don't track the Hub's manual ordering); `open` is
// omitted.
function buildNodes(authored: AuthoredData): Node[] {
  const ids = Object.keys(authored)
    .map(Number)
    .filter((e) => Number.isFinite(e) && isAuthoredEntity(e) && e !== 0)
    .sort((a, b) => a - b)
  const childrenOf = new Map<number, number[]>()
  for (const eid of ids) {
    const t = authored[String(eid)].Transform as { parent?: number } | undefined
    const parent = t?.parent ?? 0
    const list = childrenOf.get(parent)
    if (list) list.push(eid)
    else childrenOf.set(parent, [eid])
  }
  const nodes: Node[] = [{ entity: 0, children: childrenOf.get(0) ?? [] }]
  for (const eid of ids) nodes.push({ entity: eid, children: childrenOf.get(eid) ?? [] })
  return nodes
}

// Build the main.composite JSON string from authored {entityId: {componentName: value}} data.
// Reserved entities and non-savable (engine-managed / unknown) components are skipped.
export function buildComposite(authored: AuthoredData): string {
  type Comp = {
    name: string
    jsonSchema: unknown
    data: Map<number, { data: { $case: 'json'; json: unknown } }>
  }
  const byComponent = new Map<string, Comp>()

  for (const [entityId, comps] of Object.entries(authored)) {
    const eid = Number(entityId)
    if (!Number.isFinite(eid) || !isAuthoredEntity(eid)) continue
    for (const [name, value] of Object.entries(comps)) {
      if (!isSavableComponent(name)) continue
      const def = DEFS.get(name)
      if (def === undefined) continue
      let comp = byComponent.get(def.componentName)
      if (comp === undefined) {
        comp = { name: def.componentName, jsonSchema: def.jsonSchema, data: new Map() }
        byComponent.set(def.componentName, comp)
      }
      comp.data.set(eid, { data: { $case: 'json', json: value } })
    }
  }

  // Regenerate inspector::Nodes from the Transform hierarchy, overriding any value carried in
  // `authored` — so the saved tree matches exactly what's being written.
  const nodesDef = DEFS.get(INSPECTOR_NODES)
  if (nodesDef !== undefined) {
    let comp = byComponent.get(nodesDef.componentName)
    if (comp === undefined) {
      comp = { name: nodesDef.componentName, jsonSchema: nodesDef.jsonSchema, data: new Map() }
      byComponent.set(nodesDef.componentName, comp)
    }
    comp.data.set(0, { data: { $case: 'json', json: { value: buildNodes(authored) } } })
  }

  const definition = {
    version: 1,
    components: [...byComponent.values()]
  } as unknown as Composite.Definition

  return JSON.stringify(Composite.toJson(definition))
}

// Names present in `authored` that aren't savable (so they're skipped) — surfaced so the editor
// can warn which components weren't persisted.
export function unknownComponentNames(authored: AuthoredData): string[] {
  const unknown = new Set<string>()
  for (const [entityId, comps] of Object.entries(authored)) {
    if (!isAuthoredEntity(Number(entityId))) continue
    for (const name of Object.keys(comps)) {
      if (!isSavableComponent(name)) unknown.add(name)
    }
  }
  return [...unknown]
}
