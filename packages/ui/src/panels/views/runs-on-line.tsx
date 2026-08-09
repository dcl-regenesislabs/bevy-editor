import { useEffect } from 'react'
import { useStore } from '../../core/store'
import { Chip } from '../../ds/Chip'
import { consumerStore, ensureConsumersLoaded } from '../../prefabs/consumers'
import { runsOn, RUNS_ON_EVERYWHERE, RUNS_ON_EVERYWHERE_TIP } from '../../script/runs-on'

export function RunsOnLine(props: { path: string }): JSX.Element | null {
  const scripts = useStore(() => consumerStore.scripts)
  useEffect(() => ensureConsumersLoaded(), [])
  const text = scripts[props.path]
  if (text === undefined) return null
  const { unbranched, labels } = runsOn(text)
  if (!unbranched) return null
  return (
    <div className="eui-script-runs-on">
      <span className="row">
        <Chip tone="server" size="xs" tip={RUNS_ON_EVERYWHERE_TIP}>
          {RUNS_ON_EVERYWHERE}
        </Chip>
        {labels.length > 0 && <span className="names">{labels.join(' · ')}</span>}
      </span>
    </div>
  )
}
