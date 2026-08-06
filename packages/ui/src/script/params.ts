// Setting script params from outside the inspector: the assistant's turn-end
// requests, and the right-click gestures that place a prefab already configured.
//
// Two entry points, one write. `setScriptParams` takes the loose JSON scalars a
// request file carries and coerces each one against the param's declared type;
// `writeScriptParamValues` takes values that are already the right type and skips
// coercion entirely — which is the only way to reach an `entity` param, since
// coercion refuses those by name (an entity id is not something the assistant can
// resolve from a sentence, but a gesture that just clicked the entity knows it).
//
// Both funnel into one pass: parse each Script row's layout once, fold every
// param into it, and make a SINGLE component write. That matters beyond
// tidiness — one write is one undo step, so a gesture that sets four params is
// one ⌘Z, not four.
import { state, componentKey } from '@scene/state'
import { entityName } from '@scene/custom-components'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import { uiSetComponentValue } from '../actions/components'
import { resolvePrefabRef, type ParamValue, type PrefabRefChoice } from '../ai/request-format'
import { scriptItems } from './attach'
import { parseLayout, type ScriptLayout, type ScriptParam } from './parser'

type Coerced = { value: ScriptParam['value'] } | { problem: string }

function labelOf(entityId: string): string {
  return entityName(state.snapshot, entityId) ?? `#${entityId}`
}

// One prefab name from the assistant → the UUID a `PrefabRef` param stores.
function coerceRef(value: ParamValue, prefabs: PrefabRefChoice[]): { id: string } | { problem: string } {
  if (typeof value !== 'string') return { problem: 'expects one prefab name, not a list' }
  return resolvePrefabRef(value, prefabs)
}

// A request carries JSON scalars; a param carries a declared type. Coerce where
// the intent is unambiguous, refuse WITH A REASON where it isn't — a silently
// wrong enum is the failure mode this whole feature exists to avoid, and a
// refusal the assistant cannot read is one it will repeat next turn.
function coerce(param: ScriptParam, value: ParamValue, prefabs: PrefabRefChoice[]): Coerced {
  switch (param.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(n) ? { value: n } : { problem: `expects a number, not ${JSON.stringify(value)}` }
    }
    case 'boolean':
      if (typeof value === 'boolean') return { value }
      if (value === 'true') return { value: true }
      if (value === 'false') return { value: false }
      return { problem: 'expects true or false' }
    case 'enum': {
      const s = String(value)
      if (param.options?.includes(s) === true) return { value: s }
      return { problem: `only accepts ${(param.options ?? []).map((o) => `"${o}"`).join(', ')}` }
    }
    case 'string':
      return { value: Array.isArray(value) ? value.join(', ') : String(value) }
    case 'prefab': {
      const resolved = coerceRef(value, prefabs)
      return 'problem' in resolved ? resolved : { value: resolved.id }
    }
    case 'prefabList': {
      // A comma-separated string is what a pre-typed layout held, so both read.
      const wanted = Array.isArray(value) ? value : String(value).split(',')
      const ids: string[] = []
      for (const entry of wanted) {
        const resolved = coerceRef(entry, prefabs)
        if ('problem' in resolved) return resolved
        if (resolved.id !== '' && !ids.includes(resolved.id)) ids.push(resolved.id)
      }
      return { value: ids }
    }
    default:
      // entity / action refs point at other entities — not settable by name
      return { problem: 'is an entity picker, which only the inspector can set' }
  }
}

// Set params by name across whichever of the entity's scripts declare them,
// through the Script component's own update path (the same write the inspector's
// param fields and its ↻ refresh make). Answers with the names that landed, so a
// caller can say what it actually changed.
async function applyParams<V>(
  entityId: string,
  values: Record<string, V>,
  resolve: (param: ScriptParam, value: V) => Coerced,
  problems: string[]
): Promise<string[]> {
  const items = scriptItems(entityId)
  if (items.length === 0) {
    problems.push(`"${labelOf(entityId)}" has no script, so its settings were left alone`)
    return []
  }
  // A param that exists but would not take the value gets ITS OWN reason;
  // "no setting called X" is reserved for a name no script on the entity has.
  const missing = new Set(Object.keys(values))
  const refused = new Map<string, string>()
  let changed = false
  const next = items.map((item) => {
    const layout = parseLayout(item.layout)
    if (layout === undefined) return item
    const params = { ...layout.params }
    let touched = false
    for (const [name, value] of Object.entries(values)) {
      const param = params[name]
      if (param === undefined) continue
      const coerced = resolve(param, value)
      if ('problem' in coerced) {
        refused.set(name, coerced.problem)
        continue
      }
      missing.delete(name)
      refused.delete(name)
      params[name] = { ...param, value: coerced.value }
      touched = true
    }
    if (!touched) return item
    changed = true
    const updated: ScriptLayout = { ...layout, params }
    return { ...item, layout: JSON.stringify(updated) }
  })
  if (changed) {
    await uiSetComponentValue(
      componentKey(entityId, SCRIPT_COMPONENT),
      entityId,
      SCRIPT_COMPONENT,
      JSON.stringify({ value: next })
    )
  }
  for (const name of missing) {
    const reason = refused.get(name)
    problems.push(
      reason === undefined
        ? `"${labelOf(entityId)}" has no setting called "${name}"`
        : `"${name}" on "${labelOf(entityId)}" ${reason}`
    )
  }
  return Object.keys(values).filter((name) => !missing.has(name))
}

/** Coerces by name (prefab refs resolve, entity refs are refused), then writes. */
export async function setScriptParams(
  entityId: string,
  values: Record<string, ParamValue>,
  prefabs: PrefabRefChoice[],
  problems: string[]
): Promise<string[]> {
  return applyParams(entityId, values, (param, value) => coerce(param, value, prefabs), problems)
}

/**
 * Values that are already the type the param declares, written as given.
 *
 * The caller has resolved everything a name could not: an `entity` param takes
 * the entity id it just clicked, an `enum` takes one of its own options. Nothing
 * is guessed here, which is exactly why this path can write what `setScriptParams`
 * has to refuse.
 */
export async function writeScriptParamValues(
  entityId: string,
  values: Record<string, ScriptParam['value']>,
  problems: string[]
): Promise<string[]> {
  return applyParams(entityId, values, (_param, value) => ({ value }), problems)
}
