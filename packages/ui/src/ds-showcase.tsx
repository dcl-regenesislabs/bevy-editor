// Standalone design-system showcase (design-system.html). A Storybook-style
// gallery of the editor's components — no external lib: it injects the same
// styles.ts stylesheet the editor uses and renders the ds/ primitives, so what
// you see here IS the production design system (Explorer 2.0 tokens ported
// from bevy-explorer react-web). Run `npm run design-system` (Vite dev) and
// open /design-system.html, or it's built into dist alongside the editor.
import '@fontsource-variable/inter/index.css'
import { useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { CSS } from './styles'
import { TooltipLayer } from './panels/Tooltip'
import {
  Button, IconButton, LinkButton, ControlButton, Segmented, Toggle, Checkbox, TextInput, NumberField,
  Select, Dropdown, Slider, ColorSwatch, TextArea, IdBadge, Panel, GroupLabel, PropRow, MenuItem,
  FieldLabel, SearchField, Tooltip, Spinner, Toast, AutoSaveChip
} from './ds'

// Showcase chrome only — the components themselves are 100% styles.ts. Overrides
// neutralise .eui-root's fixed/overlay layout so it reads as a normal page.
const SHOWCASE_CSS = `
.ds-root {
  position: static; inset: auto; z-index: auto; pointer-events: auto;
  min-height: 100vh; display: flex; align-items: stretch;
}
.ds-sidebar {
  flex: none; width: 240px; padding: 20px 12px; box-sizing: border-box;
  border-right: 1px solid var(--divider); position: sticky; top: 0; height: 100vh; overflow-y: auto;
  background: var(--paper);
}
.ds-brand { display: flex; flex-direction: column; gap: 2px; padding: 0 8px 18px; }
.ds-brand .name { font-size: 15px; font-weight: 700; }
.ds-brand .sub { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-3); }
.ds-nav { display: flex; flex-direction: column; gap: 2px; }
.ds-nav button {
  text-align: left; padding: 7px 10px; border-radius: 7px; border: none; background: transparent;
  color: var(--text-2); font: inherit; font-size: 13px; cursor: pointer;
}
.ds-nav button:hover { background: var(--hover); color: var(--text); }
.ds-nav button.active { background: var(--primary-selected); color: var(--text); box-shadow: inset 2px 0 0 var(--primary); }
.ds-main { flex: 1; min-width: 0; padding: 40px 48px 96px; overflow-y: auto; height: 100vh; box-sizing: border-box; }
.ds-inner { max-width: 1040px; }
.ds-h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 6px; }
.ds-lead { color: var(--text-2); font-size: 13px; line-height: 1.5; margin: 0 0 32px; max-width: 64ch; }
.ds-h2 { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-3); margin: 32px 0 14px; }
.ds-grid { display: flex; flex-wrap: wrap; gap: 14px; align-items: stretch; }
.ds-story {
  display: flex; flex-direction: column; gap: 12px; padding: 18px 16px 14px;
  flex: 1 1 200px; min-width: 200px; max-width: 340px; box-sizing: border-box;
  border: 1px solid var(--divider-soft); border-radius: var(--r-card); background: var(--paper-hi);
  transition: border-color 0.12s;
}
.ds-story:hover { border-color: var(--divider); }
.ds-story-preview { display: flex; align-items: center; justify-content: flex-start; gap: 10px; flex: 1; min-height: 44px; flex-wrap: wrap; }
.ds-cap { font-family: var(--font-mono); font-size: 10px; color: var(--text-3); }
.ds-swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.ds-sw { border: 1px solid var(--divider-soft); border-radius: var(--r-card); overflow: hidden; background: var(--paper-hi); }
.ds-sw .chip { height: 56px; display: flex; align-items: flex-end; padding: 8px; font-size: 11px; font-weight: 700; }
.ds-sw .meta { display: flex; flex-direction: column; min-width: 0; padding: 8px 10px; }
.ds-sw .meta b { font-size: 12px; }
.ds-sw .meta code { font-family: var(--font-mono); font-size: 10px; color: var(--text-3); }
.ds-type-row { display: flex; align-items: baseline; gap: 16px; padding: 6px 0; border-bottom: 1px solid var(--divider-soft); }
.ds-type-row code { flex: none; width: 110px; font-family: var(--font-mono); font-size: 11px; color: var(--text-3); }
.ds-ink-row { display: flex; align-items: center; gap: 16px; padding: 5px 0; }
.ds-ink-row code { flex: none; width: 110px; font-family: var(--font-mono); font-size: 11px; color: var(--text-3); }
.ds-radii { display: flex; gap: 18px; flex-wrap: wrap; }
.ds-radius { text-align: center; }
.ds-radius .box { width: 72px; height: 72px; background: var(--fill-4); border: 1px solid var(--white-10); }
.ds-radius code { display: block; margin-top: 6px; font-family: var(--font-mono); font-size: 10px; color: var(--text-3); }
`

function Story(props: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="ds-story">
      <div className="ds-story-preview">{props.children}</div>
      <span className="ds-cap">{props.title}</span>
    </div>
  )
}

// ---------- foundations ----------
const PALETTE: Array<{ name: string; varName: string; hex: string; dark?: boolean }> = [
  { name: 'Brand / Violet', varName: '--brand', hex: '#982de2' },
  { name: 'Brand hover', varName: '--brand-hover', hex: '#ad4af0' },
  { name: 'Panel', varName: '--panel', hex: '#161518' },
  { name: 'Accent / Orange', varName: '--accent', hex: '#ff743a', dark: true },
  { name: 'Text / Snow', varName: '--text', hex: '#fcfcfc', dark: true },
  { name: 'Gold', varName: '--gold', hex: '#ffc95b', dark: true },
  { name: 'Purple', varName: '--purple', hex: '#982de2' },
  { name: 'Green', varName: '--green', hex: '#30cd00', dark: true },
  { name: 'Lavender', varName: '--lavender', hex: '#c640cd' },
  { name: 'Error', varName: '--error', hex: '#ff2424' },
  { name: 'Success', varName: '--success', hex: '#44b600', dark: true }
]

const FILLS = ['--fill-1', '--fill-2', '--fill-3', '--fill-4', '--fill-5', '--line', '--white-10']
const INKS = ['--ink-95', '--ink-85', '--ink-7', '--ink-65', '--ink-6', '--ink-45']
const RADII = ['--r-control', '--r-card', '--r-panel', '--r-pill']
const TYPE: Array<{ token: string; weight: number }> = [
  { token: '--fs-xs', weight: 600 },
  { token: '--fs-sm', weight: 500 },
  { token: '--fs-md', weight: 500 },
  { token: '--fs-lg', weight: 600 },
  { token: '--fs-title', weight: 700 },
  { token: '--fs-display', weight: 800 }
]

function Foundations(): JSX.Element {
  return (
    <>
      <div className="ds-h2">Palette (tokens)</div>
      <div className="ds-swatches">
        {PALETTE.map((c) => (
          <div className="ds-sw" key={c.varName}>
            <div className="chip" style={{ background: `var(${c.varName})`, color: c.dark === true ? '#161518' : '#fcfcfc' }}>
              {c.hex.toUpperCase()}
            </div>
            <span className="meta">
              <b>{c.name}</b>
              <code>{c.varName}</code>
            </span>
          </div>
        ))}
      </div>

      <div className="ds-h2">Surface washes &amp; hairlines</div>
      <div className="ds-swatches">
        {FILLS.map((v) => (
          <div className="ds-sw" key={v}>
            <div className="chip" style={{ background: `var(${v})` }} />
            <span className="meta">
              <code>{v}</code>
            </span>
          </div>
        ))}
      </div>

      <div className="ds-h2">Ink ramp (text on dark)</div>
      <div style={{ maxWidth: 640 }}>
        {INKS.map((v) => (
          <div className="ds-ink-row" key={v}>
            <code>{v}</code>
            <span style={{ color: `var(${v})`, fontSize: 14, fontWeight: 600 }}>The quick brown fox — Decentraland</span>
          </div>
        ))}
      </div>

      <div className="ds-h2">Radii</div>
      <div className="ds-radii">
        {RADII.map((v) => (
          <div className="ds-radius" key={v}>
            <div className="box" style={{ borderRadius: `var(${v})` }} />
            <code>{v}</code>
          </div>
        ))}
      </div>

      <div className="ds-h2">Type scale (Inter Variable)</div>
      <div style={{ maxWidth: 640 }}>
        {TYPE.map((t) => (
          <div className="ds-type-row" key={t.token}>
            <code>{t.token}</code>
            <span style={{ fontSize: `var(${t.token})`, fontWeight: t.weight }}>Decentraland — 0123456789</span>
          </div>
        ))}
        <div className="ds-type-row">
          <code>--font-mono</code>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>ids, labels, numbers 0123</span>
        </div>
      </div>
    </>
  )
}

// ---------- components ----------
function Buttons(): JSX.Element {
  return (
    <>
      <div className="ds-h2">Pill CTA (react-web)</div>
      <div className="ds-grid">
        <Story title="primary · sm / md / lg">
          <Button variant="primary" size="sm">Jump in</Button>
          <Button variant="primary" size="md">Jump in</Button>
          <Button variant="primary" size="lg">Jump in</Button>
        </Story>
        <Story title="secondary">
          <Button variant="secondary" size="sm">Cancel</Button>
          <Button variant="secondary" size="md">Cancel</Button>
        </Story>
        <Story title="ghost">
          <Button variant="ghost" size="sm">Learn more</Button>
          <Button variant="ghost" size="md">Learn more</Button>
        </Story>
        <Story title="disabled">
          <Button variant="primary" size="md" disabled>Save</Button>
          <Button variant="secondary" size="md" disabled>Save</Button>
        </Story>
      </div>
      <div className="ds-h2">Editor chrome buttons</div>
      <div className="ds-grid">
        <Story title="default (quiet)"><Button tip="A default button">Button</Button></Story>
        <Story title="eui primary (28px rows)"><button className="eui-btn primary">Generate .tsx</button></Story>
        <Story title="icon"><IconButton tip="Icon button">◧</IconButton><IconButton active>▣</IconButton></Story>
        <Story title="link"><LinkButton>fields → json</LinkButton></Story>
      </div>
    </>
  )
}

function ControlButtons(): JSX.Element {
  const [active, setActive] = useState(true)
  return (
    <div className="ds-grid">
      <Story title="ghost · square / circle">
        <ControlButton>✕</ControlButton>
        <ControlButton shape="circle">←</ControlButton>
        <ControlButton size="sm">☰</ControlButton>
      </Story>
      <Story title="solid">
        <ControlButton variant="solid">✕</ControlButton>
        <ControlButton variant="solid" shape="circle">☺</ControlButton>
      </Story>
      <Story title="pill (label + value)">
        <ControlButton shape="pill">Likes 12</ControlButton>
        <ControlButton variant="solid" shape="pill">99+</ControlButton>
      </Story>
      <Story title="active (toggle)">
        <ControlButton active={active} onClick={() => setActive((a) => !a)}>★</ControlButton>
      </Story>
    </div>
  )
}

function Selection(): JSX.Element {
  const [res, setRes] = useState('1080')
  const [quality, setQuality] = useState('High')
  return (
    <div className="ds-grid">
      <Story title="Select — dark">
        <Select
          value={res}
          onChange={setRes}
          options={[
            { value: '720', label: '1280 × 720' },
            { value: '1080', label: '1920 × 1080' },
            { value: '1440', label: '2560 × 1440' }
          ]}
        />
      </Story>
      <Story title="Select — light">
        <Select
          variant="light"
          value={res}
          onChange={setRes}
          options={[
            { value: '720', label: '1280 × 720' },
            { value: '1080', label: '1920 × 1080' },
            { value: '1440', label: '2560 × 1440' }
          ]}
        />
      </Story>
      <Story title="Dropdown (keyboard nav)">
        <div style={{ width: 200 }}>
          <Dropdown options={['Low', 'Medium', 'High', 'Ultra']} value={quality} onChange={setQuality} />
        </div>
      </Story>
      <Story title="Segmented (editor)">
        <SegDemo />
      </Story>
    </div>
  )
}

function SegDemo(): JSX.Element {
  const [v, setV] = useState<'scene' | 'ui'>('scene')
  return <Segmented value={v} onChange={setV} options={[{ value: 'scene', label: 'Scene' }, { value: 'ui', label: 'UI' }]} />
}

function SlidersAndToggles(): JSX.Element {
  const [vol, setVol] = useState(60)
  const [sens, setSens] = useState(4)
  const [on, setOn] = useState(true)
  const [agree, setAgree] = useState(true)
  return (
    <div className="ds-grid">
      <Story title="Slider">
        <div style={{ width: 220 }}><Slider value={vol} onChange={setVol} aria-label="Volume" /></div>
        <span className="ds-cap">{vol}</span>
      </Story>
      <Story title="Slider — arrows">
        <div style={{ width: 220 }}><Slider value={sens} min={1} max={10} onChange={setSens} arrows aria-label="Sensitivity" /></div>
        <span className="ds-cap">{sens}</span>
      </Story>
      <Story title="Slider — disabled">
        <div style={{ width: 220 }}><Slider value={30} onChange={() => {}} disabled /></div>
      </Story>
      <Story title="Toggle">
        <Toggle checked={false} onChange={() => {}} />
        <Toggle checked onChange={() => {}} />
        <Toggle checked={on} onChange={setOn} aria-label="Interactive" />
      </Story>
      <Story title="Toggle — disabled">
        <Toggle checked disabled onChange={() => {}} />
      </Story>
      <Story title="Checkbox">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Checkbox checked={agree} onChange={setAgree}>I agree to the terms</Checkbox>
          <Checkbox defaultChecked={false}>Uncontrolled</Checkbox>
        </div>
      </Story>
    </div>
  )
}

function Inputs(): JSX.Element {
  const [num, setNum] = useState('42')
  const [color, setColor] = useState('#982de2')
  const [q, setQ] = useState('')
  return (
    <div className="ds-grid">
      <Story title="text"><div style={{ width: 200 }}><TextInput placeholder="Player name…" /></div></Story>
      <Story title="number"><div style={{ width: 90 }}><NumberField value={num} onChange={(e) => setNum(e.target.value)} /></div><div style={{ width: 90 }}><NumberField dirty defaultValue={7} /></div></Story>
      <Story title="SearchField"><div style={{ width: 240 }}><SearchField value={q} onChange={setQ} placeholder="Search assets" /></div></Story>
      <Story title="FieldLabel">
        <div style={{ width: 240 }}>
          <FieldLabel notice="*" sublabel="Shown above your avatar.">Display name</FieldLabel>
          <TextInput placeholder="e.g. Ada" />
        </div>
      </Story>
      <Story title="color"><ColorSwatch value={color} onChange={(e) => setColor(e.target.value)} /></Story>
      <Story title="textarea"><div style={{ width: 280 }}><TextArea defaultValue={'{\n  "value": 1250\n}'} /></div></Story>
    </div>
  )
}

function Badges(): JSX.Element {
  return (
    <div className="ds-grid">
      <Story title="entity id"><IdBadge>#512</IdBadge></Story>
      <Story title="autosave — saved"><AutoSaveChip state="ok">Saved</AutoSaveChip></Story>
      <Story title="autosave — unsaved"><AutoSaveChip state="dim">Unsaved</AutoSaveChip></Story>
      <Story title="autosave — failed"><AutoSaveChip state="err">Save failed</AutoSaveChip></Story>
      <Story title="Spinner">
        <Spinner size={20} />
        <Spinner />
        <Spinner size={40} color="var(--gold)" />
      </Story>
    </div>
  )
}

function Surfaces(): JSX.Element {
  return (
    <div className="ds-grid">
      <div style={{ width: 264, height: 220, position: 'relative' }}>
        <Panel overline="Inspector" title="Door" actions={<IconButton tip="Add component">＋</IconButton>}>
          <GroupLabel>Transform</GroupLabel>
          <div style={{ padding: '0 12px' }}>
            <PropRow label="Position"><NumberField defaultValue={0} /><NumberField defaultValue={1} /><NumberField defaultValue={0} /></PropRow>
            <PropRow label="Visible"><Toggle checked onChange={() => {}} /></PropRow>
          </div>
        </Panel>
      </div>
      <div style={{ width: 264, height: 220, position: 'relative', background: 'repeating-linear-gradient(45deg, #2a2830 0 12px, #1a191d 12px 24px)', borderRadius: 18, padding: 16 }}>
        <Panel blur title="Frosted" titleDim>
          <div style={{ padding: 12, color: 'var(--ink-7)', fontSize: 12 }}>blur variant — for in-world overlays.</div>
        </Panel>
      </div>
    </div>
  )
}

function Menus(): JSX.Element {
  return (
    <div className="ds-grid">
      <div className="eui-menu" style={{ position: 'relative', top: 0, right: 0, minWidth: 224 }}>
        <div className="eui-menu-label">Camera</div>
        <MenuItem hint="●">Player camera</MenuItem>
        <MenuItem>Free fly</MenuItem>
        <div className="eui-menu-sep" />
        <MenuItem danger>Delete entity</MenuItem>
      </div>
    </div>
  )
}

function Feedback(): JSX.Element {
  return (
    <div className="ds-grid">
      <Story title="toast"><div style={{ position: 'relative', height: 38 }}><Toast>Saved to main.composite</Toast></div></Story>
      <Story title="Tooltip (hover, 4 sides)">
        <Tooltip label="Backpack" shortcut="B" side="top"><ControlButton>▲</ControlButton></Tooltip>
        <Tooltip label="Map" side="bottom"><ControlButton>▼</ControlButton></Tooltip>
        <Tooltip label="Friends" shortcut="L" side="right"><ControlButton>▶</ControlButton></Tooltip>
        <Tooltip label="Settings" side="left"><ControlButton>◀</ControlButton></Tooltip>
      </Story>
      <Story title="data-tip layer (editor)"><Button tip="This is a tooltip">Hover me</Button></Story>
    </div>
  )
}

const SECTIONS: Array<{ id: string; label: string; Comp: () => JSX.Element }> = [
  { id: 'foundations', label: 'Foundations', Comp: Foundations },
  { id: 'buttons', label: 'Buttons', Comp: Buttons },
  { id: 'controlbutton', label: 'ControlButton', Comp: ControlButtons },
  { id: 'selection', label: 'Select & Dropdown', Comp: Selection },
  { id: 'sliders', label: 'Sliders & toggles', Comp: SlidersAndToggles },
  { id: 'inputs', label: 'Inputs', Comp: Inputs },
  { id: 'badges', label: 'Badges & status', Comp: Badges },
  { id: 'surfaces', label: 'Surfaces', Comp: Surfaces },
  { id: 'menus', label: 'Menus', Comp: Menus },
  { id: 'feedback', label: 'Feedback', Comp: Feedback }
]

function Showcase(): JSX.Element {
  const [active, setActive] = useState(0)
  const section = SECTIONS[active]
  const Section = section.Comp
  return (
    <div className="eui-root ds-root">
      <TooltipLayer />
      <aside className="ds-sidebar">
        <div className="ds-brand">
          <span className="name">Editor UI</span>
          <span className="sub">Design system</span>
        </div>
        <nav className="ds-nav">
          {SECTIONS.map((s, i) => (
            <button key={s.id} className={i === active ? 'active' : ''} onClick={() => setActive(i)}>
              {s.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="ds-main">
        <div className="ds-inner">
          <h1 className="ds-h1">{section.label}</h1>
          <p className="ds-lead">
            Live components rendered from the editor’s own stylesheet (<code style={{ fontFamily: 'var(--font-mono)' }}>styles.ts</code>) and{' '}
            <code style={{ fontFamily: 'var(--font-mono)' }}>ds/</code> primitives — Explorer 2.0 tokens ported from bevy-explorer react-web.
          </p>
          <Section />
        </div>
      </main>
    </div>
  )
}

const style = document.createElement('style')
style.textContent = CSS + SHOWCASE_CSS
document.head.appendChild(style)
const rootEl = document.getElementById('root')
if (rootEl) createRoot(rootEl).render(<Showcase />)
