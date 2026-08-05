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
export const TIP_DELETE = 'Your code rebuilds it on every run, so deleting it here would not stick.'

// Both create gestures carry their consequence as a second line rather than a
// noun: "prefab" and "spawnable prefab" are the words a creator is here to learn,
// so the menu says what each one does before they have them. Neither label
// carries the selection count — a menu whose items change shape stops being
// learnable, and the dialog states the count anyway.
export const SUB_PREFAB = 'Reuse it — drop copies in wherever you want'
export const SUB_SPAWNABLE = 'Your game makes copies of it while it runs'
