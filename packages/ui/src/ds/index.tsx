// Design-system primitives — the reusable React components for the editor's
// "precision instrument" look. They wrap the eui-* classes defined in styles.ts
// (the single stylesheet, scoped under .eui-root) so panels and the showcase
// share ONE source of truth instead of hand-writing class strings. Pure
// presentational — no store, no engine; safe to render anywhere under .eui-root.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

const cx = (...parts: Array<string | false | undefined>): string => parts.filter(Boolean).join(' ')

// ---------- buttons ----------
export type ButtonVariant = 'default' | 'primary'
export function Button(
  props: { variant?: ButtonVariant; icon?: boolean; active?: boolean; tip?: string } & ButtonHTMLAttributes<HTMLButtonElement>
): JSX.Element {
  const { variant = 'default', icon, active, tip, className, children, ...rest } = props
  return (
    <button
      className={cx('eui-btn', variant === 'primary' && 'primary', icon && 'icon', active && 'active', className)}
      data-tip={tip}
      {...rest}
    >
      {children}
    </button>
  )
}

// icon-only button (square) — the toolbar's workhorse
export function IconButton(props: { active?: boolean; tip?: string } & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return <Button icon {...props} />
}

// text link / subtle action (eui-link)
export function LinkButton(props: ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const { className, ...rest } = props
  return <button className={cx('eui-link', className)} {...rest} />
}

// ---------- segmented control (eui-seg) ----------
export function Segmented<T extends string>(props: {
  value: T
  options: ReadonlyArray<{ value: T; label: ReactNode }>
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="eui-seg">
      {props.options.map((o) => (
        <button key={o.value} className={cx('eui-seg-btn', props.value === o.value && 'active')} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------- toggle (eui-toggle) ----------
export function Toggle(props: { on: boolean; onChange: (on: boolean) => void; tip?: string }): JSX.Element {
  return <div className={cx('eui-toggle', props.on && 'on')} data-tip={props.tip} onClick={() => props.onChange(!props.on)} />
}

// ---------- form controls ----------
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  const { className, ...rest } = props
  return <input className={cx('eui-input', className)} spellCheck={false} {...rest} />
}

export function NumberField(props: { dirty?: boolean } & InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  const { dirty, className, ...rest } = props
  return <input type="number" className={cx('eui-num', dirty && 'dirty', className)} {...rest} />
}

export function Select<T extends string>(props: {
  value: T
  options: ReadonlyArray<{ value: T; label?: string }>
  onChange: (v: T) => void
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>): JSX.Element {
  const { value, options, onChange, className, ...rest } = props
  return (
    <select className={cx('eui-select', className)} value={value} onChange={(e) => onChange(e.target.value as T)} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label ?? o.value}
        </option>
      ))}
    </select>
  )
}

export function ColorSwatch(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  const { className, ...rest } = props
  return <input type="color" className={cx('eui-color-swatch', className)} {...rest} />
}

export function TextArea(props: InputHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  const { className, ...rest } = props
  return <textarea className={cx('eui-raw', className)} spellCheck={false} {...rest} />
}

// ---------- badges ----------
export function IdBadge(props: { children: ReactNode }): JSX.Element {
  return <span className="eui-id-badge">{props.children}</span>
}

// ---------- surfaces ----------
export function Panel(props: { overline?: string; title?: ReactNode; titleDim?: boolean; actions?: ReactNode; children: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={cx('eui-panel', props.className)}>
      {(props.overline !== undefined || props.title !== undefined) && (
        <div className="eui-panel-head">
          <div className="eui-head-text">
            {props.overline !== undefined && <span className="eui-overline">{props.overline}</span>}
            {props.title !== undefined && <span className={cx('eui-title', props.titleDim && 'dim')}>{props.title}</span>}
          </div>
          {props.actions}
        </div>
      )}
      <div className="eui-panel-body">{props.children}</div>
    </div>
  )
}

// group label (eui-group-label) + a property row (eui-prop)
export function GroupLabel(props: { children: ReactNode }): JSX.Element {
  return <div className="eui-group-label">{props.children}</div>
}
export function PropRow(props: { label: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="eui-prop">
      <span className="plabel">{props.label}</span>
      <div className="pvalue">{props.children}</div>
    </div>
  )
}

// ---------- menu items (eui-menu-item) ----------
export function MenuItem(props: { icon?: ReactNode; hint?: string; danger?: boolean; onClick?: () => void; children: ReactNode }): JSX.Element {
  return (
    <button className={cx('eui-menu-item', props.danger && 'danger')} onClick={props.onClick}>
      {props.icon}
      {props.children}
      {props.hint !== undefined && props.hint !== '' && <span className="hint">{props.hint}</span>}
    </button>
  )
}

// ---------- feedback ----------
export function Toast(props: { children: ReactNode }): JSX.Element {
  return <div className="eui-toast">{props.children}</div>
}
export function AutoSaveChip(props: { state?: 'ok' | 'dim' | 'err'; tip?: string; children: ReactNode }): JSX.Element {
  return (
    <span className={cx('eui-autosave', props.state)} data-tip={props.tip}>
      <span className="dot" />
      {props.children}
    </span>
  )
}
