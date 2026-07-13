import { Spinner } from './index'

export function PanelState(props: { err: string | null; onRetry: () => void; loading: boolean }): JSX.Element | null {
  if (props.err !== null) {
    return (
      <p className="eui-world-hint">
        {props.err} <button className="eui-link" onClick={props.onRetry}>Retry</button>
      </p>
    )
  }
  if (props.loading) {
    return <div className="eui-world-hint"><Spinner size={16} /> Loading…</div>
  }
  return null
}
