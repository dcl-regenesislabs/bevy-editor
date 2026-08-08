import { useEffect } from 'react'
import { useStore } from '../../core/store'
import { consumerStore, ensureConsumersLoaded } from '../../prefabs/consumers'
import {
  runsOn,
  RUNS_ON_BLUE,
  RUNS_ON_BLUE_TIP,
  RUNS_ON_GREEN,
  RUNS_ON_GREEN_TIP
} from '../../script/runs-on'

// Where this script's code runs, read off the file itself (runs-on.ts) in the
// behavior card auto-expand.ts already opens on first selection. It answers
// "will my friend see this?" without opening the file.
//
// Absent for a script that doesn't use the game: most scripts are one player's
// screen and always were, so a line saying so on every card would be noise.
export function RunsOnLine(props: { path: string }): JSX.Element | null {
  const scripts = useStore(() => consumerStore.scripts)
  useEffect(() => ensureConsumersLoaded(), [])
  const text = scripts[props.path]
  if (text === undefined) return null
  const { green, blue } = runsOn(text)
  if (green.length === 0 && blue.length === 0) return null
  return (
    <div className="eui-script-runs-on">
      {green.length > 0 && (
        <span className="green" data-tip={RUNS_ON_GREEN_TIP}>
          ● {RUNS_ON_GREEN}: {green.join(' · ')}
        </span>
      )}
      {blue.length > 0 && (
        <span className="blue" data-tip={RUNS_ON_BLUE_TIP}>
          ● {RUNS_ON_BLUE}: {blue.join(' · ')}
        </span>
      )}
    </div>
  )
}
