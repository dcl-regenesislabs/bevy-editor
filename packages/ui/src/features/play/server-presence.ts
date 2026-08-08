// Does the scene being played carry a Multiplayer Server at all?
//
// Same question the Prefabs panel's SDK gate asks before placing a server-aware
// item (prefabs/sdk-gate.ts), over the same bridge — `sdkCapability` reads the
// installed SDK's network typings in the scene folder. No second wire: one probe
// answers both "can this item run here" and "is there a server to reach".
//
// The web build has no shell and a scene with no node_modules has no answer yet;
// both come back `unknown`, and unknown leaves the strip's wording alone.
import { log } from '../../log'
import { serverPresence, type ServerPresence } from './game-life'

function projectDir(): string | null {
  return new URLSearchParams(window.location.search).get('project')
}

export async function readServerPresence(): Promise<ServerPresence> {
  const probe = window.editorShell?.sdkCapability
  const dir = projectDir()
  if (probe === undefined || dir === null) return 'unknown'
  try {
    return serverPresence(await probe(dir))
  } catch (e) {
    log.debug('sdk capability probe failed', e)
    return 'unknown'
  }
}
