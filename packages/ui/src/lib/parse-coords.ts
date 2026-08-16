// Strict "x,y" parcel parsing for scene base coordinates.
//
// Deliberately unforgiving: no spaces, no decimals, no third component. An
// unreadable base must drop the scene, never become a coordinate — the
// `?? '0,0'` fallback at gatekeeper.ts:18 must never be copied here, because
// 0,0 is a real parcel someone else owns and a signed request built from it
// would ask for another creator's numbers.

const COORDS = /^(-?\d+),(-?\d+)$/

export function parseCoords(s: string | null): { x: number; y: number } | null {
  if (s === null) return null
  const m = COORDS.exec(s)
  if (m === null) return null
  return { x: Number(m[1]), y: Number(m[2]) }
}

// One spelling per parcel. "9, 9" and "9,9" are the same parcel to the worlds
// server, so comparing the raw strings would manufacture a difference out of
// whitespace — which is the ONLY thing forgiven here. Null keeps the strict
// contract above: an unreadable parcel never becomes a coordinate.
export function canonCoords(s: string): string | null {
  const at = parseCoords(s.replace(/\s+/g, ''))
  return at === null ? null : `${at.x},${at.y}`
}
