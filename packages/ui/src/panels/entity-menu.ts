// The right-click menu's copy. Kept out of the component so the reasons behind
// each string can be written down next to it.
//
// Editing a code-spawned entity's VALUES is allowed — the inspector raises a card
// offering to push the change into the code. What stays disabled is the structural
// work that would write broken authored data: a child orphaned when its code-made
// parent doesn't come back, a duplicate that coexists with the recreated original,
// a prefab that captures nothing, and a delete the next run undoes.
export const TIP_CHILD =
  "The parent is made by your code and won't exist on the next run — the child would be orphaned."
export const TIP_DUP = 'Your code recreates the original on every run, so the copy would end up alongside it.'
export const TIP_PREFAB = 'Prefabs only capture entities from your scene — these are made by your code.'

// Capturing an instance would mint a second, unrelated folder with the same
// contents: nesting is not supported, so the copy loses its link to the prefab
// it came from. Editing the prefab itself is what the creator means.
export const TIP_IS_INSTANCE =
  'This is already a copy of a prefab. Edit that prefab from the Prefabs tab, or use Save over prefab to push your changes into it.'
export const TIP_DELETE = 'Your code rebuilds it on every run, so deleting it here would not stick.'

// Both create gestures carry their consequence as a second line rather than a
// noun: "prefab" and "spawnable prefab" are the words a creator is here to learn,
// so the menu says what each one does before they have them. Neither label
// carries the selection count — a menu whose items change shape stops being
// learnable, and the dialog states the count anyway.
// Named after the folders it moves between, because that is the whole feature:
// where the entity sits in the tree IS whether the built game gets it.
export const SUB_SPAWNED_ONLY = 'Move it to “When spawned” — the game brings it in while it plays'
// Only a prefab can be spawned, so an entity that is not one becomes one here.
export const SUB_SPAWNED_NEW = 'Make it a prefab your game spawns, and move it to “When spawned”'
export const SUB_FROM_START = 'Move it to “From the start” — in the scene from the moment the game begins'
export const TIP_SPAWNED_ONLY = 'Your code rebuilds this on every run, so moving it here would not stick.'

export const SUB_PREFAB = 'Reuse it anywhere — place copies yourself, or let your game spawn them'
