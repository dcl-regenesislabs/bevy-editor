import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiEvent, AiProviderInfo } from '@dcl-editor/contract'
import { AiPanel } from './AiPanel'
import { shadowedRuntimeProblem } from '../prefabs/generate'
import { mount, run } from '../test/render'

const { ensureScriptRuntime, runEditorRequests, attachScript } = vi.hoisted(() => ({
  ensureScriptRuntime: vi.fn(async () => ({ vendored: [] as string[], shadowed: [] as string[] })),
  runEditorRequests: vi.fn(async () => ({ outcomes: [], problems: [], attached: [] })),
  attachScript: vi.fn(async () => false)
}))

vi.mock('../prefabs/generate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../prefabs/generate')>()
  return { ...actual, ensureScriptRuntime }
})
vi.mock('../ai/requests', () => ({ runEditorRequests, clearEditorRequests: vi.fn(async () => {}) }))
vi.mock('../script/attach', () => ({ attachScript }))

// Mutate the property, never the window itself — this suite renders into the DOM.
const shellHost = window as unknown as {
  editorShell?: {
    aiSend: () => Promise<void>
    aiReset: () => Promise<void>
    aiStop: () => Promise<void>
    aiProviders: () => Promise<AiProviderInfo[]>
    onAiEvent: (cb: (e: AiEvent) => void) => void
  }
}

let emit: (e: AiEvent) => void = () => {}

beforeEach(() => {
  ensureScriptRuntime.mockClear()
  ensureScriptRuntime.mockResolvedValue({ vendored: [], shadowed: [] })
  runEditorRequests.mockClear()
  shellHost.editorShell = {
    aiSend: async () => {},
    aiReset: async () => {},
    aiStop: async () => {},
    aiProviders: async () => [],
    onAiEvent: (cb) => {
      emit = cb
    }
  }
})

afterEach(() => {
  delete shellHost.editorShell
})

async function turn(): Promise<ReturnType<typeof mount>> {
  const view = mount(<AiPanel shown fill={false} height={300} />)
  await view.settle()
  run(() => emit({ kind: 'started', turnId: 't1' }))
  run(() => emit({ kind: 'done', turnId: 't1', ok: true }))
  await view.settle()
  return view
}

// The assistant edits project files itself. When it changes a script that is
// already attached it writes no composite, so nothing else on this path vendors
// the runtime — and the import the system prompt tells it to write ('./runtime/…')
// would not resolve on the creator's next gesture, which is Play.
describe('AiPanel turn end', () => {
  it('vendors the script runtime when the turn wrote no requests and attached nothing', async () => {
    const view = await turn()
    expect(ensureScriptRuntime).toHaveBeenCalledTimes(1)
    expect(runEditorRequests).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('leaves it alone when the turn failed', async () => {
    const view = mount(<AiPanel shown fill={false} height={300} />)
    await view.settle()
    run(() => emit({ kind: 'started', turnId: 't1' }))
    run(() => emit({ kind: 'done', turnId: 't1', ok: false }))
    await view.settle()
    expect(ensureScriptRuntime).not.toHaveBeenCalled()
    view.unmount()
  })

  it("tells the creator when their own file blocks a module, in the Script card's words", async () => {
    ensureScriptRuntime.mockResolvedValue({ vendored: [], shadowed: ['src/scripts/runtime/game.ts'] })
    const view = await turn()
    expect(view.text()).toContain(shadowedRuntimeProblem('src/scripts/runtime/game.ts'))
    view.unmount()
  })

  it('still runs the assistant’s requests when vendoring throws', async () => {
    ensureScriptRuntime.mockRejectedValue(new Error('disk gone'))
    const view = await turn()
    expect(runEditorRequests).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
