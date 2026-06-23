// Standalone design-system showcase (design-system.html). A Storybook-style
// gallery of the editor's components — no external lib: it injects the same
// styles.ts stylesheet the editor uses and renders the ds/ primitives, so what
// you see here IS the production design system. Run `npm run design-system` (Vite
// dev) and open /design-system.html, or it's built into dist alongside the editor.
import { useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { CSS } from './styles'
import { TooltipLayer } from './panels/Tooltip'
import {
  Button, IconButton, LinkButton, Segmented, Toggle, TextInput, NumberField, Select, ColorSwatch,
  TextArea, IdBadge, Panel, GroupLabel, PropRow, MenuItem, Toast, AutoSaveChip
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
  flex: 1 1 200px; min-width: 200px; max-width: 320px; box-sizing: border-box;
  border: 1px solid var(--divider-soft); border-radius: 12px; background: var(--paper-hi);
  transition: border-color 0.12s;
}
.ds-story:hover { border-color: var(--divider); }
.ds-story-preview { display: flex; align-items: center; justify-content: flex-start; gap: 10px; flex: 1; min-height: 44px; flex-wrap: wrap; }
.ds-cap { font-family: var(--font-mono); font-size: 10px; color: var(--text-3); }
.ds-swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.ds-sw { display: flex; align-items: center; gap: 10px; padding: 8px; border: 1px solid var(--divider-soft); border-radius: 10px; background: var(--paper-hi); }
.ds-sw .chip { width: 34px; height: 34px; border-radius: 7px; flex: none; border: 1px solid var(--divider); }
.ds-sw .meta { display: flex; flex-direction: column; min-width: 0; }
.ds-sw .meta b { font-size: 12px; }
.ds-sw .meta code { font-family: var(--font-mono); font-size: 10px; color: var(--text-3); }
.ds-type-row { display: flex; align-items: baseline; gap: 16px; padding: 6px 0; border-bottom: 1px solid var(--divider-soft); }
.ds-tip-demo { position: relative; }
`

function Story(props: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="ds-story">
      <div className="ds-story-preview">{props.children}</div>
      <span className="ds-cap">{props.title}</span>
    </div>
  )
}

const COLORS: Array<{ name: string; varName: string }> = [
  { name: 'Paper', varName: '--paper' },
  { name: 'Paper hi', varName: '--paper-hi' },
  { name: 'Input', varName: '--input' },
  { name: 'Text', varName: '--text' },
  { name: 'Text 2', varName: '--text-2' },
  { name: 'Text 3', varName: '--text-3' },
  { name: 'Primary', varName: '--primary' },
  { name: 'Primary dark', varName: '--primary-dark' },
  { name: 'Error', varName: '--error' },
  { name: 'Success', varName: '--success' }
]

function Foundations(): JSX.Element {
  return (
    <>
      <div className="ds-h2">Color</div>
      <div className="ds-swatches">
        {COLORS.map((c) => (
          <div className="ds-sw" key={c.varName}>
            <span className="chip" style={{ background: `var(${c.varName})` }} />
            <span className="meta">
              <b>{c.name}</b>
              <code>{c.varName}</code>
            </span>
          </div>
        ))}
      </div>
      <div className="ds-h2">Typography</div>
      <div style={{ maxWidth: 640 }}>
        <div className="ds-type-row"><span style={{ fontSize: 22, fontWeight: 700 }}>Inter</span><span className="ds-cap">prose · 13px base</span></div>
        <div className="ds-type-row"><span style={{ fontFamily: 'var(--font-mono)', fontSize: 16 }}>SF Mono 0123</span><span className="ds-cap">--font-mono · ids, labels, numbers</span></div>
      </div>
    </>
  )
}

function Buttons(): JSX.Element {
  const [active, setActive] = useState(true)
  return (
    <div className="ds-grid">
      <Story title="default"><Button tip="A default button">Button</Button></Story>
      <Story title="primary"><Button variant="primary">Generate .tsx</Button></Story>
      <Story title="disabled"><Button disabled>Save</Button><Button variant="primary" disabled>Save</Button></Story>
      <Story title="icon"><IconButton tip="Icon button">◧</IconButton><IconButton active>▣</IconButton></Story>
      <Story title="icon active (toggle)"><IconButton active={active} onClick={() => setActive((a) => !a)}>★</IconButton></Story>
      <Story title="link"><LinkButton>fields → json</LinkButton></Story>
    </div>
  )
}

function Segmenteds(): JSX.Element {
  const [v, setV] = useState<'scene' | 'ui'>('scene')
  return (
    <div className="ds-grid">
      <Story title="Segmented (Scene | UI)">
        <Segmented value={v} onChange={setV} options={[{ value: 'scene', label: 'Scene' }, { value: 'ui', label: 'UI' }]} />
      </Story>
    </div>
  )
}

function Toggles(): JSX.Element {
  const [on, setOn] = useState(true)
  return (
    <div className="ds-grid">
      <Story title="off"><Toggle on={false} onChange={() => {}} /></Story>
      <Story title="on"><Toggle on onChange={() => {}} /></Story>
      <Story title="interactive"><Toggle on={on} onChange={setOn} /></Story>
    </div>
  )
}

function Inputs(): JSX.Element {
  const [num, setNum] = useState('42')
  const [sel, setSel] = useState<'px' | '%'>('px')
  const [color, setColor] = useState('#8c5bf6')
  return (
    <div className="ds-grid">
      <Story title="text"><div style={{ width: 200 }}><TextInput placeholder="Player name…" /></div></Story>
      <Story title="number"><div style={{ width: 90 }}><NumberField value={num} onChange={(e) => setNum(e.target.value)} /></div><div style={{ width: 90 }}><NumberField dirty defaultValue={7} /></div></Story>
      <Story title="select"><div style={{ width: 90 }}><Select value={sel} onChange={setSel} options={[{ value: 'px' }, { value: '%' }]} /></div></Story>
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
            <PropRow label="Visible"><Toggle on onChange={() => {}} /></PropRow>
          </div>
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
      <Story title="tooltip (hover the button)"><Button tip="This is a tooltip">Hover me</Button></Story>
      <Story title="tooltip (static)"><span className="eui-tip" style={{ position: 'static', transform: 'none' }}>Free camera (WASD + mouse)</span></Story>
    </div>
  )
}

const SECTIONS: Array<{ id: string; label: string; Comp: () => JSX.Element }> = [
  { id: 'foundations', label: 'Foundations', Comp: Foundations },
  { id: 'buttons', label: 'Buttons', Comp: Buttons },
  { id: 'segmented', label: 'Segmented', Comp: Segmenteds },
  { id: 'toggles', label: 'Toggles', Comp: Toggles },
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
            <code style={{ fontFamily: 'var(--font-mono)' }}>ds/</code> primitives — the same code the editor ships.
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
