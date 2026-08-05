// Design-system primitives — the reusable React components for the editor UI.
// Tokens and the pill/uppercase CTA language are ported from bevy-explorer's
// react-web design system (react-web/src/design). Because the editor renders
// inside a shadow root, the react-web CSS Modules are flattened into plain
// eui-* / eui-ds-* classes in styles.ts (the single injected stylesheet).
// Pure presentational — no store, no engine; safe anywhere under .eui-root.
import { useEffect, useRef, useState } from 'react'
import { Popover } from './Popover'
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, KeyboardEvent, ReactNode, TextareaHTMLAttributes } from 'react'

const cx = (...parts: Array<string | false | undefined>): string => parts.filter(Boolean).join(' ')

// ---------- buttons ----------
export type ButtonVariant = 'default' | 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

// 'default' keeps the quiet editor chrome button (eui-btn); primary/secondary/
// ghost render the react-web pill CTA (uppercase, weight 800). Size 'sm' is the
// default so pills sit well next to the editor's 28px rows.
export function Button(
  props: {
    variant?: ButtonVariant
    size?: ButtonSize
    icon?: boolean
    active?: boolean
    tip?: string
  } & ButtonHTMLAttributes<HTMLButtonElement>
): JSX.Element {
  const { variant = 'default', size = 'sm', icon, active, tip, className, type = 'button', children, ...rest } = props
  const cls =
    variant === 'default' || icon === true
      ? cx('eui-btn', variant === 'primary' && 'primary', icon && 'icon', active && 'active', className)
      : cx('eui-ds-btn', variant, size, className)
  return (
    <button type={type} className={cls} data-tip={tip} {...rest}>
      {children}
    </button>
  )
}

// icon-only button (square) — the toolbar's workhorse
export function IconButton(props: { active?: boolean; tip?: string } & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return <Button icon {...props} />
}

// text link / subtle action (eui-link) — the inline action inside prose or a
// notice, at the panel's own scale. `danger` is the destructive one: a CTA pill
// inside a one-line notice outshouts everything around it.
export function LinkButton(
  props: { tone?: 'default' | 'danger' } & ButtonHTMLAttributes<HTMLButtonElement>
): JSX.Element {
  const { className, tone, ...rest } = props
  return <button className={cx('eui-link', tone === 'danger' && 'danger', className)} {...rest} />
}

// ControlButton — the small icon control from react-web (close, back, menu…).
export function ControlButton(
  props: {
    /** ghost = transparent→white-10 hover (default); solid = dark fill. */
    variant?: 'ghost' | 'solid'
    /** square (default), circle, or pill (for label + value like a count). */
    shape?: 'square' | 'circle' | 'pill'
    /** md = 30px (default), sm = 26px. */
    size?: 'sm' | 'md'
    active?: boolean
    tip?: string
  } & ButtonHTMLAttributes<HTMLButtonElement>
): JSX.Element {
  const { variant = 'ghost', shape = 'square', size = 'md', active = false, tip, className, type = 'button', ...rest } = props
  return (
    <button
      type={type}
      className={cx('eui-ds-ctl', variant, shape, size, active && 'active', className)}
      aria-pressed={active}
      data-tip={tip}
      {...rest}
    />
  )
}

// ---------- segmented control (eui-seg) ----------
export function Segmented<T extends string>(props: {
  value: T
  options: ReadonlyArray<{ value: T; label: ReactNode }>
  onChange: (v: T) => void
  /** sm = panel tabs (default); lg = 40px toolbar row. */
  size?: 'sm' | 'lg'
  className?: string
}): JSX.Element {
  return (
    <div className={cx('eui-seg', props.size === 'lg' && 'lg', props.className)}>
      {props.options.map((o) => (
        <button key={o.value} className={cx('eui-seg-btn', props.value === o.value && 'active')} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------- toggle (react-web violet pill switch) ----------
// Exactly two sizes exist, and both come from here. `md` (46x26) is the default;
// `sm` (34x18) exists because 28px menu rows cannot host a 26px pill. The CSS is
// asserted against this tuple by ds-contract.test.ts R5, so a third size cannot
// appear in a stylesheet without also appearing in the component API.
export const TOGGLE_SIZES = ['sm', 'md'] as const
export type ToggleSize = (typeof TOGGLE_SIZES)[number]

export function Toggle(props: {
  checked: boolean
  onChange?: (checked: boolean) => void
  size?: ToggleSize
  /** Render a non-interactive <span> -- for rows whose parent is already the
      control (e.g. a button[role=menuitemcheckbox]); nesting buttons is invalid. */
  presentation?: boolean
  disabled?: boolean
  tip?: string
  'aria-label'?: string
}): JSX.Element {
  const size = props.size ?? 'md'
  const className = cx('eui-ds-toggle', size === 'sm' && 'sm', props.checked && 'on')
  if (props.presentation === true) {
    return (
      <span className={className} aria-hidden="true">
        <span className="knob" />
      </span>
    )
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props['aria-label']}
      disabled={props.disabled}
      data-tip={props.tip}
      className={className}
      onClick={() => props.onChange?.(!props.checked)}
    >
      <span className="knob" />
    </button>
  )
}

// ---------- checkbox (react-web: square box, orange tick) ----------
export function Checkbox(props: {
  checked?: boolean
  defaultChecked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  'aria-label'?: string
  children?: ReactNode
}): JSX.Element {
  const [internal, setInternal] = useState(props.defaultChecked ?? false)
  const isControlled = props.checked !== undefined
  const on = isControlled ? props.checked === true : internal
  const toggle = (): void => {
    if (!isControlled) setInternal(!on)
    props.onChange?.(!on)
  }
  return (
    <label className="eui-ds-check">
      <input type="checkbox" checked={on} disabled={props.disabled} aria-label={props['aria-label']} onChange={toggle} />
      <span className={cx('box', on && 'checked')}>
        {on && (
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M3 8.5l3 3 7-7" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="label">{props.children}</span>
    </label>
  )
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

// Shadow-DOM-safe outside-click: document-level events retarget to the shadow
// host, so use composedPath() instead of contains(e.target).
export function useOutsideClose(open: boolean, ref: { current: HTMLElement | null }, close: () => void): void {
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current !== null && !e.composedPath().includes(ref.current)) close()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
}

export interface SelectOption {
  value: string
  label: string
}

export type Density = 'default' | 'compact' | 'row'

// The shared picker trigger. Select and MultiSelect render the identical field
// so a single-select and a multi-select sitting in the same inspector column
// cannot look like two different controls.
export function SelectTrigger(props: {
  label: ReactNode
  open: boolean
  onToggle: () => void
  disabled?: boolean
  variant?: 'dark' | 'light'
  density?: Density
  buttonRef?: React.Ref<HTMLButtonElement>
  'aria-label'?: string
}): JSX.Element {
  const { label, open, onToggle, disabled = false, variant = 'dark', density = 'default' } = props
  return (
    <button
      type="button"
      ref={props.buttonRef}
      className={cx('eui-ds-select-field', variant === 'light' && 'light', density === 'compact' && 'compact', density === 'row' && 'row')}
      disabled={disabled}
      aria-label={props['aria-label']}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="value">{label}</span>
      <svg className={cx('chev', open && 'open')} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

// Select — the ONE single-select picker. Controlled (`value`) or uncontrolled
// (`defaultValue`), full listbox keyboard nav, rows on the shared Popover.
export function Select(props: {
  value?: string
  defaultValue?: string
  options: ReadonlyArray<SelectOption>
  onChange: (value: string) => void
  disabled?: boolean
  /** dark (default, on dark panels) or light (white field). */
  variant?: 'dark' | 'light'
  /** inspector-row size. `compact` matches the 26px property-row controls. */
  density?: Density
  /** @deprecated pass `density="compact"` instead. */
  compact?: boolean
  className?: string
  'aria-label'?: string
}): JSX.Element {
  const { options, onChange, disabled = false, variant = 'dark' } = props
  const density = props.density ?? (props.compact === true ? 'compact' : 'default')
  const isControlled = props.value !== undefined
  const [internal, setInternal] = useState(props.defaultValue ?? '')
  const value = isControlled ? (props.value as string) : internal
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const id = useRef('sel' + Math.random().toString(36).slice(2, 8)).current
  useOutsideClose(open, ref, () => setOpen(false))
  useEffect(() => {
    if (open) setActive(Math.max(0, options.findIndex((o) => o.value === value)))
  }, [open])

  function pick(opt: SelectOption): void {
    if (!isControlled) setInternal(opt.value)
    onChange(opt.value)
    setOpen(false)
    btnRef.current?.focus()
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
        btnRef.current?.focus()
      }
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!open) setOpen(true)
      else if (active >= 0) pick(options[active])
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (e.key === 'Home') setActive(0)
      else if (e.key === 'End') setActive(options.length - 1)
      else if (e.key === 'ArrowDown') setActive((a) => Math.min(options.length - 1, a + 1))
      else setActive((a) => Math.max(0, a - 1))
    }
  }

  const current = options.find((o) => o.value === value)
  return (
    <div className={cx('eui-ds-select', density === 'compact' && 'compact', density === 'row' && 'row', props.className)} ref={ref} onKeyDown={onKey}>
      <SelectTrigger
        label={current?.label ?? value}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        disabled={disabled}
        variant={variant}
        density={density}
        buttonRef={btnRef}
        aria-label={props['aria-label']}
      />
      {open && (
        <Popover density={density === 'default' ? 'default' : 'compact'} role="listbox">
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={cx('eui-ds-pop-row', (o.value === value || i === active) && 'active')}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
            >
              {o.label}
            </button>
          ))}
        </Popover>
      )}
    </div>
  )
}

// MultiSelect — the ONE multi-select picker. Same trigger, same Popover surface
// as Select; rows are toggles that keep the popup open. Kept a separate
// component from Select because the selection semantics differ (`aria-selected`
// rows that close vs rows that stay) -- a `multiple` flag would be a boolean trap.
export function MultiSelect(props: {
  value: ReadonlyArray<string>
  options: ReadonlyArray<SelectOption>
  onChange: (values: string[]) => void
  summary?: (selected: SelectOption[]) => string
  density?: Density
  disabled?: boolean
  className?: string
  'aria-label'?: string
}): JSX.Element {
  const { value, options, onChange, disabled = false } = props
  const density = props.density ?? 'default'
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutsideClose(open, ref, () => setOpen(false))

  const selected = options.filter((o) => value.includes(o.value))
  const summarise = props.summary ?? ((sel: SelectOption[]) => (sel.length === 0 ? 'none' : sel.length <= 2 ? sel.map((s) => s.label).join(', ') : `${sel.length} selected`))

  function toggle(opt: SelectOption): void {
    onChange(value.includes(opt.value) ? value.filter((v) => v !== opt.value) : [...value, opt.value])
  }

  return (
    <div className={cx('eui-ds-select', density === 'compact' && 'compact', density === 'row' && 'row', props.className)} ref={ref}>
      <SelectTrigger
        label={summarise(selected)}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        disabled={disabled}
        density={density}
        aria-label={props['aria-label']}
      />
      {open && (
        <Popover density={density === 'default' ? 'default' : 'compact'} role="group">
          {options.map((o) => {
            const on = value.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                role="checkbox"
                aria-checked={on}
                className="eui-ds-pop-row"
                onClick={() => toggle(o)}
              >
                <Toggle size="sm" presentation checked={on} />
                {o.label}
              </button>
            )
          })}
        </Popover>
      )}
    </div>
  )
}

// Slider — styled range input with a violet fill + white knob.
export function Slider(props: {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  disabled?: boolean
  /** Show ‹ › stepper arrows (DCL settings style). */
  arrows?: boolean
  'aria-label'?: string
}): JSX.Element {
  const { value, min = 0, max = 100, step = 1, onChange, disabled = false, arrows = false } = props
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  const clamp = (v: number): number => Math.min(max, Math.max(min, v))
  const input = (
    <input
      type="range"
      className="eui-ds-slider"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={props['aria-label']}
      style={{ '--pct': `${pct}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
  if (!arrows) return input
  return (
    <div className="eui-ds-slider-row">
      <button type="button" className="eui-ds-slider-arrow" disabled={disabled || value <= min} aria-label="decrease" onClick={() => onChange(clamp(value - step))}>
        ‹
      </button>
      {input}
      <button type="button" className="eui-ds-slider-arrow" disabled={disabled || value >= max} aria-label="increase" onClick={() => onChange(clamp(value + step))}>
        ›
      </button>
    </div>
  )
}

export function ColorSwatch(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  const { className, ...rest } = props
  return <input type="color" className={cx('eui-color-swatch', className)} {...rest} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  const { className, ...rest } = props
  return <textarea className={cx('eui-raw', className)} spellCheck={false} {...rest} />
}

// FieldLabel — form label with an optional `notice` superscript and `sublabel`.
export function FieldLabel(props: {
  children?: ReactNode
  htmlFor?: string
  sublabel?: ReactNode
  notice?: ReactNode
  className?: string
}): JSX.Element {
  const label = (
    <label htmlFor={props.htmlFor} className={cx('eui-ds-fieldlabel', props.className)}>
      {props.children}
      {props.notice !== undefined && <sup className="notice">{props.notice}</sup>}
    </label>
  )
  if (props.sublabel === undefined) return label
  return (
    <span className="eui-ds-fieldgroup">
      {label}
      <span className="sub">{props.sublabel}</span>
    </span>
  )
}

// SearchField — pill input with a leading magnifier; controlled or uncontrolled.
export function SearchField(props: {
  value?: string
  defaultValue?: string
  placeholder?: string
  onChange?: (value: string) => void
  /** sm = 28px panel row; md = 38px pill (default); lg = 40px toolbar row. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}): JSX.Element {
  const { value, defaultValue = '', placeholder = 'Search', onChange } = props
  const [internal, setInternal] = useState(defaultValue)
  const isControlled = value !== undefined
  const v = isControlled ? value : internal
  return (
    <label className={cx('eui-ds-search', props.size === 'lg' && 'lg', props.size === 'sm' && 'sm', props.className)}>
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" className="icon">
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        aria-label={placeholder}
        placeholder={placeholder}
        value={v}
        onChange={(e) => {
          if (!isControlled) setInternal(e.target.value)
          onChange?.(e.target.value)
        }}
      />
    </label>
  )
}

// ---------- badges ----------
export function IdBadge(props: { children: ReactNode }): JSX.Element {
  return <span className="eui-id-badge">{props.children}</span>
}

// ---------- surfaces ----------
export function Panel(props: {
  overline?: string
  title?: ReactNode
  titleDim?: boolean
  actions?: ReactNode
  /** Frosted translucent surface (react-web Panel blur). */
  blur?: boolean
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div className={cx('eui-panel', props.blur && 'blur', props.className)}>
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

// Shelf — the ONE collapsible section: a sticky labelled header (title + count)
// over its content. Controlled (`open` + `onToggle`) or uncontrolled (`defaultOpen`).
export function Shelf(props: {
  title: string
  count?: number
  note?: string
  open?: boolean
  onToggle?: () => void
  defaultOpen?: boolean
  children: ReactNode
}): JSX.Element {
  const [local, setLocal] = useState(props.defaultOpen ?? true)
  const open = props.open ?? local
  const toggle = (): void => {
    if (props.open === undefined) setLocal(!open)
    props.onToggle?.()
  }
  return (
    <div className="eui-shelf">
      <button className="eui-shelf-head" onClick={toggle}>
        <span className={cx('caret', open && 'open')}>
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4 2.5L8.5 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="t">{props.title}</span>
        {props.count !== undefined && <span className="n">{props.count}</span>}
      </button>
      {open && props.note !== undefined && <p className="eui-shelf-note">{props.note}</p>}
      {open && props.children}
    </div>
  )
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
// Tooltip — react-web wrap-style hover label with an optional [shortcut].
export function Tooltip(props: {
  label: string
  /** Single-key shortcut shown dimmed, e.g. 'L' → "Friends [L]". */
  shortcut?: string
  side?: 'right' | 'left' | 'top' | 'bottom'
  className?: string
  children: ReactNode
}): JSX.Element {
  const { side = 'right' } = props
  return (
    <span className={cx('eui-ds-tipwrap', props.className)}>
      {props.children}
      <span className={cx('eui-ds-tip', side)} role="tooltip">
        {props.label}
        {props.shortcut !== undefined && <span className="shortcut">[{props.shortcut}]</span>}
      </span>
    </span>
  )
}

// Spinner — circular loading indicator (violet arc on a faint track).
export function Spinner(props: { size?: number; color?: string }): JSX.Element {
  const { size = 28, color } = props
  const style = {
    '--sz': `${size}px`,
    ...(color !== undefined ? { '--spinner-arc': color } : {})
  } as CSSProperties
  return (
    <span className="eui-ds-spinner" style={style} role="status" aria-label="Loading">
      <svg viewBox="0 0 50 50" width={size} height={size}>
        <circle className="track" cx="25" cy="25" r="20" fill="none" strokeWidth="5" />
        <circle className="arc" cx="25" cy="25" r="20" fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray="90 160" />
      </svg>
    </span>
  )
}

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

// promoted from the worlds feature (Phase 3 of the DS migration)
export { useLoad, usePageClamp, type PageInfo } from './hooks'
export { Pager } from './Pager'
export { ConfirmButton } from './ConfirmButton'
export { CopyField, copyText } from './CopyField'
export { PanelState } from './PanelState'
export { Modal } from './Modal'
export { Chip } from './Chip'
export { Notice, NOTICE_TONES, type NoticeTone } from './Notice'
export { ContextMenu } from './ContextMenu'
export { Popover, type PopoverDensity } from './Popover'
export {
  TableEditor,
  TABLE_KINDS,
  type TableKind,
  type TableColumn,
  type TableRow,
  type TableEditorProps
} from './TableEditor'
