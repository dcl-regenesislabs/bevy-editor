// Reading a scene's Script components as data: what the scripts point at.
//
// Scripts refer to other entities BY NAME (a zone's id is its Name), so a name is
// not free just because nothing currently carries it: delete a zone and the
// reactions that named it keep the string. Handing that name to the next entity
// silently re-binds every one of those references to it — a dangling pointer that
// heals into the wrong target.
//
// Deliberately loose: any string param counts, not just ones called "zone". A false
// positive costs a suffix ("Trigger Zone 2"); a false negative costs silent, wrong
// wiring the creator cannot see.
import { SCRIPT_COMPONENT } from '../../../scene/src/allowed-components'
import type { Snapshot } from '../../../scene/src/state'
import { isRecord } from '../prefabs/format'
import { parseLayout } from './parser'

/** One entry of an entity's Script component, as the snapshot stores it. */
export interface ScriptRef {
  path: string
  /** JSON of the parsed constructor signature; absent until the params are read. */
  layout: string | undefined
}

/**
 * The scripts attached to one entity. The snapshot is untyped JSON from the CRDT,
 * so anything malformed is skipped rather than trusted.
 */
export function scriptsOn(snapshot: Snapshot, entityId: string): ScriptRef[] {
  const comp = snapshot[entityId]?.[SCRIPT_COMPONENT]
  if (!isRecord(comp) || !Array.isArray(comp.value)) return []
  const refs: ScriptRef[] = []
  for (const item of comp.value) {
    if (!isRecord(item) || typeof item.path !== 'string') continue
    refs.push({ path: item.path, layout: typeof item.layout === 'string' ? item.layout : undefined })
  }
  return refs
}

// Only string params can hold another entity's name: the editor has no 'zone' param
// type, and an enum's options are fixed choices, not scene names.
/** Every non-empty string a script's params hold, trimmed. */
export function stringParams(layout: string | undefined): string[] {
  const params = parseLayout(layout)?.params ?? {}
  const values: string[] = []
  for (const param of Object.values(params)) {
    if (param.type !== 'string' || typeof param.value !== 'string') continue
    const trimmed = param.value.trim()
    if (trimmed !== '') values.push(trimmed)
  }
  return values
}

/** Every name the scene's scripts still point at. */
export function referencedNames(snapshot: Snapshot): Set<string> {
  const names = new Set<string>()
  for (const id of Object.keys(snapshot)) {
    for (const script of scriptsOn(snapshot, id)) {
      for (const value of stringParams(script.layout)) names.add(value)
    }
  }
  return names
}
