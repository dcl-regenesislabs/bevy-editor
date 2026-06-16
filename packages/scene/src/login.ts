import { getPlayer } from '@dcl/sdk/players'
import { BevyApi } from './bevy-api'
import { waitFor } from './utils'

// Resolves once a player entity exists, or false if it never appears in `ms`.
async function playerWithin(ms: number): Promise<boolean> {
  try {
    await waitFor(() => getPlayer() !== null, ms)
    return true
  } catch {
    return false
  }
}

// Logs in automatically: reuses an existing profile if one is present, otherwise
// falls back to a guest session. Every wait is bounded and the guest path is
// retried — a stale profile or a cold realm can "succeed" the login call yet
// never spawn a player, which used to wedge the editor at "logging-in" forever.
// Worst case we give up waiting and let the editor proceed (the free-cam editor
// doesn't strictly need the avatar) rather than hang.
export async function autoLogin(): Promise<void> {
  const previous = await BevyApi.getPreviousLogin().catch(() => null)

  if (previous?.userId !== null && previous?.userId !== undefined) {
    console.log('found previous login', previous.userId, '- logging in')
    const result = await BevyApi.loginPrevious().catch((e) => ({
      success: false,
      error: String(e)
    }))
    if (result.success && (await playerWithin(10000))) {
      console.log('logged in (previous), player present')
      return
    }
    console.error('previous login produced no player, falling back to guest')
  } else {
    console.log('no previous login - logging in as guest')
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      BevyApi.loginGuest()
    } catch (e) {
      console.error('loginGuest threw:', e)
    }
    if (await playerWithin(8000)) {
      console.log('logged in as guest, player present')
      return
    }
    console.log(`guest login attempt ${attempt + 1}: no player yet, retrying…`)
  }

  console.error('autoLogin: player never appeared after retries — continuing anyway')
}
