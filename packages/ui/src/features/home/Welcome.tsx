import { useEffect } from 'react'
import { Button } from '../../ds'
import { storedFlag, setStoredFlag } from '../../core/persist'
import { hasValidIdentity, useAuth } from '../account/auth'
import { SignInFlow } from '../account/account'
import dclLogo from '../../assets/dcl-logo.png'

const SEEN = 'welcome-seen'

export function welcomeNeeded(): boolean {
  return !storedFlag(SEEN, false) && !hasValidIdentity()
}

export function markWelcomeSeen(): void {
  setStoredFlag(SEEN, true)
}

export function Welcome(props: { onDone: () => void }): JSX.Element {
  const auth = useAuth()
  const { onDone } = props
  useEffect(() => {
    if (auth.wallet !== null) onDone()
  }, [auth.wallet, onDone])
  const busy = auth.signingIn || auth.phase === 'error'
  return (
    <div className="eui-welcome">
      <div className="eui-welcome-panel">
        <img className="eui-welcome-logo" src={dclLogo} alt="" />
        <h1>Welcome to Creator Hub</h1>
        <p className="eui-welcome-sub">Sign in to create, publish, and manage your Decentraland scenes.</p>
        {busy ? (
          <div className="eui-welcome-flow">
            <SignInFlow />
          </div>
        ) : (
          <div className="eui-welcome-actions">
            <Button className="eui-welcome-btn" variant="primary" size="lg" onClick={auth.signIn}>Sign in</Button>
            <Button className="eui-welcome-btn" variant="ghost" size="lg" onClick={onDone}>Guest</Button>
          </div>
        )}
        <p className="eui-welcome-foot">Guest work stays on this device until you sign in.</p>
      </div>
    </div>
  )
}
