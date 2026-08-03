import { state } from '../../../../scene/src/state'
import { useStore } from '../../store'
import { Chip } from '../../ds'

export function PlayZones(): JSX.Element | null {
  const zones = useStore(() => state.playZones)
  if (zones.length === 0) return null
  return (
    <div className="eui-play-zones">
      <Chip tone="primary" tip="Trigger zones your avatar is standing in">
        You&rsquo;re inside: {zones.join(', ')}
      </Chip>
    </div>
  )
}
