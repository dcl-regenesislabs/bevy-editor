// Environment/endpoint map for the Worlds domain — the same production services
// the decentraland.org creator tools use:
//   - worlds-content-server (deployments, permissions, contributor list)
//   - the marketplace subgraph (which DCL NAMEs the wallet owns)
//   - places API (world thumbnails / live user counts)

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
export function chainId(): number {
  return zone() ? 11155111 : 1
}
// jump into a world with the hosted bevy-web client (always production)
export function jumpInUrl(name: string): string {
  return `https://decentraland.org/bevy-web/?realm=${encodeURIComponent(name.toLowerCase())}`
}
