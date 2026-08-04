import { useEffect } from 'react'
import { Button } from '../../ds'
import { reactive } from '../../core/store'
import { storedFlag, setStoredFlag } from '../../core/persist'
import { hasValidIdentity, useAuth } from '../account/auth'
import { SignInFlow } from '../account/account'
import dclLogo from '../../assets/dcl-logo.png'

const SEEN = 'welcome-seen'

function welcomeNeeded(): boolean {
  return !storedFlag(SEEN, false) && !hasValidIdentity()
}

// The gate is a store rather than component state so it can be dismissed from
// outside React — see enterAsGuest, which the e2e harness and the devtools
// escape hatch both call.
export const welcomeGate = reactive({ needed: welcomeNeeded() })

// Continue without an account: what the Guest button does, and the one way past
// this screen that doesn't involve signing in. Marks the choice so it isn't
// asked again on this device.
export function enterAsGuest(): void {
  setStoredFlag(SEEN, true)
  welcomeGate.needed = false
}

export function Welcome(): JSX.Element {
  const auth = useAuth()
  // signing in answers the same question the Guest button does
  useEffect(() => {
    if (auth.wallet !== null) welcomeGate.needed = false
  }, [auth.wallet])
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
            <Button className="eui-welcome-btn" variant="ghost" size="lg" onClick={enterAsGuest}>Guest</Button>
          </div>
        )}
        <p className="eui-welcome-foot">Guest work stays on this device until you sign in.</p>
      </div>
    </div>
  )
}
