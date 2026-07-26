// Where the editor was launched at: the scene's realm/system-scene URLs, its base
// parcel and its authored spawn point.
//
// These arrive over IPC (ServersReady) and are handed to <Editor params=…>, which
// forwards them to the engine iframe. The HOST page's own URL only ever carries
// ?project, so reading window.location.search here finds nothing on desktop —
// that is why the params are registered explicitly at boot. The fallback keeps
// the no-Electron direct-attach route (where they ARE in the page URL) working.
let launchParams: URLSearchParams | null = null

export function setLaunchParams(params: URLSearchParams): void {
  launchParams = params
}

export function launchParam(name: string): string | null {
  return (launchParams ?? new URLSearchParams(window.location.search)).get(name)
}

const PARCEL_SIZE = 16

function baseParcel(): { x: number; y: number } {
  const [px, py] = (launchParam('position') ?? '0,0').split(',').map(Number)
  return { x: px || 0, y: py || 0 }
}

// The corner of the base parcel: the origin scene-local coordinates are measured
// from, so adding it converts scene-local to DCL world space.
export function baseParcelCorner(): { x: number; z: number } {
  const p = baseParcel()
  return { x: p.x * PARCEL_SIZE, z: p.y * PARCEL_SIZE }
}

// The centre of the base parcel, at ground level, in DCL world space.
export function baseParcelCentre(): { x: number; y: number; z: number } {
  const c = baseParcelCorner()
  return { x: c.x + PARCEL_SIZE / 2, y: 0, z: c.z + PARCEL_SIZE / 2 }
}
