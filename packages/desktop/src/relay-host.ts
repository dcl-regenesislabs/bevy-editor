// Host guard for the renderer's CORS relay. The relay exists only because the
// storage and creators-data APIs answer `access-control-allow-origin: false`
// for localhost origins; this guard is the one thing keeping it from being a
// general-purpose proxy that forwards the user's signed identity anywhere.
//
// Matching is exact hostname equality against RELAY_HOSTS. Creator Hub's
// /\.decentraland\.org$/ suffix test is deliberately not ported — it would
// relay to every host in the org — and a suffix test is also what lets
// `storage.decentraland.org.attacker.net` through. https only: an http relay
// would put the auth chain on the wire in clear.
import { RELAY_HOSTS } from '@dcl-editor/contract'

export function assertRelayHost(url: string): URL {
  const u = new URL(url)
  if (u.protocol !== 'https:' || !RELAY_HOSTS.includes(u.hostname)) throw new Error('host not allowed')
  return u
}
