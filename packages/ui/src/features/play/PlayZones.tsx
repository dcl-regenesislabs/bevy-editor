import { state } from '@scene/state'
import { useStore } from '../../core/store'
import { Chip } from '../../ds'

export function PlayZones(): JSX.Element | null {
  const zones = useStore(() => state.playZones)
  if (zones.length === 0) return null
  return (
    <div className="eui-play-zones">
      <Chip
        tone="primary"
        tip="Trigger zones your avatar is standing in — an editor aid; players in the published scene only see what your reactions do"
      >
        You&rsquo;re inside: {zones.join(', ')} <span className="eui-play-zones-note">editor only</span>
      </Chip>
    </div>
  )
}
