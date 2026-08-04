import { cmd } from '../cmd'
import { buildComposite, unknownComponentNames } from '../composite'
import { decodeCustomComponents, isCustomComponent, stringToBase64 } from '../custom-components'
import { type DiffRow, type DiffSource, buildAuthoredFromSelection, computeSaveDiff, defaultSelection } from '../save-diff'
import { getSchema, loadSchema, toSdkValue } from '../schema'
import { type Snapshot, resetSaveChangelog, state } from '../state'
import { loadComponentNames } from './writes'

// A local scene (served by `dcl start`) has a `b64-`-prefixed hash that decodes to its project path,
// so we can write its files back. A deployed/remote scene has a content hash — nowhere to save to.
export function isLocalScene(): boolean {
  return state.scene?.hash?.startsWith('b64-') ?? false
}

// One-click save: persist the editor's current state without a review dialog.
// Editor-written values win; runtime churn the editor never touched reverts to
// the baseline (defaultSelection), which is what "save my work" means.
export async function saveCompositeDirect(): Promise<void> {
  if (!isLocalScene()) {
    state.saveStatus = 'save needs a local scene (served by `dcl start`)'
    return
  }
  state.saveStatus = 'saving…'
  try {
    if (state.componentNames.length === 0) await loadComponentNames()
    let initial: Snapshot
    if (state.savedBaseline !== null) {
      initial = state.savedBaseline
    } else {
      initial = await cmd.crdtInitial()
      decodeCustomComponents(initial)
    }
    const rows = computeSaveDiff(initial, state.snapshot)
    const selection = new Map<string, DiffSource>()
    for (const row of rows) {
      selection.set(`${row.entityId}/${row.component}`, defaultSelection(row))
    }
    await writeComposite(initial, rows, selection)
  } catch (e) {
    state.saveStatus = `save failed: ${String(e)}`
    throw e
  }
}

// Build the composite from the baseline + the dialog's selections, convert protocol values to SDK
// form, and ship it to /save_composite (the engine owns the destination). Resets the changelog on
// success — the saved state becomes the new baseline.
// Writes the composite string somewhere durable and returns a human-readable
// destination. The default writes through the engine (`/save_composite`, which
// also exports imported-asset files); the host page can inject a writer that
// ships it to the dev server's data-layer instead (auto-save).
export type CompositeWriter = (composite: string) => Promise<string>

const engineCompositeWriter: CompositeWriter = async (composite) =>
  await cmd.saveComposite(stringToBase64(composite))

let compositeWriter: CompositeWriter = engineCompositeWriter
export function setCompositeWriter(writer: CompositeWriter | null): void {
  compositeWriter = writer ?? engineCompositeWriter
}

async function writeComposite(
  initial: Snapshot,
  rows: DiffRow[],
  selection: Map<string, DiffSource>
): Promise<void> {
  state.saveStatus = 'saving…'
  try {
    const authored = buildAuthoredFromSelection(initial, rows, selection)
    // Cache the persisted authored set (snapshot form, before the SDK conversion below mutates it)
    // as the next baseline, so a follow-up save diffs against what we just wrote.
    const newBaseline = JSON.parse(JSON.stringify(authored)) as Snapshot

    // Protocol components are in engine form (a protobuf oneof as `{case: val}` with no `$case`),
    // which the composite loader drops. Convert them to SDK form via each component's schema;
    // custom components are already SDK form (decoded via the SDK schema).
    const protoNames = new Set<string>()
    for (const comps of Object.values(authored)) {
      for (const name of Object.keys(comps)) {
        if (!isCustomComponent(name)) protoNames.add(name)
      }
    }
    await Promise.all([...protoNames].map(loadSchema))
    for (const comps of Object.values(authored)) {
      for (const name of Object.keys(comps)) {
        if (isCustomComponent(name)) continue
        const schema = getSchema(name)
        if (schema !== undefined) comps[name] = toSdkValue(comps[name], schema.root)
      }
    }

    const composite = buildComposite(authored)
    const skipped = unknownComponentNames(authored)
    const path = await compositeWriter(composite)
    // Full (untruncated) save result, incl. the imported-asset export summary, to the browser console.
    console.log(`[save] ${path}`)
    state.savedBaseline = newBaseline
    resetSaveChangelog()
    state.saveStatus =
      skipped.length > 0 ? `saved → ${path} (skipped: ${skipped.join(', ')})` : `saved → ${path}`
  } catch (e) {
    state.saveStatus = `save failed: ${String(e)}`
    throw e
  }
}

// --- gizmo drag commits ---
