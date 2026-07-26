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

// The centre of the base parcel, at ground level, in DCL world space.
export function baseParcelCentre(): { x: number; y: number; z: number } {
  const [px, py] = (launchParam('position') ?? '0,0').split(',').map(Number)
  return { x: (px || 0) * 16 + 8, y: 0, z: (py || 0) * 16 + 8 }
}
