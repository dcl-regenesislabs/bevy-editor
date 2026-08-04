// Shape-driven editor: walks the snapshot value itself, for components the
// engine has no schema for.
import { isColor, isRecord, isVector, joinPath } from '@scene/fields'
import { BoolField, ChannelsField, ColorField, type Commit, Prop, ScrubNumberField, StringField, prettyLabel } from './fields'

// ---------- shape-driven editor (no schema) ----------

export function ShapeEditor(props: {
  cKey: string
  value: unknown
  commit: Commit
}): JSX.Element {
  return <ShapeNode cKey={props.cKey} path="" value={props.value} commit={props.commit} label={null} />
}

function ShapeNode(props: {
  cKey: string
  path: string
  value: unknown
  commit: Commit
  label: string | null
}): JSX.Element {
  const { cKey, path, value, commit, label } = props

  if (isColor(value)) {
    return (
      <Prop label={label ?? 'color'}>
        <ColorField cKey={cKey} path={path} base={value} hasAlpha={'a' in value} commit={commit} />
      </Prop>
    )
  }
  if (isVector(value)) {
    const v = value as Record<string, unknown>
    const channels = ['x', 'y', 'z', 'w'].filter((c) => c in v)
    return (
      <Prop label={label ?? 'value'}>
        <ChannelsField cKey={cKey} path={path} channels={channels} base={v} commit={commit} />
      </Prop>
    )
  }
  if (Array.isArray(value)) {
    return (
      <>
        <div className="eui-group-label">
          {prettyLabel(label ?? 'items')} ({value.length})
        </div>
        <div className="eui-group">
          {value.map((el, i) => (
            <ShapeNode key={i} cKey={cKey} path={joinPath(path, i)} value={el} commit={commit} label={`#${i}`} />
          ))}
          {value.length === 0 && <div style={{ color: 'hsl(var(--text-3))', fontSize: 11 }}>empty</div>}
        </div>
      </>
    )
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
    const inner = entries.map(([k, v]) => (
      <ShapeNode key={k} cKey={cKey} path={joinPath(path, k)} value={v} commit={commit} label={k} />
    ))
    if (label === null) return <>{inner}</>
    return (
      <>
        <div className="eui-group-label">{prettyLabel(label)}</div>
        <div className="eui-group">{inner}</div>
      </>
    )
  }
  if (typeof value === 'number') {
    return (
      <Prop label={label ?? 'value'}>
        <ScrubNumberField cKey={cKey} path={path} fallback={value} commit={commit} />
      </Prop>
    )
  }
  if (typeof value === 'boolean') {
    return (
      <Prop label={label ?? 'value'}>
        <BoolField cKey={cKey} path={path} fallback={value} commit={commit} />
      </Prop>
    )
  }
  if (typeof value === 'string') {
    return (
      <Prop label={label ?? 'value'}>
        <StringField cKey={cKey} path={path} fallback={value} commit={commit} />
      </Prop>
    )
  }
  return (
    <Prop label={label ?? 'value'}>
      <span style={{ color: 'hsl(var(--text-3))' }}>{String(value)}</span>
    </Prop>
  )
}
