// Browser replacement for the scene's boot-trace (vite.config.ts redirects it).
// The scene's version posts each step onto the bus; bundled into the page that
// would echo the page's own re-attach steps back at it as if the scene had sent
// them. Here they go straight into the page timeline instead.
export { pageTrace as trace, pageTraced as traced } from './boot-trace'

// Nothing to replay: the page's entries are already in its own timeline.
export function replayTrace(): void {}
