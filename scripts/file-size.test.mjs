// The hard file-size gate: no source file over MAX_LINES lines, except the
// shrink-only allowlist in lint-allowlist.mjs (eslint's max-lines warns at 500
// as the early signal; this test is what fails the build). Same pattern as
// ds-contract.test.ts: the rule is enforced, and its escape hatch can only
// shrink — an allowlisted file that drops under the ceiling, or grows past its
// recorded size, fails here.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_LINES, OVERSIZE_ALLOWLIST } from './lint-allowlist.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) {
      sourceFiles(p, out)
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

const files = readdirSync(path.join(root, 'packages'))
  .map((pkg) => path.join(root, 'packages', pkg, 'src'))
  .filter((p) => {
    try {
      return statSync(p).isDirectory()
    } catch {
      return false
    }
  })
  .flatMap((srcDir) => sourceFiles(srcDir))

// wc -l semantics (newline count) so recorded maxima match what `wc -l` reports
const lineCount = (p) => (readFileSync(p, 'utf8').match(/\n/g) ?? []).length

describe('file-size gate', () => {
  it(`no source file exceeds ${MAX_LINES} lines (split it — see docs/REFACTOR-PLAN.md)`, () => {
    const allowed = new Set(OVERSIZE_ALLOWLIST.map((e) => path.join(root, e.file)))
    const offenders = files
      .filter((p) => !allowed.has(p))
      .map((p) => ({ file: path.relative(root, p), lines: lineCount(p) }))
      .filter((f) => f.lines > MAX_LINES)
    expect(offenders).toEqual([])
  })

  it('allowlist entries are real, still oversize, and shrink-only', () => {
    for (const entry of OVERSIZE_ALLOWLIST) {
      const lines = lineCount(path.join(root, entry.file))
      expect(lines, `${entry.file}: fixed — remove its allowlist entry`).toBeGreaterThan(MAX_LINES)
      expect(lines, `${entry.file}: grew past its recorded ${entry.max} lines`).toBeLessThanOrEqual(entry.max)
    }
  })
})
