// The passive "restart to update" affordance in the Home rail — the only
// common-path update UI. Renders nothing until an update is staged, then a
// quiet chip in the rail's own language (a sibling of the account chip below
// it): the whole row is the restart action.
import { useRef, useState } from 'react'
import { restartToUpdate, useUpdateStatus } from './update'

const UpIcon = (): JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M7 11.5V3M3.4 6.4 7 2.8l3.6 3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export function UpdateBadge(): JSX.Element | null {
  const s = useUpdateStatus()
  const [busy, setBusy] = useState(false)
  const busyTimer = useRef<ReturnType<typeof setTimeout>>()
  if (s.state !== 'downloaded') return null
  const restart = (): void => {
    void restartToUpdate().then((r) => {
      if (r.ok) return
      setBusy(true) // deploy or AI turn running — say why, then let them retry
      clearTimeout(busyTimer.current)
      busyTimer.current = setTimeout(() => setBusy(false), 5000)
    })
  }
  return (
    <button className="eui-update-chip" onClick={restart}>
      <span className="ic">
        <UpIcon />
      </span>
      <span className="meta">
        <span className="nm">Update ready</span>
        <span className={`sub ${busy ? 'busy' : ''}`}>
          {busy ? 'Finish the deploy first' : `Restart to get v${s.version}`}
        </span>
      </span>
    </button>
  )
}
