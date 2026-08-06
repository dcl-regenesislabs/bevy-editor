// How a turn's tool calls are presented. Creators read verbs, not tool names, and
// the noisy steps (reads, shells, searches) collapse into one expandable row per
// run so a long turn doesn't bury its actual edits.
import { useState } from 'react'
import { Spinner } from '../../ds'
import { CheckIcon } from './icons'

export interface ToolUse {
  tool: string
  detail: string
}

// tool chips that changed the project or the scene, highlighted apart from reads
export const MUTATION_TOOLS = new Set(['Edit', 'Write', 'Attached', 'Placed', 'Set'])
// events that stay visible as their own chip; everything else (reads, shell,
// searches) collapses into one expandable activity row per run
const CHIP_TOOLS = new Set([...MUTATION_TOOLS, 'Skipped'])

// [done, in-progress] verbs per tool — creators read these, not tool names
const TOOL_VERBS: Record<string, [string, string]> = {
  Read: ['Read', 'Reading'],
  Edit: ['Edited', 'Editing'],
  Write: ['Created', 'Creating'],
  Bash: ['Ran', 'Running'],
  Run: ['Ran', 'Running'],
  Grep: ['Searched', 'Searching'],
  Glob: ['Searched', 'Searching'],
  WebSearch: ['Searched the web for', 'Searching the web for'],
  WebFetch: ['Fetched', 'Fetching'],
  Task: ['Worked on', 'Working on'],
  TodoWrite: ['Updated the plan', 'Planning'],
  Attached: ['Attached', 'Attaching'],
  Placed: ['Placed', 'Placing'],
  Set: ['Set', 'Setting']
}

export function toolLabel(t: ToolUse, active = false): string {
  const verbs = TOOL_VERBS[t.tool]
  const verb = verbs === undefined ? t.tool : verbs[active ? 1 : 0]
  return t.detail === '' ? verb : `${verb} ${t.detail}`
}

// a chip row: one tool use, plus how many identical ones it stands in for
export interface ToolChip {
  t: ToolUse
  n: number
}

// consecutive non-chip events fold into one activity group, and repeats of the
// same chip (four edits to the same file) fold into one counted chip; order kept
export function groupTools(tools: ToolUse[]): Array<ToolChip | ToolUse[]> {
  const out: Array<ToolChip | ToolUse[]> = []
  for (const t of tools) {
    const last = out[out.length - 1]
    if (CHIP_TOOLS.has(t.tool)) {
      if (last !== undefined && !Array.isArray(last) && last.t.tool === t.tool && last.t.detail === t.detail) last.n++
      else out.push({ t, n: 1 })
    } else if (Array.isArray(last)) last.push(t)
    else out.push([t])
  }
  return out
}

function activitySummary(items: ToolUse[]): string {
  const files = new Set<string>()
  let reads = 0
  let cmds = 0
  let searches = 0
  let other = 0
  for (const t of items) {
    if (t.tool === 'Read') {
      reads++
      if (t.detail !== '') files.add(t.detail)
    } else if (t.tool === 'Bash' || t.tool === 'Run') cmds++
    else if (t.tool === 'Grep' || t.tool === 'Glob' || t.tool === 'WebSearch') searches++
    else other++
  }
  const n = files.size > 0 ? files.size : reads
  const parts: string[] = []
  if (n > 0) parts.push(`read ${n} file${n === 1 ? '' : 's'}`)
  if (cmds > 0) parts.push(`ran ${cmds} command${cmds === 1 ? '' : 's'}`)
  if (searches > 0) parts.push(`${searches} search${searches === 1 ? '' : 'es'}`)
  if (other > 0) parts.push(`${other} other step${other === 1 ? '' : 's'}`)
  if (parts.length === 0) return 'Looked around'
  const s = parts.join(' · ')
  return s[0].toUpperCase() + s.slice(1)
}

function dedupeRuns(items: ToolUse[]): ToolChip[] {
  const out: ToolChip[] = []
  for (const t of items) {
    const last = out[out.length - 1]
    if (last !== undefined && last.t.tool === t.tool && last.t.detail === t.detail) last.n++
    else out.push({ t, n: 1 })
  }
  return out
}

export function ActivityGroup(props: { items: ToolUse[]; running: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  const last = props.items[props.items.length - 1]
  const label = props.running ? `${toolLabel(last, true)}…` : activitySummary(props.items)
  return (
    <div className={`eui-ai-activity ${open ? 'open' : ''}`}>
      <button className="eui-ai-activity-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="ti">{props.running ? <Spinner size={11} /> : <CheckIcon />}</span>
        <span className="lbl">{label}</span>
        {props.items.length > 1 && <span className="ct">{props.items.length} steps</span>}
        <svg className="chev" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="eui-ai-activity-list">
          {dedupeRuns(props.items).map((d, i) => (
            <span key={i} className="row">
              {toolLabel(d.t)}
              {d.n > 1 && <span className="n">×{d.n}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
