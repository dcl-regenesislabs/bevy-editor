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
  /** where in the creator's own code it broke, when the log said */
  at: { path: string; line: number; column: number | null } | null
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
  return { headline, detail: detail.slice(-6), at: locate(detail) }
}

// A source position inside the creator's project, as tsc, esbuild and stack
// frames print it. The SDK's own frames are not something to open.
const LOCATION = /(?:^|[\s(/])((?:[\w.-]+\/)*[\w.-]+\.tsx?):(\d+)(?::(\d+))?/

function locate(lines: string[]): PublishFailure['at'] {
  for (const line of lines) {
    // The whole line, not the captured path: the pattern can start matching
    // after a slash, so "node_modules/@dcl/sdk/index.ts" captures "sdk/index.ts"
    // and a guard on the capture alone would offer to open the SDK's own code.
    if (line.includes('node_modules')) continue
    const m = LOCATION.exec(line)
    if (m === null) continue
    return { path: m[1].replace(/^\.\//, ''), line: Number(m[2]), column: m[3] === undefined ? null : Number(m[3]) }
  }
  return null
}
