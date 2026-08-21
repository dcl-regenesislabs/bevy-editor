import { useEffect } from 'react'
import { state } from '@scene/state'
import { entityName } from '@scene/custom-components'
import { useStore } from '../../core/store'
import { Button } from '../../ds'
import {
  cancelRecordDestination,
  confirmRecordDestination
} from '../../actions/record-destination'

export function RecordDestinationPill(): JSX.Element | null {
  const recording = useStore(() => state.recordingDestination)
  const frozen = useStore(() => state.frozen)
  const selected = useStore(() => state.selected)

  useEffect(() => {
    if (recording === null) return
    if (!frozen || (!selected.has(recording.ghostId) && !selected.has(recording.entityId))) {
      void cancelRecordDestination()
      return
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void cancelRecordDestination()
      if (e.key === 'Enter') void confirmRecordDestination()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recording, frozen, selected])

  if (recording === null) return null
  const name = entityName(state.snapshot, recording.entityId) ?? 'the entity'
  return (
    <div className="eui-stall-notice bottom">
      <span className="ic">⤿</span>
      <div className="msg">
        <b>Drag the ghost to where {name} should stop.</b>
        <span>The real one stays put — Done saves the trip and removes the ghost.</span>
      </div>
      <Button variant="primary" size="sm" onClick={() => void confirmRecordDestination()}>
        Done
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void cancelRecordDestination()}>
        Cancel
      </Button>
    </div>
  )
}
