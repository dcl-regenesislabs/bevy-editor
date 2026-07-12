// Account presence + sign-in UI, built on the shared auth store (auth.ts) so the
// top-right avatar, the Home rail chip, and the Home Account section all reflect
// one state. All DS-reuse: Button, Spinner, .eui-ctx/.eui-menu-item, useOutsideClose.
import { useRef, useState } from 'react'
import { Button, Spinner, useOutsideClose } from './ds'
import { useAuth, type AuthState, type SignInErrorReason } from './auth'

export const shortWallet = (w: string): string => `${w.slice(0, 6)}…${w.slice(-4)}`

const PersonIcon = (): JSX.Element => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="5" r="2.6" stroke="currentColor" strokeWidth="1.4" />
    <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

function errorHeadline(reason: SignInErrorReason | null): string {
  switch (reason) {
    case 'expired':
      return 'The sign-in expired — no worries, it happens.'
    case 'not_found':
      return "We couldn't find that sign-in. Let's start a fresh one."
    case 'network':
      return 'That approval was for a different network.'
    default:
      return 'Something went wrong signing you in.'
  }
}

function Avatar(props: { face: string | null; size: number }): JSX.Element {
  const style = { width: props.size, height: props.size }
  return props.face !== null ? (
    <img className="eui-avatar" src={props.face} crossOrigin="anonymous" alt="" style={style} />
  ) : (
    <span className="eui-avatar fallback" style={style}>
      ◆
    </span>
  )
}

function AccountMenu(props: { auth: AuthState; onAccount?: () => void; onClose: () => void }): JSX.Element {
  const { auth } = props
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    if (auth.wallet === null) return
    void navigator.clipboard?.writeText(auth.wallet).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }
  return (
    <div className="eui-ctx eui-account-menu" onClick={(e) => e.stopPropagation()}>
      <div className="eui-account-menu-id">
        <Avatar face={auth.profile?.face256 ?? null} size={36} />
        <div className="meta">
          <span className="nm">{auth.profile?.name !== undefined && auth.profile.name !== '' ? auth.profile.name : 'Decentraland account'}</span>
          <span className="wa">{auth.wallet !== null ? shortWallet(auth.wallet) : ''}</span>
        </div>
      </div>
      <div className="eui-menu-sep" />
      <button className="eui-menu-item" onClick={copy}>{copied ? 'Copied ✓' : 'Copy wallet address'}</button>
      {props.onAccount !== undefined && (
        <button
          className="eui-menu-item"
          onClick={() => {
            props.onClose()
            props.onAccount?.()
          }}
        >
          Account
        </button>
      )}
      <div className="eui-menu-sep" />
      <button
        className="eui-menu-item danger"
        onClick={() => {
          props.onClose()
          auth.signOut()
        }}
      >
        Sign out
      </button>
    </div>
  )
}

// The persistent badge — top-right topbar (avatar/menu when signed in, a compact
// sign-in popover when out) or the Home rail (a wider chip).
export function AccountBadge(props: { variant?: 'topbar' | 'rail'; onAccount?: () => void }): JSX.Element {
  const auth = useAuth()
  const variant = props.variant ?? 'topbar'
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutsideClose(open, ref, () => setOpen(false))

  if (auth.wallet !== null) {
    const menu = open && <AccountMenu auth={auth} onAccount={props.onAccount} onClose={() => setOpen(false)} />
    if (variant === 'rail') {
      return (
        <div className="eui-rail-account" ref={ref}>
          <button className={`eui-rail-account-btn ${open ? 'on' : ''}`} onClick={() => setOpen((v) => !v)}>
            <Avatar face={auth.profile?.face256 ?? null} size={26} />
            <div className="meta">
              <span className="nm">{auth.profile?.name !== undefined && auth.profile.name !== '' ? auth.profile.name : 'Account'}</span>
              <span className="wa">{shortWallet(auth.wallet)}</span>
            </div>
          </button>
          {menu}
        </div>
      )
    }
    return (
      <div className="eui-topbar-menu-wrap" ref={ref}>
        <button
          className={`eui-topbar-avatar ${open ? 'on' : ''}`}
          data-tip={auth.profile?.name !== undefined && auth.profile.name !== '' ? auth.profile.name : shortWallet(auth.wallet)}
          onClick={() => setOpen((v) => !v)}
        >
          <Avatar face={auth.profile?.face256 ?? null} size={28} />
        </button>
        {menu}
      </div>
    )
  }

  // signed out
  if (variant === 'rail') {
    return (
      <button className="eui-rail-signin" onClick={props.onAccount}>
        <PersonIcon /> Sign in
      </button>
    )
  }
  // topbar: a sign-in pill that opens a compact flow popover (the scene has no
  // Account section visible, so the flow states live in the popover).
  const active = auth.signingIn || auth.phase === 'error'
  return (
    <div className="eui-topbar-menu-wrap" ref={ref}>
      <button
        className={`eui-topbar-signin ${open || active ? 'on' : ''}`}
        data-tip="Sign in with Decentraland"
        onClick={() => {
          setOpen(true)
          if (!auth.signingIn && auth.phase !== 'error') auth.signIn()
        }}
      >
        {auth.signingIn ? <Spinner size={13} /> : <PersonIcon />}
        <span>Sign in</span>
      </button>
      {(open || active) && (
        <div className="eui-ctx eui-account-pop" onClick={(e) => e.stopPropagation()}>
          <SignInFlow compact />
        </div>
      )}
    </div>
  )
}

// The sign-in state machine as UI. `compact` is the topbar popover density; the
// full version is the Home Account section.
export function SignInFlow(props: { compact?: boolean }): JSX.Element {
  const auth = useAuth()
  const compact = props.compact === true

  if (auth.phase === 'error') {
    return (
      <div className={`eui-signin ${compact ? 'compact' : ''}`}>
        <div className="eui-account-empty-icon err">!</div>
        <p className="t">{errorHeadline(auth.errorReason)}</p>
        {auth.error !== null && <p className="detail">{auth.error}</p>}
        <div className="eui-signin-row">
          <Button variant="primary" size="sm" onClick={auth.signIn}>Try again</Button>
          <button className="eui-link" onClick={auth.dismissError}>Not now</button>
        </div>
      </div>
    )
  }
  if (auth.signingIn) {
    return (
      <div className={`eui-signin ${compact ? 'compact' : ''}`}>
        {auth.phase === 'opening' ? (
          <>
            <Spinner size={compact ? 20 : 26} />
            <p className="t">Opening decentraland.org…</p>
          </>
        ) : (
          <>
            <div className="eui-signin-handoff">
              <span className="a">◆</span>
              <span className="dots" />
              <span className="b">🌐</span>
            </div>
            <p className="t">Waiting for your browser</p>
            <p className="s">Approve the sign-in on decentraland.org, then come back — we'll sign you in automatically.</p>
            <div className="eui-signin-row">
              <Button variant="ghost" size="sm" onClick={auth.reopen}>Reopen browser</Button>
              <button className="eui-link" onClick={auth.cancel}>Cancel</button>
            </div>
            {!compact && <p className="foot">This request stays valid for 15 minutes.</p>}
          </>
        )}
      </div>
    )
  }
  // idle / signed-out
  return (
    <div className={`eui-signin ${compact ? 'compact' : ''}`}>
      <div className="eui-account-empty-icon">◆</div>
      <p className="t">Sign in with Decentraland</p>
      {!compact && <p className="s">We'll open decentraland.org in your browser to approve — no password ever touches this app.</p>}
      <Button variant="primary" size="md" onClick={auth.signIn}>Sign in with Decentraland</Button>
      {!compact && <p className="foot">Needed only for publishing to your Worlds and Land.</p>}
    </div>
  )
}

// The Home Account section body: signed-in card, or the full sign-in flow.
export function AccountSection(): JSX.Element {
  const auth = useAuth()
  return (
    <>
      <header className="eui-home-head">
        <div>
          <h1>Account</h1>
          <p>{auth.wallet !== null ? 'Signed in with Decentraland.' : 'Sign in with Decentraland to publish scenes to your Worlds and Land.'}</p>
        </div>
      </header>
      {auth.wallet === null ? (
        <div className="eui-account-card">
          <SignInFlow />
        </div>
      ) : (
        <>
          <div className="eui-account-card signed">
            <Avatar face={auth.profile?.face256 ?? null} size={56} />
            <div className="eui-account-meta">
              <span className="nm">{auth.profile?.name !== undefined && auth.profile.name !== '' ? auth.profile.name : 'Decentraland account'}</span>
              <span className="wa" data-tip={auth.wallet}>{shortWallet(auth.wallet)}</span>
            </div>
            <span style={{ flex: 1 }} />
            <Button onClick={auth.signOut}>Sign out</Button>
          </div>
          <div className="eui-account-soon">Publishing to your Worlds &amp; Land — coming soon.</div>
        </>
      )}
    </>
  )
}
