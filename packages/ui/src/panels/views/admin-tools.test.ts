import { describe, expect, it } from 'vitest'
import {
  ACTIONS_COMPONENT,
  VIDEO_PLAYER_COMPONENT,
  actionNames,
  adminToolsJson,
  entitiesWithComponent,
  normalizeAdminTools,
  suggestedName,
  type EntityBag
} from './admin-tools'

describe('normalizeAdminTools', () => {
  it('fills the shipped defaults for an empty value', () => {
    const value = normalizeAdminTools(undefined)
    expect(value.adminPermissions).toBe('PUBLIC')
    expect(value.authorizedAdminUsers).toEqual({
      me: true,
      sceneOwners: true,
      allowList: true,
      adminAllowList: []
    })
    expect(value.moderationControl.kickCoordinates).toEqual({ x: 0, y: 0, z: 0 })
    expect(value.rewardsControl.isEnabled).toBe(false)
  })

  it('keeps authored values and drops junk', () => {
    const value = normalizeAdminTools({
      adminPermissions: 'PRIVATE',
      authorizedAdminUsers: { me: false, adminAllowList: ['0xa', 7, null] },
      videoControl: { isEnabled: false, videoPlayers: [{ entity: 513, customName: 'Stage' }, 4] },
      smartItemsControl: { smartItems: [{ entity: 514 }] }
    })
    expect(value.adminPermissions).toBe('PRIVATE')
    expect(value.authorizedAdminUsers.me).toBe(false)
    expect(value.authorizedAdminUsers.adminAllowList).toEqual(['0xa'])
    expect(value.videoControl.isEnabled).toBe(false)
    expect(value.videoControl.videoPlayers).toEqual([{ entity: 513, customName: 'Stage' }])
    expect(value.smartItemsControl.smartItems).toEqual([
      { entity: 514, customName: '', defaultAction: '' }
    ])
  })

  it('falls back to PUBLIC for an unknown permission', () => {
    expect(normalizeAdminTools({ adminPermissions: 'NOPE' }).adminPermissions).toBe('PUBLIC')
  })
})

describe('adminToolsJson', () => {
  it('emits the registry field order', () => {
    const json = adminToolsJson(normalizeAdminTools(undefined))
    expect(Object.keys(JSON.parse(json) as Record<string, unknown>)).toEqual([
      'adminPermissions',
      'authorizedAdminUsers',
      'moderationControl',
      'textAnnouncementControl',
      'videoControl',
      'smartItemsControl',
      'rewardsControl'
    ])
  })

  it('round-trips through normalize', () => {
    const value = normalizeAdminTools({ moderationControl: { isEnabled: false } })
    expect(normalizeAdminTools(JSON.parse(adminToolsJson(value)))).toEqual(value)
  })
})

describe('entitiesWithComponent', () => {
  const snapshot: EntityBag = {
    '0': {},
    '512': { [VIDEO_PLAYER_COMPONENT]: {}, Transform: {} },
    '514': { [VIDEO_PLAYER_COMPONENT]: {} },
    '513': { Transform: {} }
  }

  it('lists only entities carrying the component, sorted, minus the host', () => {
    const options = entitiesWithComponent(snapshot, VIDEO_PLAYER_COMPONENT, () => undefined)
    expect(options.map((o) => o.id)).toEqual([512, 514])
  })

  it('excludes the admin entity itself', () => {
    const options = entitiesWithComponent(snapshot, VIDEO_PLAYER_COMPONENT, () => undefined, '512')
    expect(options.map((o) => o.id)).toEqual([514])
  })

  it('labels with the entity name when there is one', () => {
    const options = entitiesWithComponent(snapshot, VIDEO_PLAYER_COMPONENT, (id) =>
      id === '512' ? 'Big Screen' : undefined
    )
    expect(options[0].label).toBe('#512 Big Screen')
    expect(options[1].label).toBe('#514')
  })
})

describe('actionNames', () => {
  it('reads the names off asset-packs::Actions', () => {
    expect(
      actionNames({
        [ACTIONS_COMPONENT]: { id: 1, value: [{ name: 'Open' }, { name: '' }, { name: 'Close' }] }
      })
    ).toEqual(['Open', 'Close'])
  })

  it('returns nothing for an entity without actions', () => {
    expect(actionNames(undefined)).toEqual([])
    expect(actionNames({ Transform: {} })).toEqual([])
  })
})

describe('suggestedName', () => {
  it('uses the entity name when the option has one', () => {
    expect(suggestedName({ id: 512, label: '#512 Big Screen' }, 0, 'Screen')).toBe('Big Screen')
  })

  it('falls back to an indexed label', () => {
    expect(suggestedName({ id: 512, label: '#512' }, 1, 'Screen')).toBe('Screen 2')
    expect(suggestedName(undefined, 0, 'Screen')).toBe('Screen 1')
  })
})
