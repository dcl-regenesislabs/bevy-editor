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
