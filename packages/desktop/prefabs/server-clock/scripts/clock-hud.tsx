import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { type Entity } from '@dcl/sdk/ecs'

let label = ''
let time = ''
let mounted = false

export function setClockHudText(nextLabel: string, nextTime: string): void {
  label = nextLabel
  time = nextTime
}

export type ClockHudPosition = 'top' | 'top left' | 'top right' | 'bottom'

function justifyFor(where: ClockHudPosition): 'flex-start' | 'flex-end' | 'center' {
  switch (where) {
    case 'top left':
      return 'flex-start'
    case 'top right':
      return 'flex-end'
    default:
      return 'center'
  }
}

export function mountClockHud(entity: Entity, where: ClockHudPosition = 'top'): void {
  if (mounted) return
  mounted = true
  const vertical = where === 'bottom' ? { bottom: 24, left: 0 } : { top: 24, left: 0 }
  const justify = justifyFor(where)
  ReactEcsRenderer.addUiRenderer(entity, () => (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: vertical,
        width: '100%',
        padding: { left: 24, right: 24 },
        justifyContent: justify,
        alignItems: 'flex-start'
      }}
    >
      <UiEntity
        uiTransform={{
          padding: { top: 6, bottom: 8, left: 18, right: 18 },
          flexDirection: 'column',
          alignItems: 'center'
        }}
        uiBackground={{ color: { r: 0.06, g: 0.09, b: 0.08, a: 0.6 } }}
      >
        {label !== '' ? <Label value={label} fontSize={12} color={{ r: 1, g: 1, b: 1, a: 0.75 }} /> : null}
        <Label value={time === '' ? '--:--:--' : time} fontSize={26} color={{ r: 1, g: 1, b: 1, a: 1 }} />
      </UiEntity>
    </UiEntity>
  ))
}
