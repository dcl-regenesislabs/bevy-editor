// What this player sees about their own run. Only a client ever calls it, so
// nothing here decides anything — it reads what the server already decided.
//
// Deliberately plain lines: the toast every player sees is the Announcer item's
// job, and the podium's dancing avatars are the one thing of the original this
// rebuild cannot reproduce (no server-side profile lookup exists).
import { shortName } from './pure/names'
import type { Run } from './pure/boards'

export interface Verdict {
  ok: boolean
  time?: number
  why?: string
}

export function showVerdict(verdict: Verdict): void {
  if (verdict.ok) {
    console.log(`[you] summit! ${(verdict.time ?? 0).toFixed(2)}s`)
    return
  }
  console.log(`[you] not counted — ${verdict.why ?? 'the server refused it'}`)
}

export function showPodium(top: Run[]): void {
  if (top.length === 0) {
    console.log('[you] round over — nobody made it up.')
    return
  }
  const line = top.map((run, place) => `${place + 1}. ${shortName(run.p)} ${run.time.toFixed(2)}s`).join('   ')
  console.log(`[you] round over — ${line}`)
}
