// Gate the packaged app size and report the MB diff a PR introduces.
//
// The baseline is what CI measured on the target branch's latest successful
// build (its size-* artifacts) — nothing is committed, so there is no
// staleness to maintain. app-size.json holds only the knobs: absolute
// per-image budgets, and maxGrowthMb — the biggest growth vs main a PR can
// merge without touching the file. See .github/workflows/desktop-images.yml.
//
// Usage: node scripts/size-check.mjs --measured <dir> [--base <dir>]
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
const baseDir = arg('--base')
const outPath = arg('--out')
const reportOnly = process.argv.includes('--report-only')

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const fmt = (n) => `${n.toFixed(1)} MB`
const delta = (n) => (n === 0 ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)} MB`)
const markdownRow = (...cells) => `| ${cells.join(' | ')} |`

// merge every measurement JSON under `dir` (recursive: artifact downloads
// arrive one directory per artifact) into { imageKey: measurement }
const readReports = (dir) => {
  const merged = {}
  if (!dir || !fs.existsSync(dir)) return merged
  for (const entry of fs.readdirSync(dir, { recursive: true })) {
    if (!entry.endsWith('.json')) continue
    const p = path.join(dir, entry)
    for (const [key, m] of Object.entries(readJson(p))) {
      if (typeof m?.installerMb !== 'number' || typeof m?.installedMb !== 'number') {
        fail(`${p}: "${key}" is not a size measurement — expected { installerMb, installedMb, components }`)
      }
      merged[key] = m
    }
  }
  return merged
}

if (!measuredDir || !fs.existsSync(measuredDir)) {
  fail(`--measured <dir> is required and must exist (got: ${measuredDir})`)
}
const measured = readReports(measuredDir)
if (Object.keys(measured).length === 0) fail(`no size reports found in ${measuredDir}`)

// baseline may legitimately be empty (first run, expired artifacts) — the
// growth gate is skipped then, loudly; budgets still apply
const base = readReports(baseDir)
const hasBase = Object.keys(base).length > 0

if (!fs.existsSync(trackedPath)) fail('app-size.json is missing — it holds the budgets')
const tracked = readJson(trackedPath)
const budgets = tracked.budgets ?? {}
const maxGrowthMb = tracked.maxGrowthMb ?? 1

// main builds extra arches (e.g. mac-x64) the PR didn't — only gate what this
// run actually built
const keys = Object.keys(measured).sort()
const overBudget = []
const grew = []

for (const key of keys) {
  const got = measured[key]
  const budget = budgets[key]
  if (budget?.installerMb && got.installerMb > budget.installerMb) {
    overBudget.push(`${key} installer ${fmt(got.installerMb)} exceeds the ${fmt(budget.installerMb)} budget`)
  }
  if (budget?.installedMb && got.installedMb > budget.installedMb) {
    overBudget.push(`${key} installed ${fmt(got.installedMb)} exceeds the ${fmt(budget.installedMb)} budget`)
  }

  const prev = base[key]
  if (!prev) continue
  for (const [field, label] of [['installerMb', 'installer'], ['installedMb', 'installed']]) {
    const d = got[field] - prev[field]
    if (d > maxGrowthMb) {
      grew.push(`${key} ${label} grew ${delta(d)} vs main (${fmt(prev[field])} → ${fmt(got[field])}, limit +${fmt(maxGrowthMb)})`)
    }
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
  const prev = base[key]
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
} else if (hasBase) {
  lines.push('', '_No component moved by more than 0.1 MB._')
} else if (!reportOnly) {
  lines.push('', "⚠️ _No main baseline available (no successful main build with size artifacts) — growth isn't gated this run; budgets still apply._")
}

if (overBudget.length) {
  lines.push('', '**❌ Over budget**', '', ...overBudget.map((m) => `- ${m}`))
}
if (grew.length) {
  lines.push('', `**❌ Grew more than ${fmt(maxGrowthMb)} vs main**`, '', ...grew.map((m) => `- ${m}`))
}
if (overBudget.length || grew.length) {
  lines.push('', 'Shrink the image, or raise `maxGrowthMb`/`budgets` in `app-size.json` — deliberately, in this PR.')
}

const report = lines.join('\n') + '\n'
process.stdout.write(report)
if (outPath) fs.writeFileSync(path.resolve(outPath), report)

const failed = !reportOnly && (overBudget.length > 0 || grew.length > 0)
if (failed) {
  console.error(`\n::error::app size check failed — ${grew.length} grew past maxGrowthMb, ${overBudget.length} over budget`)
}
process.exit(failed ? 1 : 0)
