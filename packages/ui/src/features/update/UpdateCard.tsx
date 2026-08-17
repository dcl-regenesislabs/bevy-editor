// Application card for the Home Account section: installed version, a manual
// update check with explicit outcomes, and the release-notes link. This is the
// only place the app version is user-visible outside macOS's stock About panel.
import { useEffect, useState } from 'react'
import { Button, LinkButton, Spinner } from '../../ds'
import { RELEASES_URL, checkForUpdates, openReleaseNotes, restartToUpdate, useUpdateStatus } from './update'

export function UpdateCard(): JSX.Element | null {
  const s = useUpdateStatus()
  const [version, setVersion] = useState('')
  const [upToDate, setUpToDate] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const shell = window.editorShell
  useEffect(() => {
    void window.editorShell?.appVersion?.().then(setVersion)
  }, [])
  if (shell?.updateStatus === undefined) return null

  const check = (): void => {
    setUpToDate(false)
    void checkForUpdates().then((res) => setUpToDate(res.state === 'idle'))
  }
  const restart = (): void => {
    void restartToUpdate().then((r) => {
      if (!r.ok) setHint('Finish the current deploy first')
    })
  }
  const releaseNotes = (): void => {
    if (version === '') void shell.openExternal?.(RELEASES_URL)
    else openReleaseNotes(version)
  }

  return (
    <>
      <div className="eui-home-shelf">Application</div>
      <div className="eui-account-card eui-update-card">
        <div className="eui-account-meta">
          <span className="nm">Decentraland Studio</span>
          <span className="wa">
            {version !== '' ? `v${version}` : '…'}
            {' · '}
            <LinkButton className="notes" onClick={releaseNotes}>Release notes</LinkButton>
          </span>
        </div>
        <span style={{ flex: 1 }} />
        <div className="eui-update-actions">
          {s.state === 'checking' && (
            <span className="st">
              <Spinner size="sm" /> Checking…
            </span>
          )}
          {s.state === 'downloading' && (
            <span className="st">
              <Spinner size="sm" /> Downloading v{s.version} — {s.percent}%
            </span>
          )}
          {s.state === 'downloaded' && (
            <>
              {hint !== null ? <span className="st err">{hint}</span> : <span className="st ok">v{s.version} ready</span>}
              <Button variant="primary" size="sm" onClick={restart}>
                Restart to update
              </Button>
            </>
          )}
          {s.state === 'error' && (
            <>
              <span className="st err" data-tip={s.message}>
                Couldn't update —{' '}
                <LinkButton onClick={() => void shell.openExternal?.(RELEASES_URL)}>download manually</LinkButton>
              </span>
              <Button size="sm" onClick={check}>Retry</Button>
            </>
          )}
          {s.state === 'unsupported' && (
            <span className="st dim">
              {s.reason === 'dev' ? 'Updates are unavailable in dev builds' : 'Move the app to Applications to enable updates'}
            </span>
          )}
          {s.state === 'idle' && (
            <>
              {upToDate && <span className="st ok">You're up to date</span>}
              <Button size="sm" onClick={check}>Check for updates</Button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
