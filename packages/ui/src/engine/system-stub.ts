// Browser stub for the scene-runtime `~system/*` modules (EngineApi, UserIdentity,
// CommunicationsController, Runtime, …). They exist only inside the engine's scene
// sandbox; the SDK + scene code import them, but the code paths that CALL them
// never run page-side — the UI talks to the engine over console commands, not
// `~system`. The Vite `scene-shims` plugin resolves every `~system/*` import to
// this module.
//
// Each name is the union of the SDK's named imports from `~system` (so esbuild's
// dev dep-scan and Rollup's build both find a static export — a `default {}` or a
// Proxy would fail named imports). Everything is a harmless no-op; namespace and
// default imports get the same.
const noop = (..._args: unknown[]): undefined => undefined

export const crdtGetState = noop
export const crdtSendToRenderer = noop
export const sendBatch = noop
export const sendAsync = noop
export const sendBinary = noop
export const subscribe = noop
export const getUserData = noop
export const getCameraFov = noop
export const GetUserDataRequest = noop
export const GetUserDataResponse = noop
export const SendBatchResponse = noop
export const SendBinaryRequest = noop
export const SendBinaryResponse = noop
export const ManyEntityAction = noop

export default {}
