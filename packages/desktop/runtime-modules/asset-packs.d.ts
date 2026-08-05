// `@dcl/asset-packs` exists in a SCENE (the templates depend on
// vendor/asset-packs-stub, and sdk-commands rewrites its own runtime's import to
// the same specifier) but not in this repo, where the runtime-module masters are
// typechecked. spawner.ts must reach getActionEvents to reproduce the SDK script
// runner's ActionCallback exactly, so the one API it uses is declared here.
//
// Mirrors vendor/asset-packs-stub/dist/index.d.ts. Entity is a branded number, so
// passing one where a number is expected is fine in both directions.
declare module '@dcl/asset-packs' {
  export interface Emitter {
    on(type: string | symbol, handler: (event?: unknown) => void): void
    off(type: string | symbol, handler?: (event?: unknown) => void): void
    emit(type: string | symbol, event?: unknown): void
  }
  export function getActionEvents(entity: number): Emitter
  export function getTriggerEvents(entity: number): Emitter
}
