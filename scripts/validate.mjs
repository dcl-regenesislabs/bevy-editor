// Deterministic validation gate for the editor monorepo.
//
// This is the check an agent (or CI, or a developer) runs after ANY change to
// confirm nothing is broken: it type-checks every package and runs the full
// build pipeline (scene -> ui -> desktop). Fast, hermetic, no engine/Electron
// needed. For the slower end-to-end runtime check, see `npm run validate:e2e`.
//
// Usage: `npm run validate` (from the monorepo root). Exits non-zero if any step
// fails, printing a compact per-step PASS/FAIL summary.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const steps = [
  { name: 'typecheck (all packages)', cmd: 'npm', args: ['run', 'typecheck'] },
  { name: 'unit tests (vitest)', cmd: 'npm', args: ['test'] },
  { name: 'build (scene → ui → desktop)', cmd: 'npm', args: ['run', 'build'] }
]

const results = []
for (const step of steps) {
  process.stdout.write(`\n▶ ${step.name}\n`)
  const r = spawnSync(step.cmd, step.args, { cwd: root, stdio: 'inherit', shell: false })
  const ok = r.status === 0
  results.push({ name: step.name, ok })
  if (!ok) break // a failing step makes later ones meaningless
}

const line = '─'.repeat(48)
process.stdout.write(`\n${line}\nVALIDATION SUMMARY\n${line}\n`)
for (const r of results) process.stdout.write(`  ${r.ok ? '✅ PASS' : '❌ FAIL'}  ${r.name}\n`)
const allOk = results.length === steps.length && results.every((r) => r.ok)
process.stdout.write(`${line}\n${allOk ? '✅ ALL CHECKS PASSED' : '❌ VALIDATION FAILED'}\n`)
process.exit(allOk ? 0 : 1)
