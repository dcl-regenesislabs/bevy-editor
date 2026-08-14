// Copy and small pure helpers for the chat surface.
import type { AiImageAttachment, AiProvider } from '@dcl-editor/contract'

export const MAX_ATTACH = 4
const MAX_ATTACH_BYTES = 8 * 1024 * 1024

export function readImages(files: Iterable<File>, room: number): Promise<AiImageAttachment[]> {
  const picked = [...files].filter((f) => f.type.startsWith('image/') && f.size > 0 && f.size <= MAX_ATTACH_BYTES).slice(0, room)
  return Promise.all(
    picked.map(
      (f) =>
        new Promise<AiImageAttachment>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve({ name: f.name === '' ? 'pasted image' : f.name, dataUrl: String(r.result) })
          r.onerror = () => reject(new Error(`could not read ${f.name}`))
          r.readAsDataURL(f)
        })
    )
  )
}

export const EXAMPLES = [
  'Open the door on pointer down, close it after 3s',
  'Make this entity spin slowly around Y',
]

// One-tap prompts shown when a code range is attached (for creators who don't read TS).
export const QUICK_ACTIONS: Array<[string, string]> = [
  ['Explain', 'Explain what the selected code does, in plain language.'],
  ['Fix', 'Find and fix any bugs in the selected code.'],
  ['Comment', 'Add clear, concise comments to the selected code.'],
  ['Improve', 'Improve the selected code — clarity and correctness — without changing what it does.']
]

// Install + sign-in steps shown when a provider's CLI isn't available.
export const SETUP: Record<AiProvider, { install: string; signIn: string }> = {
  claude: { install: 'npm i -g @anthropic-ai/claude-code', signIn: 'claude' },
  codex: { install: 'npm i -g @openai/codex', signIn: 'codex login' }
}

// The CLI's own error text is for developers; creators get the next action.
export function friendlyError(raw: string): string {
  const s = raw.toLowerCase()
  if (s.includes('not found') || s.includes('enoent')) return "The assistant's CLI isn't installed or on PATH."
  if (s.includes('logged in') || s.includes('login') || s.includes('unauthorized') || s.includes('401'))
    return 'Not signed in — sign in to your subscription from a terminal, then try again.'
  if (s.includes('open a scene')) return 'Open a scene first, then ask the assistant.'
  if (s.includes('rate') && s.includes('limit')) return "You've hit your plan's rate limit — wait a moment and retry."
  if (s.includes('timed out') || s.includes('timeout')) return 'The request timed out. Try again.'
  return "The assistant hit an error. Retry, or check it's signed in."
}

export function composerPlaceholder(available: boolean, hasSelection: boolean): string {
  if (!available) return 'Assistant unavailable'
  if (hasSelection) return 'Ask about the selected code…'
  return 'Describe what you want it to do…'
}

// The CLI reports paths its own way (backslashes, ./ prefixes) — match them
// against the file the editor has open.
export function sameFile(reported: string, open: string): boolean {
  const a = reported.replace(/\\/g, '/').replace(/^\.\//, '')
  const b = open.replace(/^\.\//, '')
  return a === b || a.endsWith(`/${b}`)
}
