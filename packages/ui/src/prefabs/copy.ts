// The sentences that appear on more than one surface. One copy, one wording:
// the gesture a creator is told about in the inspector must be the gesture the
// scene checks name and the gesture the empty states name.
export const CREATE_SPAWNABLE_GESTURE =
  'right-click it in the Scene tab and pick “Create spawnable prefab”'

export const NO_SPAWNABLES_YET =
  `No prefabs yet — build the thing in the scene, then ${CREATE_SPAWNABLE_GESTURE}. Picking it here is what makes the game spawn it.`

export const NO_PREFABS_YET =
  'No prefabs yet — select what you built in the scene, right-click it, and pick “Create prefab”.'

export const SPAWNABLE_ON_LINE =
  'Your game can make copies of this while it runs — set how many can be alive at once.'

export const SPAWNABLE_OFF_LINE =
  'Off — the only copies in your game are the ones you place by hand.'

export const SPAWNABLE_TOGGLE_TIP =
  'Turn this on and your scripts can make copies of this prefab while the game runs.'

export const INSTANCING_LINE: Record<'onDemand' | 'perPlayer', string> = {
  onDemand:
    'On demand: copies appear when the game asks for them — waves, drops, level changes. Your prefabs and scripts decide when.',
  perPlayer:
    'One per player: the game makes one copy for each player, when they join, and removes it when they leave. For things every player carries, like a health bar.'
}

export const maxLine = (instancing: 'onDemand' | 'perPlayer', max: number, name: string): string =>
  instancing === 'perPlayer'
    ? `Room for ${max} players at once — each one gets a copy of ${name}.`
    : `Up to ${max} copies of ${name} can be alive at the same time. Your game never makes more than that.`

export const OPEN_SHEET_LABEL = 'Placement & spawning…'
