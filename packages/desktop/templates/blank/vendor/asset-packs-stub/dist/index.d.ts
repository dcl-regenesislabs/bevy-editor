export interface Emitter {
  all: Map<string | symbol, Array<(...args: unknown[]) => void>>
  on(type: string | symbol, handler: (event?: unknown) => void): void
  off(type: string | symbol, handler?: (event?: unknown) => void): void
  emit(type: string | symbol, event?: unknown): void
}
export declare function getActionEvents(entity: number): Emitter
export declare function getTriggerEvents(entity: number): Emitter
