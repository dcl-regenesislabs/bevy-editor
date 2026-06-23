// Same-origin BroadcastChannel transport between the editor host page (the React
// UI) and the editor scene (the super-user sandbox). Replaces the /editor_send +
// /editor_poll console-command bus, which only existed in our patched engine.
//
// BroadcastChannel is exposed to the super-user scene by upstream (bevy-explorer
// #843) and spans the window / iframe / scene-worker boundary same-origin, so this
// works on STOCK main with no engine changes. Each message is wrapped with its
// destination so a peer ignores its own posts: `to: 'scene'` is page→scene,
// `to: 'page'` is scene→page.
export const EDITOR_BUS_CHANNEL = 'dcl-editor-bus'

export type BusEnvelope<M> = { to: 'page' | 'scene'; msg: M }
