import { Vector3, Quaternion } from '@dcl/sdk/math'

export function rotateVec3ByQuat(v: Vector3, q: Quaternion): Vector3 {
  // v' = v + 2*q.w*(q.xyz × v) + 2*(q.xyz × (q.xyz × v))
  const cx1 = q.y * v.z - q.z * v.y
  const cy1 = q.z * v.x - q.x * v.z
  const cz1 = q.x * v.y - q.y * v.x
  const uX = q.w * cx1 + (q.y * cz1 - q.z * cy1)
  const uY = q.w * cy1 + (q.z * cx1 - q.x * cz1)
  const uZ = q.w * cz1 + (q.x * cy1 - q.y * cx1)
  return Vector3.create(v.x + 2 * uX, v.y + 2 * uY, v.z + 2 * uZ)
}

// Convierte FOV horizontal -> vertical si es necesario
function verticalFovFrom(
  fovRad: number,
  viewportWidth: number,
  viewportHeight: number,
  isHorizontal: boolean
): number {
  if (!isHorizontal) return fovRad
  const aspect = viewportWidth / viewportHeight
  return 2 * Math.atan(Math.tan(fovRad / 2) / aspect)
}

type WorldToScreenOptions = {
  /** If true, fovRad is horizontal and is converted to vertical internally. */
  fovIsHorizontal?: boolean
  /** DCL/Unity uses +Z forward, so default false. */
  forwardIsNegZ?: boolean
  /**
   * When true, off-viewport and behind-camera points are clamped to the
   * viewport rectangle: off-viewport perspective coords are clamped, and
   * behind-camera points are projected from the camera-space xy direction
   * onto the viewport rect (a "compass" indicator). `onScreen` and `behind`
   * still report the underlying state. Default false — preserves the
   * original "junk coords for behind-camera" shape, leaving callers to
   * filter on `onScreen`.
   */
  boundOutOfScreen?: boolean
}

export function worldToScreenPx(
  world: Vector3,
  cameraPos: Vector3,
  cameraRot: Quaternion,
  fovRad: number,
  viewportWidth: number,
  viewportHeight: number,
  options: WorldToScreenOptions = {}
): { left: number; top: number; onScreen: boolean; behind: boolean } {
  const forwardIsNegZ = options.forwardIsNegZ ?? false
  const verticalFovRad = verticalFovFrom(
    fovRad,
    viewportWidth,
    viewportHeight,
    !!options.fovIsHorizontal
  )

  const rel = Vector3.create(
    world.x - cameraPos.x,
    world.y - cameraPos.y,
    world.z - cameraPos.z
  )
  const inv = Quaternion.create(
    -cameraRot.x,
    -cameraRot.y,
    -cameraRot.z,
    cameraRot.w
  )
  const cam = rotateVec3ByQuat(rel, inv)

  const aspect = viewportWidth / viewportHeight
  const tanHalf = Math.tan(verticalFovRad / 2)
  const halfW = viewportWidth * 0.5
  const halfH = viewportHeight * 0.5
  const depth = forwardIsNegZ ? -cam.z : cam.z
  const behind = depth <= 1e-4

  if (!behind) {
    const ndcX = cam.x / (depth * tanHalf * aspect)
    const ndcY = cam.y / (depth * tanHalf)
    let left = (ndcX + 1) * 0.5 * viewportWidth
    let top = (1 - (ndcY + 1) * 0.5) * viewportHeight
    const onScreen =
      left >= 0 && left <= viewportWidth && top >= 0 && top <= viewportHeight
    if (options.boundOutOfScreen && !onScreen) {
      left = Math.min(Math.max(left, 0), viewportWidth)
      top = Math.min(Math.max(top, 0), viewportHeight)
    }
    return { left, top, onScreen, behind: false }
  }

  if (!options.boundOutOfScreen) {
    return { left: -100, top: -100, onScreen: false, behind: true }
  }

  // Compass-edge fallback: project the camera-space xy direction onto the
  // viewport rect. cam.y is up, so flip y for the top-down viewport axis.
  const len2 = cam.x * cam.x + cam.y * cam.y
  if (len2 < 1e-6) {
    return { left: halfW, top: halfH, onScreen: false, behind: true }
  }
  const len = Math.sqrt(len2)
  const nx = cam.x / len
  const ny = cam.y / len
  const sx = nx !== 0 ? halfW / Math.abs(nx) : Number.POSITIVE_INFINITY
  const sy = ny !== 0 ? halfH / Math.abs(ny) : Number.POSITIVE_INFINITY
  const scale = Math.min(sx, sy)
  return {
    left: halfW + nx * scale,
    top: halfH - ny * scale,
    onScreen: false,
    behind: true
  }
}

