// The editor bus protocol is defined ONCE in @dcl-editor/contract (the shared
// types package, also used by the ui + desktop packages). The scene re-exports it
// so its own files keep importing from './bridge-protocol' — no duplicate to keep
// in sync. @dcl-editor/contract is pure types (no runtime, no ~system), so it
// bundles cleanly in both the sdk-commands scene build and the web build.
export * from '@dcl-editor/contract'
