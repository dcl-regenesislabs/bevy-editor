import css from './CardPicker.css?inline'
import { Checkbox } from '.'
import { registerCss } from './styles/registry'

registerCss('ds/CardPicker', 'primitives', css)

export interface PickerItem {
  key: string
  label: string
  note?: string | null
  image?: string | null
  tip?: string
  disabledReason?: string | null
}

export function CardPicker(props: {
  items: PickerItem[]
  selected: string[]
  onSelect: (key: string) => void
  mode?: 'one' | 'many'
  ariaLabel: string
}): JSX.Element {
  const many = props.mode === 'many'
  const picked = new Set(props.selected)

  return (
    <div className="eui-ds-picks" role="group" aria-label={props.ariaLabel}>
      {props.items.map((it) => {
        const on = picked.has(it.key)
        const off = it.disabledReason !== undefined && it.disabledReason !== null
        const body = (
          <>
            {it.image !== undefined && it.image !== null ? (
              <img src={it.image} alt="" crossOrigin="anonymous" loading="lazy" />
            ) : (
              <span className="ph">⛶</span>
            )}
            <span className="meta">
              <span className="nm">{it.label}</span>
              {it.note !== undefined && it.note !== null && <span className="num">{it.note}</span>}
            </span>
          </>
        )
        if (many) {
          return (
            <label key={it.key} className={`eui-ds-pick${on ? ' on' : ''}`} data-tip={it.disabledReason ?? it.tip}>
              <span className="box">
                <Checkbox checked={on} disabled={off} onChange={() => props.onSelect(it.key)} />
              </span>
              {body}
            </label>
          )
        }
        return (
          <button
            key={it.key}
            type="button"
            className="eui-ds-pick"
            aria-pressed={on}
            disabled={off}
            data-tip={it.disabledReason ?? it.tip}
            onClick={() => props.onSelect(it.key)}
          >
            {body}
          </button>
        )
      })}
    </div>
  )
}
