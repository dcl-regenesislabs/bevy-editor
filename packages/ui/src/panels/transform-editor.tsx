// The dedicated Transform editor: euler degrees over a quaternion, with the
// scrubbing number fields and the zone-aware size row.
import { TRIGGER_AREA } from '@scene/allowed-components'
import { currentNumberText } from '@scene/fields'
import { componentKey, deleteFieldEditsWhere, state } from '@scene/state'
import { Prop, ScrubNumberField } from './fields'
import { eulerToQuat, quatToEuler, type Q, type V3 } from '../lib/euler'

// ---------- dedicated Transform editor (euler degrees, scrubbing) ----------

export function TransformEditor(props: {
  entityId: string
  value: Record<string, unknown>
  apply: (json: string) => void
}): JSX.Element {
  const { entityId, value, apply } = props
  const pos = (value.position ?? { x: 0, y: 0, z: 0 }) as V3
  const rotQ = (value.rotation ?? { x: 0, y: 0, z: 0, w: 1 }) as Q
  const scale = (value.scale ?? { x: 1, y: 1, z: 1 }) as V3
  const parent = typeof value.parent === 'number' ? value.parent : 0
  const euler = quatToEuler(rotQ)
  const isZone = state.snapshot[entityId]?.[TRIGGER_AREA] !== undefined

  // local edits keyed off the snapshot value; commit builds the full Transform
  const cKey = `${componentKey(entityId, 'Transform')}#t`
  const read = (path: string, fb: number): number => {
    const t = currentNumberText(cKey, path, fb)
    const n = parseFloat(t)
    return Number.isNaN(n) ? fb : n
  }
  const commit = (): void => {
    const e = { x: read('rot.x', euler.x), y: read('rot.y', euler.y), z: read('rot.z', euler.z) }
    const next = {
      position: { x: read('pos.x', pos.x), y: read('pos.y', pos.y), z: read('pos.z', pos.z) },
      rotation: eulerToQuat(e),
      scale: { x: read('scl.x', scale.x), y: read('scl.y', scale.y), z: read('scl.z', scale.z) },
      parent
    }
    // clear local edits; the apply round-trip re-renders from the snapshot
    deleteFieldEditsWhere((k) => k.startsWith(`${cKey}::`))
    apply(JSON.stringify(next))
  }

  const row = (label: string, prefix: string, v: V3): JSX.Element => (
    <Prop label={label}>
      {(['x', 'y', 'z'] as const).map((ax) => (
        <ScrubNumberField
          key={ax}
          cKey={cKey}
          path={`${prefix}.${ax}`}
          fallback={v[ax]}
          commit={commit}
          axis={ax}
        />
      ))}
    </Prop>
  )

  return (
    <>
      {row('position', 'pos', pos)}
      {row('rotation °', 'rot', euler)}
      {row(isZone ? 'size (m)' : 'scale', 'scl', scale)}
    </>
  )
}
