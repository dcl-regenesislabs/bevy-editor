// OBS/RTMP streaming keys for the live scene (comms-gatekeeper).
import { useState } from 'react'
import { Button, ConfirmButton, CopyField, PanelState, useLoad } from '../../ds'
import { getStreamAccess, mutateStreamAccess, type SceneScope } from '../../worlds'
import { PublishFirst } from './common'

// ---- streaming keys (OBS / RTMP) ----
export function StreamingPanel(props: { scope: SceneScope | null }): JSX.Element {
  const { scope } = props
  const [busy, setBusy] = useState(false)
  const [actErr, setActErr] = useState<string | null>(null)
  const { data, err, reload } = useLoad(
    () => (scope === null ? Promise.resolve(null) : getStreamAccess(scope)),
    [scope?.sceneId]
  )
  if (scope === null) return <PublishFirst what="Streaming" />
  const run = (action: 'create' | 'reset' | 'revoke'): void => {
    setBusy(true)
    setActErr(null)
    mutateStreamAccess(scope, action)
      .then(reload)
      .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }
  return (
    <section className="eui-world-block">
      <h2>Live streaming</h2>
      <p className="eui-world-hint">
        Stream video into your world with OBS or any RTMP tool: generate a key, paste the URL and key into your
        streaming app, and go live. Keys expire after 4 days.
      </p>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data === null && err === null && (
        <Button variant="primary" size="sm" disabled={busy} onClick={() => run('create')}>
          {busy ? 'Generating…' : 'Generate streaming key'}
        </Button>
      )}
      {data !== undefined && data !== null && (
        <>
          <CopyField label="Server URL" value={data.url} />
          <CopyField label="Stream key" value={data.key} secret />
          {data.endsAt !== null && (
            <p className="eui-world-hint">Expires {new Date(data.endsAt).toLocaleString()}.</p>
          )}
          <div className="eui-signin-row">
            <Button size="sm" disabled={busy} onClick={() => run('reset')}>Reset key</Button>
            <button className="eui-link danger" disabled={busy} onClick={() => run('revoke')}>Revoke</button>
          </div>
        </>
      )}
      {actErr !== null && <p className="eui-perm-err">{actErr}</p>}
    </section>
  )
}
