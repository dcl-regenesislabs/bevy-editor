// What a failed publish should say.
//
// sdk-commands writes its whole build log to stdout, so the tail we keep is
// mostly progress chatter wearing colour codes. Dumping it centred in a dialog
// is how "Cannot find module" ends up wrapped between "Bundle saved" and a
// debug line. The creator needs the line that names what broke; everything else
// belongs behind Show details, which already exists.
import { stripAnsi } from '../../lib/ansi'

// Lines that only report progress. A build prints many and none of them explain
// a failure.
const NOISE = /^(debug:|info:|\[?\d+\/\d+\]?$|bundle saved|running type checker|build succeeded)/i

// tsc, esbuild and node all mark a real problem one of these ways.
const BLAME = /\berror\b|\bERR!|\bTS\d{4}\b|\bcannot find\b|\bfailed\b/i

export interface PublishFailure {
  headline: string
  /** the lines worth reading, cleaned; empty when the log explained nothing */
  detail: string[]
}

export function publishFailure(headline: string, log: string[]): PublishFailure {
  const clean = log
    .map((l) => stripAnsi(l).trimEnd())
    .filter((l) => l.trim() !== '')
    .filter((l) => !NOISE.test(l.trim()))
  const blamed = clean.filter((l) => BLAME.test(l))
  // Prefer the lines that name a problem; fall back to the tail rather than
  // showing nothing, because a build can fail without matching any of them.
  const detail = blamed.length > 0 ? blamed : clean.slice(-3)
  return { headline, detail: detail.slice(-6) }
}
