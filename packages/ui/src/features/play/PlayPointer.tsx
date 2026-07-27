// Play-mode pointer HUD: the centre reticle while the engine holds the mouse
// for camera-look, plus the "press E to interact" prompts for the entity under
// the cursor — ported from bevy-explorer react-web's Pointer feature so PLAY
// gives the same feedback as the real preview. On web the engine never draws a
// crosshair or hover tooltips (hud:false); the page is the HUD.
//
// Data arrives over the editor bus ('hover' / 'cursor-lock', relayed by the
// scene's play-hud module). The cursor position for the free-cursor radial
// prompts comes from the ENGINE window's own mousemove — the engine runs in a
// same-origin full-viewport iframe, so its client coords map 1:1 onto ours.
import { useEffect, useState } from 'react'
import { state } from '../../../../scene/src/state'
import { useStore } from '../../store'
import { getEngineWindow } from '../../console'
import type { HoverHint } from '../../../../scene/src/bridge-protocol'

// Default DCL key bindings (custom rebinds aren't reflected — same as react-web v1).
const IA_POINTER = 0
const KEY_LABEL: Record<number, string> = {
  1: 'E', // IA_PRIMARY
  2: 'F', // IA_SECONDARY
  4: 'W',
  5: 'S',
  6: 'D',
  7: 'A',
  8: 'Space', // IA_JUMP
  9: 'Shift', // IA_WALK
  10: '1', // IA_ACTION_3
  11: '2',
  12: '3',
  13: '4'
}

// Left-click mouse glyph (react-web's "Hover Tooltip" — left button filled orange).
function MouseLeftIcon(): JSX.Element {
  return (
    <svg className="eui-pointer-mouse" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M11.6746 11.8961V2.99524C11.6746 2.99524 4.33789 2.98667 4.33789 11.8961H11.6746Z" fill="#FF7439" />
      <rect x="4.50781" y="2.99524" width="15" height="20" rx="7.5" stroke="#ECEBED" strokeWidth="2" />
      <path d="M4.33789 11.9952H18.9999" stroke="#ECEBED" />
      <path d="M7.20715 0.590018C4.26466 1.54992 2.11196 4.23323 1.19016 6.9471" stroke="#ECEBED" strokeLinecap="round" />
    </svg>
  )
}

// Out-of-range glyphs (camera-rule vs player-rule), mirroring react-web's copy.
function CameraGlyph(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 10l5-4v12l-5-4" />
      <rect x="2" y="6" width="13" height="12" rx="2" />
    </svg>
  )
}
function WalkGlyph(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="13" cy="4" r="2" />
      <path d="M12.5 8l-2 5 2.5 3 1 5" />
      <path d="M10.5 13l-2.5 6" />
      <path d="M12.5 8l3 3 3 1" />
    </svg>
  )
}

function KeyCap({ button }: { button: number }): JSX.Element {
  if (button === IA_POINTER) return <MouseLeftIcon />
  return <span className="eui-pointer-cap">{KEY_LABEL[button] ?? '?'}</span>
}

// Radial tooltip slots around the free cursor (react-web layout): first prompt
// to the RIGHT of the pointer, then left, top-centre, lower and upper flanks.
const H = 14 // horizontal gap from the cursor
const V = 34 // vertical spacing between rows
interface Slot {
  x: number
  y: number
  side: 'r' | 'l' | 't'
}
const HOVER_SLOTS: Slot[] = [
  { x: H, y: 0, side: 'r' },
  { x: -H, y: 0, side: 'l' },
  { x: 0, y: -2 * V, side: 't' },
  { x: H, y: V, side: 'r' },
  { x: -H, y: V, side: 'l' },
  { x: H, y: -V, side: 'r' },
  { x: -H, y: -V, side: 'l' }
]
function slotStyle(s: Slot): React.CSSProperties {
  if (s.side === 't') return { position: 'absolute', left: s.x, top: s.y, transform: 'translate(-50%, -50%)' }
  if (s.side === 'l') return { position: 'absolute', left: s.x, top: s.y, transform: 'translate(-100%, -50%)' }
  return { position: 'absolute', left: s.x, top: s.y, transform: 'translateY(-50%)' }
}

const TOO_FAR: Record<'camera' | 'player', { Icon: () => JSX.Element; text: string }> = {
  camera: { Icon: CameraGlyph, text: 'Get camera closer' },
  player: { Icon: WalkGlyph, text: 'Get player closer' }
}

function Hint({ action, slot }: { action: HoverHint; slot?: Slot }): JSX.Element {
  const reverse = slot?.side === 'l'
  const tooFar = !action.enabled ? TOO_FAR[action.tooFarReason ?? 'camera'] : null
  return (
    <div
      className={`eui-pointer-hint${reverse ? ' is-reverse' : ''}${action.enabled ? '' : ' is-disabled'}`}
      style={slot !== undefined ? slotStyle(slot) : undefined}
    >
      {tooFar !== null ? (
        <span className="eui-pointer-mouse">
          <tooFar.Icon />
        </span>
      ) : (
        <KeyCap button={action.button} />
      )}
      <span className="eui-pointer-hint-text">{action.enabled ? action.text : tooFar?.text}</span>
    </div>
  )
}

// Last cursor position over the engine viewport (client px). Kept module-level
// so the radial prompts have a position the instant a hover starts, not after
// the next mousemove.
let lastCursor = { x: -100, y: -100 }

export function PlayPointer(): JSX.Element | null {
  const hover = useStore(() => state.playHover)
  const locked = useStore(() => state.playCursorLocked)
  // Fallback for setups where the browser Pointer Lock API IS engaged: the
  // engine iframe's document owns the lock, so listen there.
  const [browserLocked, setBrowserLocked] = useState(false)
  const [cursor, setCursor] = useState(lastCursor)

  const active = hover.length > 0
  const showReticle = locked || browserLocked
  const wantCursor = active && !showReticle

  useEffect(() => {
    const doc = getEngineWindow().document
    const update = (): void => setBrowserLocked(doc.pointerLockElement != null)
    update()
    doc.addEventListener('pointerlockchange', update)
    return () => doc.removeEventListener('pointerlockchange', update)
  }, [])

  useEffect(() => {
    const win = getEngineWindow()
    const move = (e: MouseEvent): void => {
      lastCursor = { x: e.clientX, y: e.clientY }
      if (wantCursor) setCursor(lastCursor)
    }
    if (wantCursor) setCursor(lastCursor)
    win.addEventListener('mousemove', move)
    return () => win.removeEventListener('mousemove', move)
  }, [wantCursor])

  if (!showReticle && !active) return null

  return (
    <div className="eui-pointer-root" aria-hidden="true">
      {showReticle && <div className={`eui-pointer-reticle${active ? ' is-active' : ''}`} />}
      {active &&
        (showReticle ? (
          // Pointer-locked: stack the prompts just below the centre reticle.
          <div className="eui-pointer-hints">
            {hover.map((a, i) => (
              <Hint key={i} action={a} />
            ))}
          </div>
        ) : (
          // Free cursor: spread the prompts radially around the pointer.
          <div className="eui-pointer-radial" style={{ left: cursor.x, top: cursor.y }}>
            {hover.slice(0, HOVER_SLOTS.length).map((a, i) => (
              <Hint key={i} action={a} slot={HOVER_SLOTS[i]} />
            ))}
          </div>
        ))}
    </div>
  )
}
