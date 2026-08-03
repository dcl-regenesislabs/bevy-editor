import { describe, expect, it } from 'vitest'
import { buildSceneRoster, sceneRows } from './roster'
import type { Snapshot } from '../../../scene/src/state'

const NAME = 'core-schema::Name'
const SCRIPT = 'asset-packs::Script'

// Entity 5 is the reserved WORLD_ORIGIN; world position = composed-local − origin5.
function base(): Snapshot {
  return { '5': { Transform: { position: { x: 0, y: 0, z: 0 }, parent: 0 } } }
}

function layout(params: Record<string, { type: string; value: unknown; options?: string[] }>): string {
  return JSON.stringify({ params, actions: [] })
}

describe('sceneRows', () => {
  it('lists only named, authored entities', () => {
    const snapshot: Snapshot = {
      ...base(),
      '512': { [NAME]: { value: 'Door' } },
      '513': { MeshRenderer: { mesh: { box: {} } } }, // unnamed code entity
      '2': { [NAME]: { value: 'camera' } } // reserved
    }
    expect(sceneRows(snapshot).map((r) => r.id)).toEqual(['512'])
  })

  it('reports the world transform of a parented entity, not its local one', () => {
    const snapshot: Snapshot = {
      ...base(),
      '512': {
        [NAME]: { value: 'Rig' },
        Transform: { position: { x: 10, y: 0, z: 4 }, scale: { x: 2, y: 2, z: 2 }, parent: 0 }
      },
      '513': {
        [NAME]: { value: 'Handle' },
        Transform: { position: { x: 1, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, parent: 512 }
      }
    }
    const handle = sceneRows(snapshot).find((r) => r.id === '513')
    expect(handle?.position).toEqual({ x: 12, y: 0, z: 4 })
    expect(handle?.scale).toEqual({ x: 2, y: 2, z: 2 })
  })

  it('subtracts the world origin', () => {
    const snapshot: Snapshot = {
      '5': { Transform: { position: { x: 16, y: 0, z: 32 }, parent: 0 } },
      '512': { [NAME]: { value: 'Door' }, Transform: { position: { x: 24, y: 0, z: 32 }, parent: 0 } }
    }
    expect(sceneRows(snapshot)[0].position).toEqual({ x: 8, y: 0, z: 0 })
  })

  it('falls back to the local transform when there is no world origin', () => {
    const snapshot: Snapshot = {
      '512': { [NAME]: { value: 'Door' }, Transform: { position: { x: 3, y: 1, z: 2 }, parent: 0 } }
    }
    expect(sceneRows(snapshot)[0].position).toEqual({ x: 3, y: 1, z: 2 })
  })
})

describe('buildSceneRoster', () => {
  it('names every zone on its own line', () => {
    const snapshot: Snapshot = {
      ...base(),
      '512': {
        [NAME]: { value: 'Front Hall' },
        Transform: { position: { x: 8, y: 1.5, z: 10 }, scale: { x: 4, y: 3, z: 4 }, parent: 0 },
        TriggerArea: { mesh: 0, collisionMask: 8 }
      },
      '513': {
        [NAME]: { value: 'Arena' },
        Transform: { position: { x: 0, y: 0, z: 0 }, parent: 0 },
        TriggerArea: { mesh: 1, collisionMask: 4 }
      }
    }
    const text = buildSceneRoster(snapshot)
    expect(text).toContain('Zones in this scene: "Front Hall", "Arena"')
    expect(text).toContain('"Front Hall" (id 512) — Trigger area — at 8 1.5 10 m — size 4 3 4 m')
  })

  it('says so when there are no zones', () => {
    expect(buildSceneRoster(base())).toContain('Zones in this scene: none yet.')
    expect(buildSceneRoster(base())).toContain('no authored entities yet')
  })

  it('lists a script with its current param values', () => {
    const snapshot: Snapshot = {
      ...base(),
      '512': {
        [NAME]: { value: 'Front Hall' },
        TriggerArea: { mesh: 0 },
        [SCRIPT]: {
          value: [
            {
              path: 'custom/trigger_zone/scripts/trigger-zone.ts',
              priority: 0,
              layout: layout({
                who: { type: 'enum', value: 'any player', options: ['this player', 'any player'] },
                cooldown: { type: 'number', value: 0.3 }
              })
            }
          ]
        }
      }
    }
    expect(buildSceneRoster(snapshot)).toContain(
      '    script custom/trigger_zone/scripts/trigger-zone.ts — who: "any player", cooldown: 0.3'
    )
  })

  it('derives a kind for a named entity instead of echoing its name', () => {
    const snapshot: Snapshot = {
      ...base(),
      '512': { [NAME]: { value: 'Front Door' }, GltfContainer: { src: 'models/door.glb' } }
    }
    const text = buildSceneRoster(snapshot)
    expect(text).toContain('"Front Door" (id 512) — door · model')
    expect(text).toContain('has GltfContainer')
  })

  it('keeps every zone when the entity cap trims the roster', () => {
    const snapshot: Snapshot = base()
    for (let i = 0; i < 30; i++) {
      snapshot[String(600 + i)] = { [NAME]: { value: `Prop ${i}` } }
    }
    snapshot['999'] = { [NAME]: { value: 'Front Hall' }, TriggerArea: { mesh: 0 } }
    const text = buildSceneRoster(snapshot, 5)
    expect(text).toContain('"Front Hall"')
    expect(text).toContain('…and 26 more entities not listed.')
  })
})
