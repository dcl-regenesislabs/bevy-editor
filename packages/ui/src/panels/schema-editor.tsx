// Schema-driven editor: walks the /component_schema tree (enums, oneofs,
// channels, ranges) — the mode used whenever the component has a schema.
import { Select } from '../ds'
import { isRecord, joinPath } from '@scene/fields'
import { type ComponentSchema, type EnumValues, type SchemaNode, activeCase, effectiveDefault, setCase, valueAt } from '@scene/schema'
import { BitmaskField, BoolField, ChannelsField, ColorField, type Commit, EnumField, Prop, ScrubNumberField, StringField, prettyEnumValues, prettyLabel } from './fields'

// ---------- schema-driven editor ----------

const CHANNELS: Record<string, string[]> = {
  color3: ['r', 'g', 'b'],
  color4: ['r', 'g', 'b', 'a'],
  vector2: ['x', 'y'],
  vector3: ['x', 'y', 'z'],
  quaternion: ['x', 'y', 'z', 'w']
}

export function SchemaEditor(props: {
  cKey: string
  schema: ComponentSchema
  value: unknown
  commit: Commit
}): JSX.Element {
  const { cKey, schema, value, commit } = props
  return <SchemaNodeView cKey={cKey} node={schema.root} path="" value={value} enums={schema.enums} commit={commit} label={null} />
}

function SchemaNodeView(props: {
  cKey: string
  node: SchemaNode
  path: string
  value: unknown
  enums: Record<string, EnumValues>
  commit: Commit
  label: string | null
}): JSX.Element | null {
  const { cKey, node, path, value, enums, commit, label } = props

  switch (node.kind) {
    case 'message': {
      const inner = node.fields.map((f) => (
        <SchemaNodeView
          key={f.name}
          cKey={cKey}
          node={f}
          path={joinPath(path, f.name ?? '')}
          value={value}
          enums={enums}
          commit={commit}
          label={f.name ?? ''}
        />
      ))
      if (label === null) return <>{inner}</>
      return (
        <>
          <div className="eui-group-label">{prettyLabel(label)}</div>
          <div className="eui-group">{inner}</div>
        </>
      )
    }
    case 'oneof': {
      const active = activeCase(cKey, path, node, value)
      const c = node.cases.find((x) => x.name === active)
      return (
        <>
          <Prop label={label ?? 'mode'}>
            <Select
              compact
              value={active ?? ''}
              options={node.cases.map((x) => ({ value: x.name, label: prettyLabel(x.name) }))}
              onChange={(v) => {
                setCase(cKey, path, v)
                commit()
              }}
            />
          </Prop>
          {c !== undefined && (
            <div className="eui-group">
              <SchemaNodeView
                cKey={cKey}
                node={c.field}
                path={joinPath(path, c.name)}
                value={value}
                enums={enums}
                commit={commit}
                label={null}
              />
            </div>
          )}
        </>
      )
    }
    case 'repeated': {
      const cur = valueAt(value, path)
      const arr = Array.isArray(cur) ? cur : []
      return (
        <>
          <div className="eui-group-label">
            {prettyLabel(label ?? 'items')} ({arr.length})
          </div>
          <div className="eui-group">
            {arr.map((_, i) => (
              <SchemaNodeView
                key={i}
                cKey={cKey}
                node={node.element}
                path={joinPath(path, String(i))}
                value={value}
                enums={enums}
                commit={commit}
                label={`#${i}`}
              />
            ))}
            {arr.length === 0 && <div style={{ color: 'hsl(var(--text-3))', fontSize: 11 }}>empty</div>}
          </div>
        </>
      )
    }
    case 'leaf':
      return <SchemaLeaf cKey={cKey} node={node} path={path} value={value} enums={enums} commit={commit} label={label ?? ''} />
  }
}

// Exported for the curated views (views/curated.tsx), which reuse the exact
// leaf semantics (defaults, optionals, channel widgets) and only override
// enums/sliders/masks on top.
export function SchemaLeaf(props: {
  cKey: string
  node: Extract<SchemaNode, { kind: 'leaf' }>
  path: string
  value: unknown
  enums: Record<string, EnumValues>
  commit: Commit
  label: string
  title?: string
}): JSX.Element {
  const { cKey, node, path, value, enums, commit, label } = props
  const sem0 = node.semantic.split(':')[0]
  const cur = valueAt(value, path)
  const def = effectiveDefault(cKey, node)
  const base = cur !== undefined && cur !== null ? cur : def
  const title = props.title ?? node.notes

  const channels = CHANNELS[sem0]
  if (channels !== undefined) {
    const baseObj = isRecord(base) ? base : undefined
    if (sem0 === 'color3' || sem0 === 'color4') {
      return (
        <Prop label={label} title={title}>
          <ColorField cKey={cKey} path={path} base={baseObj as never} hasAlpha={sem0 === 'color4'} commit={commit} />
        </Prop>
      )
    }
    return (
      <Prop label={label} title={title}>
        <ChannelsField cKey={cKey} path={path} channels={channels} base={baseObj} commit={commit} />
      </Prop>
    )
  }

  if (node.enum !== undefined && enums[node.enum] !== undefined) {
    const fb = typeof base === 'number' ? base : 0
    const Field = sem0 === 'bitmask' ? BitmaskField : EnumField
    // enums read as friendly names in every path (wire value stays numeric)
    return (
      <Prop label={label} title={title}>
        <Field cKey={cKey} path={path} values={prettyEnumValues(enums[node.enum])} fallback={fb} commit={commit} />
      </Prop>
    )
  }

  switch (sem0) {
    case 'bool':
      return (
        <Prop label={label} title={title}>
          <BoolField cKey={cKey} path={path} fallback={base === true} commit={commit} />
        </Prop>
      )
    case 'string':
    case 'url':
    case 'urlOrContent':
    case 'contentFile':
    case 'urn':
    case 'userRef':
    case 'gltfNodePath':
    case 'gltfAnimationName':
      return (
        <Prop label={label} title={title}>
          <StringField cKey={cKey} path={path} fallback={typeof base === 'string' ? base : ''} commit={commit} />
        </Prop>
      )
    case 'textureUnion':
    case 'borderRect': {
      // no dedicated widget — edit this leaf as JSON text
      return (
        <Prop label={label} title={title}>
          <StringField
            cKey={cKey}
            path={path}
            fallback={base === undefined ? '' : JSON.stringify(base)}
            commit={commit}
          />
        </Prop>
      )
    }
    default:
      return (
        <Prop label={label} title={title ?? node.semantic}>
          <ScrubNumberField cKey={cKey} path={path} fallback={typeof base === 'number' ? base : 0} commit={commit} />
        </Prop>
      )
  }
}
