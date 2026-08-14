// Why a publish that never reached the upload stopped — as a sentence, not a code.
//
// The incident this module exists for: sdk-commands `deploy` ran with its stdin
// closed. When it decided to ask "Continue? (y/N)" the readline question got EOF
// instead of an answer, the callback never fired, and the process EXITED 0
// without building anything. Reading every exit-before-ready as a build failure
// printed "The build failed." over a run that never compiled a line. Main now
// answers that prompt with "no" (publish-args.ts), which turns the same run into
// a plain non-zero exit — the classification has to hold for both.
//
// Everything classified here happened BEFORE the linker was ready, so before a
// single byte was signed or uploaded; and the CLI's destructive pre-flight (fetch
// world scenes → warn → prompt → DELETE) never gets past the prompt — it is
// flagged off by --multi-scene where that exists, declined where it doesn't, and
// refused before the spawn when declining it would cost the creator a publish
// (publish-preflight.ts). That is what makes `worldUnchanged` a fact we can state
// rather than a hope — it is not inferred from the exit code.

export interface PublishExitFacts {
  ready: boolean // the linker printed `ready at http://localhost:<port>` — the build got that far
  code: number | null // the child's exit code; null when a signal killed it
  sawPrompt: boolean // a line that asked the creator a question nobody could answer
}

export type PublishExitVerdict =
  | { kind: 'ignored'; reason: 'uploading' }
  | { kind: 'stopped'; reason: 'prompt' | 'early-exit' | 'signal'; message: string; worldUnchanged: true }
  | { kind: 'failed'; reason: 'build-error'; message: string; worldUnchanged: true }

export function stoppedMessage(world: string): string {
  return `Publishing stopped before it started — nothing in ${world} changed.`
}

export const BUILD_FAILED = 'The build failed.'

export function classifyPublishExit(facts: PublishExitFacts, world: string): PublishExitVerdict {
  // Past `ready` the upload owns the outcome (success, or the linker's own error);
  // the child exiting afterwards says nothing the creator needs to hear.
  if (facts.ready) return { kind: 'ignored', reason: 'uploading' }
  // A prompt nobody could answer is never the creator's build breaking, whatever
  // the exit code says — sending them to hunt a compile error would be a lie.
  if (facts.sawPrompt) {
    return { kind: 'stopped', reason: 'prompt', message: stoppedMessage(world), worldUnchanged: true }
  }
  if (facts.code === 0) {
    return { kind: 'stopped', reason: 'early-exit', message: stoppedMessage(world), worldUnchanged: true }
  }
  // Killed by a signal (our own publishStop, or the OS): nothing was built either.
  if (facts.code === null) {
    return { kind: 'stopped', reason: 'signal', message: stoppedMessage(world), worldUnchanged: true }
  }
  return { kind: 'failed', reason: 'build-error', message: BUILD_FAILED, worldUnchanged: true }
}

// The shape of a readline confirm, whatever wording is in front of it. Matched on
// the log line because that is the only channel a blocked child still has.
const CONFIRM = /\(\s*y\s*\/\s*n\s*\)/i

export function looksLikeBlockingPrompt(line: string): boolean {
  return CONFIRM.test(line)
}
