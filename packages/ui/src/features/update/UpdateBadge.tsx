// The passive "Restart to update" affordance in the Home rail — the only
// common-path update UI. Renders nothing until an update is staged.
import { useState } from 'react'
import { Button } from '../../ds'
import { restartToUpdate, useUpdateStatus } from './update'

export function UpdateBadge(): JSX.Element | null {
  const s = useUpdateStatus()
  const [hint, setHint] = useState<string | null>(null)
  if (s.state !== 'downloaded') return null
  const restart = (): void => {
    void restartToUpdate().then((r) => {
      if (!r.ok) setHint('Finish the current deploy first')
    })
  }
  return (
    <div className="eui-update-rail">
      <span className="v">Update ready — v{s.version}</span>
      <Button variant="primary" size="sm" onClick={restart}>
        Restart to update
      </Button>
      {hint !== null && <span className="hint">{hint}</span>}
    </div>
  )
}
