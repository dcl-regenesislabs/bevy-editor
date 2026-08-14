// Deterministic validation gate for the editor monorepo.
//
// This is the check an agent (or CI, or a developer) runs after ANY change to
// confirm nothing is broken: it lints, type-checks every package, runs the unit
// suites and builds every bundle. Fast, hermetic, no engine/Electron needed.
// For the slower end-to-end runtime check, see `npm run validate:e2e`.
//
// The steps run CONCURRENTLY. None of them reads another's output: the three
// bundles land in separate dist dirs, and nothing consumes the scene bundle
// until `stage-resources.mjs` copies it at packaging time. Their output is
// buffered and replayed per step so concurrent writers can't interleave.
//
// Usage: `npm run validate` (from the monorepo root). Exits non-zero if any step
// fails, printing a compact per-step PASS/FAIL summary.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { availableParallelism } from 'node:os'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Even/LTS-track Node only, and fail here — not three steps deep in a vitest
// suite. Node 25 shipped a default localStorage global with no working methods;
// it shadowed happy-dom's in the DOM tests and the failure blamed the wrong code.
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 24 || nodeMajor % 2 === 1) {
  process.stderr.write(
    `Node ${process.versions.node} is not supported: use an even-numbered LTS-track version (CI runs 24).\n` +
      `Install Node 24 LTS — nvm: "nvm install --lts", Windows: "winget install OpenJS.NodeJS.LTS".\n`
  )
  process.exit(1)
}

// The bundles are listed separately rather than via the root `build` script:
// that script chains them sequentially for `npm start`/`npm run dist`, and here
// the whole point is to not wait.
const steps = [
  { name: 'lint (eslint)', args: ['run', 'lint'] },
  { name: 'typecheck (all packages)', args: ['run', 'typecheck'] },
  { name: 'unit tests (vitest)', args: ['test'] },
  { name: 'build (scene)', args: ['run', 'build:scene'] },
  { name: 'build (ui)', args: ['run', 'build:ui'] },
  { name: 'build (desktop main)', args: ['run', 'build:main', '-w', '@dcl-editor/desktop'] }
]

function run(step) {
  return new Promise((resolve) => {
    // Windows: npm is npm.cmd, which Node only executes through a shell
    const child = spawn('npm', step.args, { cwd: root, shell: process.platform === 'win32' })
    const chunks = []
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => chunks.push(chunk))
    child.on('error', (error) => resolve({ name: step.name, ok: false, output: `failed to spawn: ${error.message}\n` }))
    child.on('close', (code) => {
      process.stdout.write(`  ${code === 0 ? '✅' : '❌'} ${step.name}\n`)
      resolve({ name: step.name, ok: code === 0, output: Buffer.concat(chunks).toString() })
    })
  })
}

// vitest already fans out across cores, so oversubscribing here costs more in
// contention than it buys. Cap at the core count and let the queue drain.
const limit = Math.min(steps.length, availableParallelism())

// Results are stored by index, so the log below reads in declaration order
// rather than completion order and every run looks the same.
const results = new Array(steps.length)
let next = 0

process.stdout.write(`\n▶ running ${steps.length} checks (up to ${limit} at once)\n\n`)

await Promise.all(
  Array.from({ length: limit }, async () => {
    while (next < steps.length) {
      const index = next++
      results[index] = await run(steps[index])
    }
  })
)

// Failures go last: that's what you scroll back to.
const passed = results.filter((result) => result.ok)
const failed = results.filter((result) => !result.ok)
for (const result of [...passed, ...failed]) {
  process.stdout.write(`\n▶ ${result.name}\n${result.output}`)
}

const line = '─'.repeat(48)
process.stdout.write(`\n${line}\nVALIDATION SUMMARY\n${line}\n`)
for (const result of results) process.stdout.write(`  ${result.ok ? '✅ PASS' : '❌ FAIL'}  ${result.name}\n`)
process.stdout.write(`${line}\n${failed.length === 0 ? '✅ ALL CHECKS PASSED' : '❌ VALIDATION FAILED'}\n`)
process.exit(failed.length === 0 ? 0 : 1)
