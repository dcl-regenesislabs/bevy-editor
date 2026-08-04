// The scene's editor core, split by concern (structure audit 2026-08):
//   inspector/transform.ts — snapshot reads: parents, children, composed transforms
//   inspector/writes.ts    — the snapshot pull + optimistic write kernel
//   inspector/transport.ts — frozen state and play / pause / step
//   inspector/boot.ts      — login, scene resolve, first snapshot
//   inspector/entities.ts  — entity lifecycle: create, clip, delete, reparent
//   inspector/save.ts      — the composite save pipeline
// This file re-exports exactly the surface it had before the split, so the
// scene's own modules and the ui package (via @scene/inspector) are unchanged.
export { refresh, startInspector } from './boot'
export { addComponent, addEntity, allocateNamedEntities, applyStructuredEdits, captureEntityDelete, captureEntityTree, clearParentOfSelection, createEntities, deleteComponent, deleteEntity, deleteEntityRecursive, deleteEntityReparent, duplicateEntityTree, instantiateEntityTree, reparentEntitiesTo, reparentSelectionToActive, replayEntityDelete, restoreEntityDelete, setComponentValue } from './entities'
export type { DeleteMode, EntityClip, EntityRestore } from './entities'
export { isLocalScene, saveCompositeDirect, setCompositeWriter } from './save'
export type { CompositeWriter } from './save'
export { childCount, descendantCount } from './transform'
export { announceFrozen, pauseScene, playScene, setFrozen, setFrozenObserver, stepScene } from './transport'
export { applyExternalComponentDelete, applyExternalComponentWrite, applyExternalEntityDelete, fireTransform, loadComponentNames, loadInitialBaseline, mergeKeepingOrder, overlayEditorChangelog, reloadSnapshot, setMutationObservers, writeComponent } from './writes'
