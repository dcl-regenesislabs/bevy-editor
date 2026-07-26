// Gate the packaged app size and report the MB diff a PR introduces.
//
// Every PR carries its own app-size.json: the author commits the sizes their
// branch produces, so the growth is visible right in the diff. CI re-measures
// and fails when the committed file is missing or stale (beyond toleranceMb),
// or when an image blows its budget. Growth under budget only warns — see
// .github/workflows/desktop-images.yml.
//
// Usage: node scripts/size-check.mjs --measured <dir> [--base <file.json>]
//                                    [--out <report.md>] [--report-only]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const trackedPath = path.join(root, 'app-size.json')

// a size we can't compare must never pass silently — every error here is fatal
const fail = (message) => {
  console.error(message)
  process.exit(1)
}

const arg = (name) => {
  const i = process.argv.indexOf(name)
  if (i === -1) return null
  const value = process.argv[i + 1]
  if (!value || value.startsWith('--')) fail(`${name} needs a value`)
  return value
}

const measuredDir = arg('--measured')
const basePath = arg('--base')
const outPath = arg('--out')
const reportOnly = process.argv.includes('--report-only')

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const fmt = (n) => `${n.toFixed(1)} MB`
const delta = (n) => (n === 0 ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)} MB`)
const markdownRow = (...cells) => `| ${cells.join(' | ')} |`
const componentNames = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]

if (!measuredDir || !fs.existsSync(measuredDir)) {
  fail(`--measured <dir> is required and must exist (got: ${measuredDir})`)
}

// one JSON per packaging job, merged into a single measurement set
const measured = {}
for (const file of fs.readdirSync(measuredDir).filter((name) => name.endsWith('.json'))) {
  for (const [key, m] of Object.entries(readJson(path.join(measuredDir, file)))) {
    if (typeof m?.installerMb !== 'number' || typeof m?.installedMb !== 'number') {
      fail(`${file}: "${key}" is not a size measurement — expected { installerMb, installedMb, components }`)
    }
    measured[key] = m
  }
}
if (Object.keys(measured).length === 0) fail(`no size reports found in ${measuredDir}`)

if (!fs.existsSync(trackedPath)) {
  fail('app-size.json is missing — every PR must commit the sizes it produces')
}
const tracked = readJson(trackedPath)
const tolerance = tracked.toleranceMb ?? 1
const budgets = tracked.budgets ?? {}
const committed = tracked.measurements ?? {}
const base = basePath && fs.existsSync(basePath) ? (readJson(basePath).measurements ?? null) : null

const keys = [...new Set([...Object.keys(committed), ...Object.keys(measured)])].sort()
const stale = []
const overBudget = []

for (const key of keys) {
  const got = measured[key]
  const want = committed[key]
  if (!got) {
    stale.push(`${key}: tracked in app-size.json but this run built no such image`)
    continue
  }
  if (!want) {
    stale.push(`${key}: built by CI but absent from app-size.json`)
    continue
  }

  const fields = [
    ['installerMb', got.installerMb, want.installerMb],
    ['installedMb', got.installedMb, want.installedMb]
  ]
  for (const name of componentNames(got.components, want.components)) {
    fields.push([`components.${name}`, got.components?.[name], want.components?.[name]])
  }
  for (const [field, actual, claimed] of fields) {
    if (typeof actual !== 'number' || typeof claimed !== 'number') {
      const missingFrom = typeof actual !== 'number' ? 'this build' : 'app-size.json'
      stale.push(`${key}.${field}: missing on ${missingFrom}`)
    } else if (Math.abs(actual - claimed) > tolerance) {
      stale.push(`${key}.${field}: app-size.json says ${fmt(claimed)}, this build is ${fmt(actual)}`)
    }
  }

  const budget = budgets[key]
  if (budget?.installerMb && got.installerMb > budget.installerMb) {
    overBudget.push(`${key} installer ${fmt(got.installerMb)} exceeds the ${fmt(budget.installerMb)} budget`)
  }
  if (budget?.installedMb && got.installedMb > budget.installedMb) {
    overBudget.push(`${key} installed ${fmt(got.installedMb)} exceeds the ${fmt(budget.installedMb)} budget`)
  }
}

const budgetCell = (key, got) => {
  const limit = budgets[key]?.installerMb
  if (!limit) return '—'
  return `${fmt(limit)} ${got.installerMb > limit ? '❌' : '✅'}`
}

const sizeRows = []
// what actually moved — the breakdown is the only thing that says *why* it grew
const movedRows = []

for (const key of keys) {
  const got = measured[key]
  if (!got) {
    sizeRows.push(markdownRow(`\`${key}\``, 'not built', '—', '—', '—', '—'))
    continue
  }
  const prev = base?.[key]
  sizeRows.push(
    markdownRow(
      `\`${key}\``,
      fmt(got.installerMb),
      prev ? delta(got.installerMb - prev.installerMb) : 'n/a',
      fmt(got.installedMb),
      prev ? delta(got.installedMb - prev.installedMb) : 'n/a',
      budgetCell(key, got)
    )
  )
  if (!prev) continue
  for (const [name, size] of Object.entries(got.components ?? {})) {
    const moved = size - (prev.components?.[name] ?? 0)
    if (Math.abs(moved) >= 0.1) movedRows.push(markdownRow(`\`${key}\``, name, fmt(size), delta(moved)))
  }
}

const lines = [
  '### 📦 App size',
  '',
  markdownRow('image', 'installer', 'Δ vs main', 'installed', 'Δ vs main', 'budget'),
  markdownRow('---', '---', '---', '---', '---', '---'),
  ...sizeRows
]

if (movedRows.length) {
  lines.push('', '<details><summary>what moved</summary>', '')
  lines.push(markdownRow('image', 'component', 'size', 'Δ vs main'), markdownRow('---', '---', '---', '---'))
  lines.push(...movedRows)
  lines.push('', '</details>')
} else if (base) {
  lines.push('', '_No component moved by more than 0.1 MB._')
} else {
  lines.push('', '_No baseline on the target branch — showing absolute sizes only._')
}

if (overBudget.length) {
  lines.push('', '**❌ Over budget**', '', ...overBudget.map((m) => `- ${m}`))
  lines.push('', 'Shrink the image or raise the budget in `app-size.json` — deliberately, in this PR.')
}
if (stale.length) {
  lines.push('', '**❌ `app-size.json` is out of date**', '', ...stale.map((m) => `- ${m}`))
  lines.push(
    '',
    `Update the \`measurements\` block in \`app-size.json\` to the values this build measured (tolerance ±${fmt(tolerance)}):`,
    '',
    '```json',
    JSON.stringify({ ...tracked, measurements: measured }, null, 2),
    '```'
  )
}

const report = lines.join('\n') + '\n'
process.stdout.write(report)
if (outPath) fs.writeFileSync(path.resolve(outPath), report)

const failed = !reportOnly && (stale.length > 0 || overBudget.length > 0)
if (failed) {
  console.error(`\n::error::app size check failed — ${stale.length} stale field(s), ${overBudget.length} over budget`)
}
process.exit(failed ? 1 : 0)
