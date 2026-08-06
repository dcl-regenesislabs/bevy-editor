// Which script params the inspector shows right now. A param whose JSDoc opens
// with `For "<choice>"` belongs to one branch of a sibling dropdown (an enum
// param offering that exact choice), so it only appears while that choice is
// picked. Hiding is display-only: the stored value stays untouched, and a
// description no sibling dropdown can account for fails open (always shown).
import type { ScriptParam } from '../../script/parser'

const CONDITION = /^For "([^"]+)"/

export function paramCondition(param: ScriptParam): string | null {
  if (param.description === undefined) return null
  const match = CONDITION.exec(param.description)
  return match === null ? null : match[1]
}

// The doc line without its `For "<choice>"` opener — what a tooltip or hint
// shows once the condition already did its job.
export function paramHint(param: ScriptParam): string | undefined {
  if (param.description === undefined) return undefined
  const rest = param.description.replace(CONDITION, '').replace(/^[:\s]+/, '')
  return rest === '' ? undefined : rest
}

export function isParamVisible(param: ScriptParam, siblings: Record<string, ScriptParam>): boolean {
  const wanted = paramCondition(param)
  if (wanted === null) return true
  for (const sibling of Object.values(siblings)) {
    if (sibling === param) continue
    if (sibling.type === 'enum' && sibling.options?.includes(wanted) === true) {
      return sibling.value === wanted
    }
  }
  return true
}

export function visibleParams(params: Record<string, ScriptParam>): Array<[string, ScriptParam]> {
  return Object.entries(params).filter(([, param]) => isParamVisible(param, params))
}
