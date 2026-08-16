import { useState } from 'react'
import { Button, CopyField, Modal, PanelState, useLoad } from '../../ds'
import { getStreamAccess, isSceneNotIndexed, mutateStreamAccess } from './gatekeeper'
import type { WorldEntry } from './inventory'
import { sceneLabelProse, sceneTotalOf } from './scene-label'
import { scenePanelProps, type ScenePanelProps } from './scene-panel'
import { ScenePick } from './ScenePick'

const NOT_INDEXED = "This scene isn't indexed yet — try again in a few minutes."

function actionError(e: unknown): string {
  if (isSceneNotIndexed(e)) return NOT_INDEXED
  return e instanceof Error ? e.message : String(e)
}

export function StreamingPanel(props: { w: WorldEntry; picked: string[]; onPick: (key: string) => void }): JSX.Element {
  const { w } = props
  return (
    <>
      <section className="eui-world-block">
        <h2>Streaming</h2>
        <p className="eui-world-hint">
          Each scene has its own streaming key. A key streams video into that scene and nowhere else.
        </p>
        <p className="eui-world-hint">
          Generate a key, paste the URL and key into OBS or any RTMP tool, and go live.
        </p>
        <p className="eui-world-hint">
          Who is allowed to stream in this world at all is set under Permissions → Who can stream.
        </p>
      </section>
      <ScenePick
        w={w}
        picked={props.picked}
        onPick={props.onPick}
        publishFirst={`Streaming keys belong to a scene. Publish a scene to ${w.name} and its key appears here.`}
        render={(scene) => <SceneStreaming {...scenePanelProps(w, scene)} />}
      />
    </>
  )
}

export function SceneStreaming(props: ScenePanelProps): JSX.Element {
  const { scene, scope } = props
  const total = sceneTotalOf(props.world)
  const prose = sceneLabelProse(scene, total)
  const [busy, setBusy] = useState(false)
  const [actErr, setActErr] = useState<string | null>(null)
  const [ask, setAsk] = useState<'reset' | 'revoke' | null>(null)
  const { data, err, reload } = useLoad(
    () => (scope === null ? Promise.resolve(null) : getStreamAccess(scope)),
    [scope?.sceneId]
  )
  if (scope === null) {
    return (
      <p className="eui-world-hint">
        Streaming keys are handed out per scene, and {prose} hasn't finished publishing — try again in a few minutes.
      </p>
    )
  }
  const run = (action: 'create' | 'reset' | 'revoke'): void => {
    setAsk(null)
    setBusy(true)
    setActErr(null)
    mutateStreamAccess(scope, action)
      .then(reload)
      .catch((e: unknown) => setActErr(actionError(e)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="eui-world-scenebody">
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
          {data.endsAt !== null && <p className="eui-world-hint">Expires {new Date(data.endsAt).toLocaleString()}.</p>}
          <div className="eui-signin-row">
            <Button size="sm" disabled={busy} onClick={() => setAsk('reset')}>
              Reset key
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => setAsk('revoke')}>
              Revoke
            </Button>
          </div>
        </>
      )}
      {actErr !== null && <p className="eui-perm-err">{actErr}</p>}
      {ask === 'reset' && (
        <Modal
          title={`Reset the key for ${prose}?`}
          onClose={() => setAsk(null)}
          footer={
            <>
              <Button onClick={() => setAsk(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => run('reset')}>
                Reset key
              </Button>
            </>
          }
        >
          <p className="eui-world-hint">
            The old key stops working right away — paste the new one into your streaming app before you go live again.
          </p>
        </Modal>
      )}
      {ask === 'revoke' && (
        <Modal
          title={`Revoke the streaming key for ${prose}?`}
          onClose={() => setAsk(null)}
          footer={
            <>
              <Button onClick={() => setAsk(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => run('revoke')}>
                Revoke
              </Button>
            </>
          }
        >
          <p className="eui-world-hint">
            Anything streaming into that scene stops immediately.
            {total > 1 && ' The other scenes in this world keep their own keys.'}
          </p>
        </Modal>
      )}
    </div>
  )
}
