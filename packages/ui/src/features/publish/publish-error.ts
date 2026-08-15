// What a failed publish should say.
//
// sdk-commands writes its whole build log to stdout, so the tail is mostly
// progress chatter wearing colour codes, and tsc reports one mistake several
// times over: a "Found N errors in ..." census, the diagnostic itself, and often
// both again through a second stream. Showing the tail verbatim means the same
// sentence three times and the count lines in between.
//
// So this parses rather than filters: each diagnostic becomes one problem, keyed
// by where it happened, and repeats collapse. The creator sees what broke and
// where; the untouched log stays behind Show details.
import { stripAnsi } from '../../lib/ansi'

export interface BuildProblem {
  path: string
  line: number
  column: number | null
  /** the compiler's own sentence, without the location or the error code */
  message: string
}

export interface PublishFailure {
  headline: string
  problems: BuildProblem[]
  /** cleaned lines to show when nothing parsed — never alongside problems */
  detail: string[]
}

// "src/a.ts:10:33 - error TS2307: Cannot find module 'x'" (tsc) and
// "src/a.ts:19:20: ERROR: Could not resolve 'x'" (esbuild). The code is dropped:
// TS2307 tells a creator nothing the sentence after it does not.
const DIAGNOSTIC =
  /((?:[\w.-]+\/)*[\w.-]+\.tsx?):(\d+)(?::(\d+))?\s*[-:]\s*(?:error|ERROR)\s*(?:TS\d+)?\s*:?\s*(.+)$/

// A census of errors, not an error. tsc prints one per file and one per run.
const CENSUS = /^\s*(Found \d+ errors?|\d+ errors? found)/i

const NOISE = /^(debug:|info:|\[?\d+\/\d+\]?$|bundle saved|running type checker|build succeeded)/i

export function publishFailure(headline: string, log: string[]): PublishFailure {
  const clean = log
    .map((l) => stripAnsi(l).trim())
    .filter((l) => l !== '' && !NOISE.test(l) && !CENSUS.test(l))

  const problems = new Map<string, BuildProblem>()
  for (const line of clean) {
    // The SDK's own frames are not the creator's mistake and cannot be opened.
    if (line.includes('node_modules')) continue
    const m = DIAGNOSTIC.exec(line)
    if (m === null) continue
    const p: BuildProblem = {
      path: m[1].replace(/^\.\//, ''),
      line: Number(m[2]),
      column: m[3] === undefined ? null : Number(m[3]),
      message: m[4].trim()
    }
    problems.set(`${p.path}:${p.line}:${p.column ?? ''}:${p.message}`, p)
  }

  // Only fall back to raw lines when nothing parsed — two ways of saying the
  // same thing side by side is the noise this exists to remove.
  const found = [...problems.values()]
  return {
    headline,
    problems: found,
    detail: found.length > 0 ? [] : clean.slice(-3)
  }
}
