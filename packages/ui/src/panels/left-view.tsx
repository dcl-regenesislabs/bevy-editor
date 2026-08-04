export type LeftView = 'scene' | 'prefabs' | 'assets'

const VIEWS: ReadonlyArray<{ value: LeftView; label: string }> = [
  { value: 'scene', label: 'Scene' },
  { value: 'prefabs', label: 'Prefabs' },
  { value: 'assets', label: 'Assets' }
]

export function isLeftView(v: string): v is LeftView {
  return VIEWS.some((t) => t.value === v)
}

export function LeftTabs(props: { view: LeftView; onView: (v: LeftView) => void }): JSX.Element {
  return (
    <div className="eui-left-tabs">
      {VIEWS.map((t) => (
        <button
          key={t.value}
          className={`eui-ltab${props.view === t.value ? ' active' : ''}`}
          onClick={() => props.onView(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
