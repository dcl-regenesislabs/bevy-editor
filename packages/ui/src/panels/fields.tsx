// Store-bound field primitives shared by every property editor: each reads the
// scene's edit model (state.fieldEdits) and commits the whole component.
import { MultiSelect, Select, Toggle } from '../ds'
import { useStore } from '../core/store'
import { currentBool, currentNumberText, currentString, fieldKey, fieldRev, joinPath, setField } from '@scene/fields'
import { type EnumValues } from '@scene/schema'
import { deleteFieldEdit, state } from '@scene/state'
import { useRef } from 'react'

// ---------- shared bits ----------

export type Commit = () => void

function leafText(key: string, path: string, fallback: unknown): string {
  const edit = state.fieldEdits.get(fieldKey(key, path))
  if (typeof edit === 'string') return edit
  if (typeof fallback === 'number') return trimNum(fallback)
  if (typeof fallback === 'string') return fallback
  return ''
}

export function trimNum(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const r = Math.round(n * 1000) / 1000
  return String(Math.abs(r) < 1e-9 ? 0 : r)
}

// uncontrolled input; remounts when the underlying snapshot value changes
// (gizmo drags, applies) but never while the user is typing.
export function ScrubNumberField(props: {
  cKey: string
  path: string
  fallback: number
  commit: Commit
  axis?: string
}): JSX.Element {
  const { cKey, path, fallback, commit } = props
  const fieldEdits = useStore(() => state.fieldEdits)
  const text = leafText(cKey, path, fallback)
  const dirty = fieldEdits.has(fieldKey(cKey, path))
  const ref = useRef<HTMLInputElement>(null)

  const onScrub = (e: React.PointerEvent): void => {
    e.preventDefault()
    const start = e.clientX
    const startVal = parseFloat(leafText(cKey, path, fallback)) || 0
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      moved = true
      const step = ev.shiftKey ? 0.01 : 0.1
      const v = startVal + (ev.clientX - start) * step
      setField(cKey, path, trimNum(v))
      if (ref.current !== null) ref.current.value = trimNum(v)
    }
    const onUp = (): void => {
      target.releasePointerCapture(e.pointerId)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      if (moved) commit()
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  // x/y/z are spatial axes and carry the gizmo's colour; the same field also
  // renders colour channels (r/g/b/a), which must not borrow it.
  const spatial = props.axis === 'x' || props.axis === 'y' || props.axis === 'z'

  return (
    <span className="eui-axis" data-axis={spatial ? props.axis : undefined}>
      {props.axis !== undefined && (
        <span
          className="ax"
          data-tip="drag to scrub · shift for fine"
          onPointerDown={onScrub}
        >
          {props.axis.toUpperCase()}
        </span>
      )}
      {spatial && <span className="axbar" aria-hidden />}
      <input
        ref={ref}
        key={`${fieldRev(cKey, path)}:${trimNum(fallback)}`}
        className={`eui-num ${dirty ? 'dirty' : ''}`}
        defaultValue={text}
        spellCheck={false}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setField(cKey, path, e.target.value)
        }}
        onBlur={() => {
          if (state.fieldEdits.has(fieldKey(cKey, path))) commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            deleteFieldEdit(fieldKey(cKey, path))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    </span>
  )
}

export function StringField(props: {
  cKey: string
  path: string
  fallback: string
  commit: Commit
}): JSX.Element {
  const { cKey, path, fallback, commit } = props
  return (
    <input
      key={`${fieldRev(cKey, path)}:${fallback}`}
      className="eui-num"
      style={{ fontVariantNumeric: 'normal' }}
      defaultValue={currentString(cKey, path, fallback)}
      spellCheck={false}
      onChange={(e) => setField(cKey, path, e.target.value)}
      onBlur={() => {
        if (state.fieldEdits.has(fieldKey(cKey, path))) commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export function BoolField(props: {
  cKey: string
  path: string
  fallback: boolean
  commit: Commit
}): JSX.Element {
  const { cKey, path, fallback, commit } = props
  const on = currentBool(cKey, path, fallback)
  return (
    <Toggle
      size="sm"
      checked={on}
      onChange={() => {
        setField(cKey, path, !on)
        commit()
      }}
    />
  )
}

export function ChannelsField(props: {
  cKey: string
  path: string
  channels: string[]
  base: Record<string, unknown> | undefined
  commit: Commit
}): JSX.Element {
  const { cKey, path, channels, base, commit } = props
  return (
    <>
      {channels.map((ch) => (
        <ScrubNumberField
          key={ch}
          cKey={cKey}
          path={joinPath(path, ch)}
          fallback={typeof base?.[ch] === 'number' ? (base[ch] as number) : 0}
          commit={commit}
          axis={ch}
        />
      ))}
    </>
  )
}

// color: native picker + alpha when present
export function ColorField(props: {
  cKey: string
  path: string
  base: { r?: number; g?: number; b?: number; a?: number } | undefined
  hasAlpha: boolean
  commit: Commit
}): JSX.Element {
  const { cKey, path, base, hasAlpha, commit } = props
  const cur = (ch: string, fb: number): number => {
    const t = currentNumberText(cKey, joinPath(path, ch), fb)
    const n = parseFloat(t)
    return Number.isNaN(n) ? fb : n
  }
  const r = cur('r', base?.r ?? 1)
  const g = cur('g', base?.g ?? 1)
  const b = cur('b', base?.b ?? 1)
  const hex = `#${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`
  return (
    <>
      <input
        type="color"
        className="eui-color-swatch"
        value={hex}
        onChange={(e) => {
          const v = e.target.value
          setField(cKey, joinPath(path, 'r'), trimNum(parseInt(v.slice(1, 3), 16) / 255))
          setField(cKey, joinPath(path, 'g'), trimNum(parseInt(v.slice(3, 5), 16) / 255))
          setField(cKey, joinPath(path, 'b'), trimNum(parseInt(v.slice(5, 7), 16) / 255))
        }}
        onBlur={commit}
      />
      {hasAlpha && (
        <ScrubNumberField cKey={cKey} path={joinPath(path, 'a')} fallback={base?.a ?? 1} commit={commit} axis="a" />
      )}
    </>
  )
}

export function EnumField(props: {
  cKey: string
  path: string
  values: EnumValues
  fallback: number
  commit: Commit
}): JSX.Element {
  const { cKey, path, values, fallback, commit } = props
  const t = currentNumberText(cKey, path, fallback)
  return (
    <Select
      compact
      value={t}
      options={values.map(([name, num]) => ({ value: String(num), label: name }))}
      onChange={(v) => {
        setField(cKey, path, v)
        commit()
      }}
    />
  )
}

export function BitmaskField(props: {
  cKey: string
  path: string
  values: EnumValues
  fallback: number
  commit: Commit
}): JSX.Element {
  const { cKey, path, values, fallback, commit } = props
  const cur = parseFloat(currentNumberText(cKey, path, fallback)) || 0
  const options = values.filter(([, bit]) => bit !== 0).map(([name, bit]) => ({ value: String(1 << bit), label: name }))
  const selected = options.filter((o) => (cur & Number(o.value)) !== 0).map((o) => o.value)
  return (
    <MultiSelect
      density="compact"
      options={options}
      value={selected}
      onChange={(next) => {
        // keep bits the option list doesn't cover — the old per-bit set/clear did
        const known = options.reduce((acc, o) => acc | Number(o.value), 0)
        setField(cKey, path, String((cur & ~known) | next.reduce((acc, v) => acc | Number(v), 0)))
        commit()
      }}
    />
  )
}

export function Prop(props: { label: string; children: React.ReactNode; title?: string }): JSX.Element {
  return (
    <div className="eui-prop" data-tip={props.title}>
      <span className="plabel">{prettyLabel(props.label)}</span>
      <span className="pvalue">{props.children}</span>
    </div>
  )
}

// Identifier → the label a creator reads: "audioSource" → "Audio Source".
// Title case, not lower, because these read as the names of things (a component
// card, a property) rather than prose. An all-caps run is a word of its own, so
// "GLTFContainer" splits to "GLTF Container" and keeps the acronym intact
// instead of collapsing to "Gltfcontainer".
export function prettyLabel(s: string): string {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .split(' ')
    .map((w) => (/^[A-Z0-9]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
}

// Friendly name for an engine enum entry: strip the short ALL-CAPS prefix
// (MTM_/TAM_/NFT_/…), split glued EASEIN/EASEOUT/EASE easing names, title-case.
// Enum wire values stay numeric — this is display only.
export function prettyEnumName(name: string): string {
  let s = name
  const pre = /^[A-Z0-9]{1,4}_(.+)$/.exec(s)
  if (pre !== null) s = pre[1]
  const ease = /^EASE(IN|OUT)?([A-Z]+)$/.exec(s)
  if (ease !== null) {
    s = ['EASE', ease[1], ease[2]].filter((x): x is string => x !== undefined).join('_')
  }
  return s
    .split('_')
    .map((w) => (w === '' ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ')
}

// Map an enum's [name, value] pairs to friendly display names (value unchanged).
export function prettyEnumValues(values: EnumValues): EnumValues {
  return values.map(([name, num]): [string, number] => [prettyEnumName(name), num])
}
