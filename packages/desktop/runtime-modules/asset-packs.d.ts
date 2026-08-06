// `@dcl/asset-packs` exists in a SCENE (the templates depend on
// vendor/asset-packs-stub, and sdk-commands rewrites its own runtime's import to
// the same specifier) but not in this repo, where the runtime-module masters are
// typechecked. spawner.ts must reach getActionEvents to reproduce the SDK script
// runner's ActionCallback exactly, so the one API it uses is declared here.
//
// Mirrors the REAL @dcl/asset-packs signatures (branded Entity, not number):
// a scene typechecks the vendored copies against the real package, so a looser
// declaration here would let the masters compile while every scene fails.
declare module '@dcl/asset-packs' {
  import type { Entity } from '@dcl/sdk/ecs'
  export interface Emitter {
    on(type: string | symbol, handler: (event?: unknown) => void): void
    off(type: string | symbol, handler?: (event?: unknown) => void): void
    emit(type: string | symbol, event?: unknown): void
  }
  export function getActionEvents(entity: Entity): Emitter
  export function getTriggerEvents(entity: Entity): Emitter
}
