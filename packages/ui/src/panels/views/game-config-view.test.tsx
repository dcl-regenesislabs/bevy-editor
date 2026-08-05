import { describe, expect, it, vi } from 'vitest'
import { GameConfigView } from './game-config-view'
import { defaultGameConfig, normalizeGameConfig, type GameConfigValue } from '../../gameconfig/normalize'
import { mount } from '../../test/render'

function view(value: unknown, apply: (json: string) => void = () => {}): ReturnType<typeof mount> {
  return mount(
    <GameConfigView
      cKey="0/editor::GameConfig"
      entityId="0"
      name="editor::GameConfig"
      value={value}
      schema={undefined}
      commit={() => {}}
      apply={apply}
    />
  )
}

const applied = (fn: ReturnType<typeof vi.fn>, call = 0): GameConfigValue =>
  normalizeGameConfig(JSON.parse(String(fn.mock.calls[call][0])))

describe('GameConfigView render', () => {
  it('mounts on an empty component and offers the starter set', () => {
    const v = view(undefined)
    expect(v.text()).toContain('v0')
    expect(v.byText('Start from the wave-shooter defaults', 'button')).not.toBeNull()
    expect(v.all('.eui-ds-table')).toHaveLength(0)
    v.unmount()
  })

  it('seeds the wave-shooter defaults and bumps the version', () => {
    const apply = vi.fn()
    const v = view(undefined, apply)
    v.click(v.byText('Start from the wave-shooter defaults', 'button'))
    const next = applied(apply)
    expect(next.tables.map((t) => t.name)).toEqual(['waves', 'weapons', 'zombie'])
    expect(next.version).toBe(defaultGameConfig().version + 1)
    v.unmount()
  })

  it('renders one table editor per table and hides the starter offer', () => {
    const v = view(defaultGameConfig())
    expect(v.all('.eui-ds-table')).toHaveLength(3)
    expect(v.byText('Start from the wave-shooter defaults', 'button')).toBeNull()
    expect(v.text()).toContain('v1')
    v.unmount()
  })

  it('notes the array/record rule only on tables that are not keyed', () => {
    const v = view(defaultGameConfig())
    const notes = v.all('.eui-ds-table-note')
    expect(notes).toHaveLength(1)
    expect(notes[0].textContent?.length ?? 0).toBeGreaterThan(0)
    v.unmount()
  })

  it('refuses a duplicate table name and keeps Add disabled', () => {
    const v = view(defaultGameConfig())
    const input = v.find('[aria-label="new table name"]') as HTMLInputElement
    expect(input).not.toBeNull()
    const add = v.all('button').find((b) => b.textContent === 'Add')
    expect(add?.hasAttribute('disabled')).toBe(true)
    v.unmount()
  })

  it('lists top-level values with a labelled editor and a remove button', () => {
    const v = view(defaultGameConfig())
    expect(v.find('[aria-label="WINNER_POINTS value"]')).not.toBeNull()
    expect(v.find('[aria-label="remove WINNER_POINTS"]')).not.toBeNull()
    v.unmount()
  })

  it('removes a value without touching the tables', () => {
    const apply = vi.fn()
    const v = view(defaultGameConfig(), apply)
    v.click(v.find('[aria-label="remove WINNER_POINTS"]'))
    const next = applied(apply)
    expect(next.values).toEqual([])
    expect(next.tables).toHaveLength(3)
    v.unmount()
  })

  it('survives a malformed stored value', () => {
    const v = view({ version: 'nope', tables: 'nope', values: [{ name: 'x' }] })
    expect(v.text()).toContain('v0')
    expect(v.find('[aria-label="x value"]')).not.toBeNull()
    v.unmount()
  })

  it('names an unnamed table and an unnamed value rather than showing a gap', () => {
    const v = view({ version: 2, tables: [{ name: '', columns: [], rows: [] }], values: [{ name: '', kind: 'number', value: '1' }] })
    expect(v.find('.eui-ds-table-head .t')?.textContent).toBe('unnamed')
    expect(v.all('.eui-prop .plabel').map((l) => l.textContent)).toContain('unnamed')
    v.unmount()
  })
})
