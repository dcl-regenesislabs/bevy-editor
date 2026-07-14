// ADR-44 signed-fetch payload construction (Decentraland auth).
//
// The worlds/gatekeeper/storage services authenticate a request by verifying an
// auth-chain signature over `method:path:timestamp:metadata`, ALL lowercased.
// A regression in this exact string silently 401s every authenticated request
// in the app, so it lives here as a dependency-free, unit-tested function
// rather than inline in the signed-fetch call site.
export function signedFetchPayload(method: string, pathname: string, timestamp: string, metadata: string): string {
  return [method, pathname, timestamp, metadata].join(':').toLowerCase()
}
