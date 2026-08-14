// Environment/endpoint map for the Worlds domain — the same production services
// the decentraland.org creator tools use:
//   - worlds-content-server (deployments, permissions, contributor list)
//   - the marketplace subgraph (which DCL NAMEs the wallet owns)
//   - places API (world thumbnails / live user counts)
//   - creators-data (the once-a-day analytics export behind the Analytics tab)

// same env switch as the account feature's auth.ts ('dcl-auth-env' = 'zone' → Sepolia stack)
function zone(): boolean {
  return localStorage.getItem('dcl-auth-env') === 'zone'
}
export function worldsServer(): string {
  return zone() ? 'https://worlds-content-server.decentraland.zone' : 'https://worlds-content-server.decentraland.org'
}
export function placesApi(): string {
  return zone() ? 'https://places.decentraland.zone/api' : 'https://places.decentraland.org/api'
}
export function marketplaceSubgraph(): string {
  return zone() ? 'https://subgraph.decentraland.org/marketplace-sepolia' : 'https://subgraph.decentraland.org/marketplace'
}
export function gatekeeperUrl(): string {
  return zone() ? 'https://comms-gatekeeper.decentraland.zone' : 'https://comms-gatekeeper.decentraland.org'
}
export function storageUrl(): string {
  return zone() ? 'https://storage.decentraland.zone' : 'https://storage.decentraland.org'
}
export function multiplayerServer(): string {
  return zone() ? 'https://multiplayer-server.decentraland.zone' : 'https://multiplayer-server.decentraland.org'
}
// Production in both stacks: there is no .zone analytics deployment (the
// creator tools' dev config is byte-identical to their prod one), and a wrong
// host would fail in the one environment we test in.
// The version segment is part of the BASE. Build the request URL by
// concatenation — `new URL('/metrics', metricsApi())` drops /v2, so ADR-44 signs
// a pathname the server never receives and every request 401s with no clue why.
export function metricsApi(): string {
  return 'https://creators-data.decentraland.org/v2'
}
export function chainId(): number {
  return zone() ? 11155111 : 1
}
// jump into a world with the hosted bevy-web client (always production)
export function jumpInUrl(name: string): string {
  return `https://decentraland.org/bevy-web/?realm=${encodeURIComponent(name.toLowerCase())}`
}
