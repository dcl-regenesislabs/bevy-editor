import { useEffect, useState } from 'react'
import { state } from '@scene/state'
import { Chip } from '../../ds'
import { useStore } from '../../core/store'
import { prefabStore, revealPrefab } from '../../panels/prefab-store'
import { uiFocusEntity, uiSelectEntity } from '../../actions/selection'
import { uiPlay } from '../../actions/playback'
import { PrefabDriftDialog } from '../../panels/PrefabDriftDialog'
import css from './scene-checks.css?inline'
import { registerCss } from '../../ds/styles/registry'
import { useSceneHealth } from './scene-health'
import { invalidateSceneCheckCache, scheduleSceneChecks } from './scene-check-context'
import {
  allowBlockedPlay,
  findingIdentity,
  findingsSummary,
  useSceneChecksFlash,
  useSceneFindings,
  type SceneCheckLevel,
  type SceneFinding
} from './scene-checks'

registerCss('features/editor/scene-checks', 'features', css)

const IDLE_REFRESH_MS = 15_000

const LEVEL_LABEL: Record<SceneCheckLevel, string> = {
  blocker: 'Blocks Play',
  'play-blocker': 'Blocks Play',
  warning: 'Warning'
}

// Delegates to the store's own identity so "dismiss until this changes" means
// exactly what the store means by "changed" — dismissing a finding and then
// editing the number it names must bring the card back. The positional suffix
// stays: two findings that agree on everything must stay separately dismissable.
function findingKey(finding: SceneFinding, index: number): string {
  return `${findingIdentity(finding)}|${index}`
}

// What "dismiss until this changes" compares. It has to be the same identity the
// list renders by: two findings of one rule on two entities share an id and can
// share a detail, and folding them together dismissed both at once.
function signatureOf(findings: SceneFinding[]): string {
  return findings.map((finding, index) => findingKey(finding, index)).join('&')
}

export function SceneChecksCard(): JSX.Element | null {
  const findings = useSceneFindings()
  const flash = useSceneChecksFlash()
  const frozen = useStore(() => state.frozen)
  const saveStatus = useStore(() => state.saveStatus)
  const items = useStore(() => prefabStore.items)
  const health = useSceneHealth()
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState('')
  const [drift, setDrift] = useState<{ folder: string; name: string; rootId: string } | null>(null)

  useEffect(() => {
    scheduleSceneChecks()
  }, [frozen, saveStatus])

  useEffect(() => {
    const timer = setInterval(scheduleSceneChecks, IDLE_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (flash === 0) return
    setDismissed('')
    setOpen(true)
  }, [flash])

  const signature = signatureOf(findings)
  if (findings.length === 0 || signature === dismissed) return null

  const summary = findingsSummary(findings)
  const nameFor = (folder: string): string => items.find((item) => item.folder === folder)?.data.name ?? folder

  const runFix = (finding: SceneFinding): void => {
    const action = finding.fix?.action
    if (action === 'reveal-prefab' && finding.folder !== undefined) revealPrefab(finding.folder)
    if (action === 'select-entity' && finding.entityId !== undefined) {
      uiSelectEntity(finding.entityId, false, false)
      uiFocusEntity(finding.entityId)
    }
    if (action === 'open-drift' && finding.folder !== undefined && finding.entityId !== undefined) {
      setDrift({ folder: finding.folder, name: nameFor(finding.folder), rootId: finding.entityId })
    }
  }

  return (
    <>
      <div className={`eui-checks${summary.blocking > 0 ? ' blocking' : ''}${health === null ? '' : ' stacked'}`}>
        <div className="eui-checks-head">
          <button className="bar" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span className="ic" aria-hidden="true">
              {summary.blocking > 0 ? '✖' : '⚠'}
            </span>
            <b>{summary.text}</b>
            <span className="caret" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
          </button>
          {summary.blocking > 0 && (
            <button
              className="eui-link"
              data-tip="Run the scene without fixing this"
              onClick={() => {
                allowBlockedPlay()
                void uiPlay()
              }}
            >
              Play anyway
            </button>
          )}
          <button
            className="eui-stall-x"
            aria-label="Dismiss"
            data-tip="Dismiss until this changes"
            onClick={() => setDismissed(signature)}
          >
            ✕
          </button>
        </div>
        {open && (
          <ul className="eui-checks-list">
            {findings.map((finding, index) => (
              <li key={findingKey(finding, index)} className={finding.level}>
                <div className="top">
                  <Chip size="xs" tone={finding.level === 'warning' ? 'default' : 'danger'}>
                    {LEVEL_LABEL[finding.level]}
                  </Chip>
                  <b>{finding.title}</b>
                </div>
                <p>{finding.detail}</p>
                {finding.fix !== undefined && (
                  <div className="act">
                    <button className="eui-link" onClick={() => runFix(finding)}>
                      {finding.fix.label}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {drift !== null && (
        <PrefabDriftDialog
          folder={drift.folder}
          name={drift.name}
          rootId={drift.rootId}
          onClose={() => {
            setDrift(null)
            invalidateSceneCheckCache()
            scheduleSceneChecks()
          }}
        />
      )}
    </>
  )
}
