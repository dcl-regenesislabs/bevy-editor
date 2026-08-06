import { useEffect } from 'react'
// The field editors behind a script's params — one row per constructor param,
// typed by what the parser read out of the signature. Split out of script-view
// so the view stays about files (create, attach, rename, run order) and this
// stays about values.
//
// `prefab` / `prefabList` are the Spawnable-prefab pickers: the layout stores a
// prefab UUID, the creator sees names. Option building lives in prefab-options.ts.
import { state, type Snapshot } from '@scene/state'
import { entityName } from '@scene/custom-components'
import { useStore } from '../../core/store'
import type { ScriptParam } from '../../script/parser'
import { MultiSelect, Select, TextInput, Toggle, type SelectOption } from '../../ds'
import { prettyLabel } from '../fields'
import { prefabStore, refreshPrefabs } from '../prefab-store'
import { NO_SPAWNABLES_YET } from '../../prefabs/copy'
import { paramHint } from './param-visibility'
import { hasSpawnablePrefabs, prefabRefOptions, refOf, refsOf } from './prefab-options'

// Numbers are plain text inputs, not type="number": a native number field renders
// its value through the OS locale, so 0.3 shows as "0,3" wherever the decimal mark
// is a comma and reads like a typo. Displaying String(value) keeps the dot, and a
// comma typed by hand is still accepted here.
function parseNumeric(raw: string): number | null {
  const v = parseFloat(raw.trim().replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

export function ParamField(props: {
  name: string
  param: ScriptParam
  onChange: (value: ScriptParam['value']) => void
  enumLabels?: Readonly<Record<string, string>>
  enumHints?: Readonly<Record<string, string>>
}): JSX.Element {
  const { name, param, onChange, enumLabels, enumHints } = props
  const realName = param.optional === true ? `${name} (optional)` : name
  const tip = param.description === undefined ? realName : `${realName} — ${param.description}`
  const hint = param.type === 'enum' ? enumHints?.[String(param.value)] : undefined
  return (
    <>
      <div className="eui-prop">
        <span className="plabel param" data-tip={tip}>
          {prettyLabel(name)}
        </span>
        <div className="pvalue">
          {param.type === 'number' && (
            <input
              key={String(param.value)}
              className="eui-num"
              inputMode="decimal"
              spellCheck={false}
              defaultValue={String(param.value)}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                const v = parseNumeric(e.target.value)
                if (v !== null && v !== param.value) onChange(v)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          )}
          {param.type === 'string' && (
            <TextInput
              key={String(param.value)}
              defaultValue={param.value as string}
              onBlur={(e) => {
                if (e.target.value !== param.value) onChange(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          )}
          {param.type === 'boolean' && (
            <Toggle size="sm" checked={param.value === true} onChange={(v) => onChange(v)} />
          )}
          {param.type === 'enum' && (
            <Select
              compact
              value={String(param.value)}
              options={(param.options ?? []).map((o) => ({ value: o, label: enumLabels?.[o] ?? o }))}
              onChange={(v) => onChange(v)}
              aria-label={name}
            />
          )}
          {param.type === 'entity' && (
            <EntityPicker value={Number(param.value)} noneHint={paramHint(param)} onChange={(v) => onChange(v)} />
          )}
          {param.type === 'prefab' && (
            <PrefabPicker name={name} value={refOf(param.value)} onChange={(v) => onChange(v)} />
          )}
          {param.type === 'prefabList' && (
            <PrefabListPicker name={name} value={refsOf(param.value)} onChange={(v) => onChange(v)} />
          )}
          {param.type === 'action' && (
            <span
              className="eui-script-dim"
              data-tip="ActionCallback params connect to the smart-items Actions system, which this editor does not use."
            >
              action callback — unsupported
            </span>
          )}
        </div>
      </div>
      {hint !== undefined && hint !== '' && <div className="eui-param-hint">{hint}</div>}
    </>
  )
}

function EntityPicker(props: {
  value: number
  noneHint?: string
  onChange: (v: number) => void
}): JSX.Element {
  const snapshot = useStore(() => state.snapshot)
  const named = Object.keys(snapshot)
    .filter((id) => Number.isFinite(Number(id)) && Number(id) !== 0)
    .map((id) => ({ id, name: entityName(snapshot as Snapshot, id) }))
    .filter((row): row is { id: string; name: string } => row.name !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name))
  const options: SelectOption[] = [
    { value: '0', label: 'none', hint: props.noneHint },
    ...named.map((row) => ({ value: row.id, label: row.name, hint: `#${row.id}` }))
  ]
  if (!options.some((o) => o.value === String(props.value))) {
    options.splice(1, 0, { value: String(props.value), label: `#${props.value}`, hint: 'unnamed' })
  }
  return (
    <Select
      compact
      value={String(props.value)}
      options={options}
      onChange={(v) => props.onChange(Number(v))}
      aria-label="entity"
    />
  )
}

function PrefabPicker(props: { name: string; value: string; onChange: (v: string) => void }): JSX.Element {
  const items = useStore(() => prefabStore.items)
  useEffect(() => {
    void refreshPrefabs()
  }, [])
  const selected = props.value === '' ? [] : [props.value]
  if (!hasSpawnablePrefabs(items) && selected.length === 0) {
    return <span className="eui-script-dim">{NO_SPAWNABLES_YET}</span>
  }
  return (
    <Select
      compact
      value={props.value}
      options={prefabRefOptions(items, selected, true)}
      onChange={props.onChange}
      aria-label={props.name}
    />
  )
}

function PrefabListPicker(props: {
  name: string
  value: string[]
  onChange: (v: string[]) => void
}): JSX.Element {
  const items = useStore(() => prefabStore.items)
  if (!hasSpawnablePrefabs(items) && props.value.length === 0) {
    return <span className="eui-script-dim">{NO_SPAWNABLES_YET}</span>
  }
  return (
    <MultiSelect
      density="compact"
      value={props.value}
      options={prefabRefOptions(items, props.value)}
      onChange={props.onChange}
      aria-label={props.name}
    />
  )
}
