// Bespoke inspector view for the asset-packs::Script editor component (the
// Creator Hub Script component, minus the smart-items Actions/Triggers layer).
// A script entry = { path, priority, layout } where layout is a JSON string of
// { params, actions, error } parsed from the script's constructor signature.
// Scripts are authored in-app: files live in the project (src/scripts) and are
// read/written over the dev server's data-layer RPC; @dcl/sdk-commands picks
// them up from main.composite at build time and runs start()/update(dt).
import { useEffect, useRef, useState } from 'react'
import type { ComponentView, ComponentViewProps } from './types'
import { state } from '@scene/state'
import { entityName } from '@scene/custom-components'
import { useStore } from '../../core/store'
import {
  dataLayerAvailable,
  dataLayerReadFile,
  dataLayerRemoveFile,
  dataLayerSaveFile
} from '../../engine/datalayer'
import {
  freshLayout,
  mergeLayout,
  parseLayout,
  type ScriptLayout,
  type ScriptParam
} from '../../script/parser'
import {
  buildScriptPath,
  getScriptTemplateClass,
  getZoneReactionTemplate,
  isScriptFile
} from '../../script/template'
import { RunsOnLine } from './runs-on-line'
import { refreshConsumers } from '../../prefabs/consumers'
import { IconButton, LinkButton, MenuItem, TextInput, useOutsideClose } from '../../ds'
import {
  IconArrowDown,
  IconArrowUp,
  IconCode,
  IconDots,
  IconEdit,
  IconRefresh,
  IconTrash
} from '../../icons'
import { canAskAssistant, openStudio, prefillAssistant, refreshFileRail, setOnSaved } from '../ai-store'
import { TRIGGER_AREA } from '@scene/allowed-components'
import { ParamField } from './script-params'
import { visibleParams } from './param-visibility'
import { SPAWNER_WHEN_WORDS, SPAWNER_WHERE_WORDS, derivedWhenHint, type SpawnerWords } from './spawner-words'
import { enumLabelsFor } from './enum-words'
import { uiSyncSpawnSpot } from '../../actions/spawn-spot'
import { clearScriptFocus, scriptFocus } from '../script-card'
import { zoneListeners } from './zone-listeners'
import { ZoneReactions } from './zone-reactions'
import css from './script-empty.css?inline'
import { registerCss } from '../../ds/styles/registry'

registerCss('panels/script-empty', 'features', css)

type ScriptItem = { path: string; priority: number; layout?: string }

function itemsOf(value: unknown): ScriptItem[] {
  const v = value as { value?: ScriptItem[] } | null
  return Array.isArray(v?.value) ? v.value : []
}

// The detector ships with the zone prefab; anything else on the entity is the
// creator's reaction. Matched on the file name so a renamed copy still counts.
const DETECTOR_SUFFIX = '/trigger-zone.ts'

// Name a reaction after the zone it belongs to, not after the edge it happens to
// handle: "on-player-enters-2" says nothing about which zone and goes stale the
// moment the script also handles leaving.
function reactionStem(zoneName: string): string {
  const slug = zoneName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug === '' ? 'zone-reaction' : `${slug}-reaction`
}

export const ScriptView: ComponentView = (props: ComponentViewProps): JSX.Element => {
  const items = itemsOf(props.value)
  const [attaching, setAttaching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const online = dataLayerAvailable() === true
  const snapshot = useStore(() => state.snapshot)
  const zoneName = entityName(snapshot, props.entityId)?.trim() ?? ''
  // A zone answers "what happens when someone walks in" with its own block; the
  // generic create/attach pair would be a second, vaguer way to do the same thing.
  const isZone = snapshot[props.entityId]?.[TRIGGER_AREA] !== undefined && zoneName !== ''
  const detectorItem = isZone ? items.find((it) => it.path.endsWith(DETECTOR_SUFFIX)) : undefined
  const detectorPath = detectorItem?.path
  // The detector is machinery, not one of the creator's reactions.
  const reactions = items.filter((it) => it.path !== detectorPath)
  const empty = !isZone && !attaching && items.length === 0
  const createRef = useRef<HTMLButtonElement>(null)
  const focusNonce = useStore(() => (scriptFocus.entityId === props.entityId ? scriptFocus.nonce : 0))
  useEffect(() => {
    if (focusNonce === 0) return
    createRef.current?.focus()
    clearScriptFocus()
  }, [focusNonce])

  const applyItems = (next: ScriptItem[]): void => {
    props.apply(JSON.stringify({ value: next }))
  }

  const refreshSaved = (savedPath: string, content: string): void => {
    if (!items.some((it) => it.path === savedPath)) return
    // the runs-on line is derived from the file, so it follows the save
    void refreshConsumers()
    applyItems(
      items.map((it) =>
        it.path === savedPath
          ? {
              ...it,
              layout: JSON.stringify(
                mergeLayout(JSON.parse(freshLayout(content)) as ScriptLayout, parseLayout(it.layout) ?? { params: {} })
              )
            }
          : it
      )
    )
  }
  // Keep the assistant's param-refresh pointed at THIS (the selected) entity's
  // scripts, so a Studio edit refreshes here even when the Studio was opened from
  // a different entity. Stable wrapper → latest refreshSaved via a ref.
  const refreshRef = useRef(refreshSaved)
  refreshRef.current = refreshSaved
  useEffect(() => {
    const fn = (p: string, c: string): void => refreshRef.current(p, c)
    setOnSaved(fn)
    return () => setOnSaved(null)
  }, [])

  // Open the Script Studio (editor + AI) on a script, listing the entity's scripts as tabs.
  const openEditor = (path: string, filePaths: string[]): void => {
    openStudio(path, filePaths)
  }

  const addItem = (item: ScriptItem, openEditorAfter: boolean): void => {
    const next = [...items, item]
    applyItems(next)
    setAttaching(false)
    if (openEditorAfter) openEditor(item.path, next.map((it) => it.path))
  }

  // one click: scaffold a fresh auto-named script and open it in the editor
  const createNew = async (seed?: { name: string; body: (n: string) => string }): Promise<void> => {
    setCreating(true)
    setCreateErr(null)
    try {
      const name = await findAvailableName(items.map((it) => it.path), seed?.name)
      const path = buildScriptPath(name)
      const content = seed === undefined ? getScriptTemplateClass(name) : seed.body(name)
      await dataLayerSaveFile(path, content)
      refreshFileRail()
      addItem({ path, priority: 0, layout: freshLayout(content) }, true)
    } catch (e) {
      setCreateErr(String(e))
    } finally {
      setCreating(false)
    }
  }

  // Array order IS run order, so reordering renumbers priority rather than asking
  // the creator to reason about which number wins.
  const move = (path: string, delta: number): void => {
    const from = items.findIndex((it) => it.path === path)
    const to = from + delta
    if (from === -1 || to < 0 || to >= items.length) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    applyItems(next.map((it, i) => ({ ...it, priority: next.length - i })))
  }

  const entryProps = (item: ScriptItem): ScriptEntryProps => {
    const i = items.findIndex((it) => it.path === item.path)
    return {
      entityId: props.entityId,
      item,
      online,
      onChange: (next) => applyItems(items.map((it) => (it.path === item.path ? next : it))),
      onRemove: () => applyItems(items.filter((it) => it.path !== item.path)),
      onEditCode: () => openEditor(item.path, items.map((it) => it.path)),
      onMoveUp: i > 0 ? () => move(item.path, -1) : undefined,
      onMoveDown: i < items.length - 1 ? () => move(item.path, 1) : undefined
    }
  }

  return (
    <div className="eui-script-view">
      {!online && (
        <div className="eui-script-note">
          Project file access unavailable (no data-layer) — script files can’t be created or
          edited here.
        </div>
      )}
      {detectorItem !== undefined && (
        <ScriptEntry key={detectorItem.path} {...entryProps(detectorItem)} settingsTitle="Area settings" />
      )}
      {isZone && (
        <ZoneReactions
          zoneName={zoneName}
          listeners={zoneListeners(snapshot, props.entityId, zoneName, detectorPath)}
          localCount={reactions.length}
          busy={!online || creating}
          onAdd={() => void createNew({ name: reactionStem(zoneName), body: getZoneReactionTemplate })}
        >
          {reactions.map((item) => (
            <ScriptEntry key={item.path} {...entryProps(item)} />
          ))}
        </ZoneReactions>
      )}
      {!isZone && items.map((item) => <ScriptEntry key={item.path} {...entryProps(item)} />)}
      {empty && <p className="eui-script-empty">This entity does nothing yet — give it a script.</p>}
      {!isZone &&
        (attaching ? (
          <AddScriptForm
            existing={items.map((it) => it.path)}
            online={online}
            onCancel={() => setAttaching(false)}
            onAdd={addItem}
          />
        ) : (
          <div className={`eui-script-actions${empty ? ' empty' : ''}`}>
            <button
              ref={createRef}
              className="eui-btn eui-script-btn"
              disabled={!online || creating}
              onClick={() => void createNew()}
            >
              {creating ? 'Creating…' : 'New script'}
            </button>
            <LinkButton disabled={!online} onClick={() => setAttaching(true)}>
              Attach an existing script…
            </LinkButton>
            {empty && canAskAssistant() && (
              <LinkButton
                onClick={() =>
                  prefillAssistant(
                    `Make "${entityName(snapshot, props.entityId) ?? 'this entity'}" do something when a player clicks it`
                  )
                }
              >
                Ask the assistant
              </LinkButton>
            )}
          </div>
        ))}
      {createErr !== null && <div className="eui-script-err">{createErr}</div>}
    </div>
  )
}

type ScriptEntryProps = {
  entityId: string
  item: ScriptItem
  onChange: (item: ScriptItem) => void
  onRemove: () => void
  onEditCode: () => void
  online: boolean
  /** Reorder within the entity's scripts — absent at the ends, and for a lone script. */
  onMoveUp?: () => void
  onMoveDown?: () => void
  /**
   * Present = render as a plain settings group under this title instead of as a
   * file: no name, no code button, no menu. A prefab's own script (a zone's
   * detector) is machinery the creator configures but should never have to think
   * of as one of their files.
   */
  settingsTitle?: string
}

function ScriptEntry(props: ScriptEntryProps): JSX.Element {
  const { entityId, item, onChange, onRemove, onEditCode, online, onMoveUp, onMoveDown, settingsTitle } = props
  const settingsOnly = settingsTitle !== undefined
  const layout = parseLayout(item.layout)
  const params = visibleParams(layout?.params ?? {})
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // rename = copy to the new path, drop the old file, repoint the component
  const rename = async (newName: string): Promise<void> => {
    const trimmed = newName.trim()
    const newPath = buildScriptPath(trimmed)
    if (trimmed === '' || newPath === item.path) {
      setRenaming(false)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const content = await dataLayerReadFile(item.path)
      await dataLayerSaveFile(newPath, content)
      void dataLayerRemoveFile(item.path).catch(() => {}) // best-effort cleanup
      refreshFileRail()
      onChange({ ...item, path: newPath })
      setRenaming(false)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      const content = await dataLayerReadFile(item.path)
      const merged = mergeLayout(
        JSON.parse(freshLayout(content)) as ScriptLayout,
        layout ?? { params: {} }
      )
      onChange({ ...item, layout: JSON.stringify(merged) })
    } catch (e) {
      setErr(`could not read ${item.path}: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const setParam = (name: string, value: ScriptParam['value']): void => {
    if (layout === undefined) return
    const next: ScriptLayout = {
      ...layout,
      params: { ...layout.params, [name]: { ...layout.params[name], value } }
    }
    onChange({ ...item, layout: JSON.stringify(next) })
    void uiSyncSpawnSpot(entityId, item.path, [name], next.params, { aim: true })
  }

  return (
    <div className={`eui-script-entry${settingsOnly ? ' settings-only' : ''}`}>
      {settingsOnly ? (
        <div className="eui-script-head">
          <span className="eui-group-label">{settingsTitle}</span>
        </div>
      ) : (
        <div className="eui-script-head">
          {renaming ? (
            <TextInput
              autoFocus
              defaultValue={(item.path.split('/').pop() ?? '').replace(/\.tsx?$/, '')}
              onBlur={(e) => void rename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setRenaming(false)
              }}
            />
          ) : (
            // The name is the way in. A lone </> glyph is too small a target for
            // the primary action on this row, and every file list in the app opens
            // on its title.
            <button className="path" data-tip={`Open ${item.path}`} disabled={!online} onClick={onEditCode}>
              {item.path.split('/').pop()}
            </button>
          )}
          <span className="spacer" />
          <IconButton
            tip="Open the editor and the assistant"
            className="eui-script-studio-btn"
            style={ICON}
            disabled={!online}
            onClick={onEditCode}
          >
            <IconCode />
          </IconButton>
          <ScriptMenu
            online={online}
            busy={busy}
            onRename={() => setRenaming(true)}
            onRefresh={() => void refresh()}
            onRemove={onRemove}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
          />
        </div>
      )}
      {!settingsOnly && <RunsOnLine path={item.path} />}
      {layout?.error !== undefined && layout.error !== '' && (
        <div className="eui-script-err">parse error: {layout.error}</div>
      )}
      {err !== null && <div className="eui-script-err">{err}</div>}
      {params.map(([name, param]) => (
        <ParamField
          key={name}
          name={name}
          param={param}
          enumLabels={wordsFor(param, 'label')}
          enumHints={wordsFor(param, 'hint')}
          onChange={(v) => setParam(name, v)}
        />
      ))}
      {asksScript(params) && canAskAssistant() && (
        <button
          className="eui-ask-ai"
          onClick={() =>
            prefillAssistant(
              `Write a new script that makes "${entityName(state.snapshot, state.activeEntity ?? '') ?? 'this spawner'}" spawn when `
            )
          }
        >
          Say when it should spawn — the assistant writes a new script
        </button>
      )}
      {params.length === 0 && !settingsOnly && (
        // A freshly scaffolded reaction has no params BY DESIGN, so "no settings
        // yet" is the wrong thing to say — it reads as "nothing happened" and sends
        // the creator back to the add button. What they want is the code.
        <button className="eui-script-open" disabled={!online} onClick={onEditCode}>
          Open the code to say what happens
        </button>
      )}
    </div>
  )
}

const ICON = { width: 20, height: 20 } as const

function wordsFor(param: ScriptParam, kind: 'label' | 'hint'): Readonly<Record<string, string>> | undefined {
  if (param.type !== 'enum') return undefined
  const options = param.options ?? []
  if (options.length === 0) return undefined
  const entityId = state.activeEntity
  // The "when" hints are derived from where the spawner sits, so they need the row.
  if (kind === 'hint' && entityId !== null && covers(options, SPAWNER_WHEN_WORDS)) {
    return Object.fromEntries(options.map((o) => [o, derivedWhenHint(o, state.snapshot, entityId)]))
  }
  const words = [SPAWNER_WHEN_WORDS, SPAWNER_WHERE_WORDS].find((map) => covers(options, map))
  if (words !== undefined) return Object.fromEntries(options.map((o) => [o, words[o][kind]]))
  // The kit's other enums carry a label and nothing else — a hint per option
  // would be a second sentence saying what the label already says.
  return kind === 'hint' ? undefined : enumLabelsFor(options)
}

// Only a dropdown whose options are ENTIRELY one map's gets that map's words —
// another script's enum that happens to share a value keeps its stored strings.
function covers(options: string[], words: Record<string, SpawnerWords>): boolean {
  return options.every((option) => words[option] !== undefined)
}

function asksScript(params: Array<[string, { value?: unknown }]>): boolean {
  return params.some(([name, param]) => name === 'when' && param.value === 'when a script asks')
}

// Rename / re-read / remove are maintenance: needed once, then never again. Four
// equal icons in the header made them compete with the params, which are what a
// creator actually comes here to change. One primary action stays out; the rest
// live behind the overflow, the same shape the toolbar's menu already uses.
//
// Run order lives here too, as Run earlier / Run later rather than a priority
// field: two scripts both showing "0" told the creator nothing and read as a param.
function ScriptMenu(props: {
  online: boolean
  busy: boolean
  onRename: () => void
  onRefresh: () => void
  onRemove: () => void
  /** Reorder within the entity's scripts. Absent when there's only one. */
  onMoveUp?: () => void
  onMoveDown?: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutsideClose(open, ref, () => setOpen(false))
  const act = (fn: () => void): (() => void) => () => {
    fn()
    setOpen(false)
  }
  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex' }}>
      <IconButton tip="More" style={ICON} active={open} onClick={() => setOpen(!open)}>
        <IconDots />
      </IconButton>
      {open && (
        <div className="eui-menu eui-script-menu">
          <MenuItem icon={<IconEdit />} onClick={act(props.onRename)}>
            Rename script
          </MenuItem>
          <MenuItem icon={<IconRefresh />} onClick={act(props.onRefresh)}>
            Reload params
          </MenuItem>
          {props.onMoveUp !== undefined && (
            <MenuItem icon={<IconArrowUp />} onClick={act(props.onMoveUp)}>
              Run earlier
            </MenuItem>
          )}
          {props.onMoveDown !== undefined && (
            <MenuItem icon={<IconArrowDown />} onClick={act(props.onMoveDown)}>
              Run later
            </MenuItem>
          )}
          <div className="eui-menu-sep" />
          <MenuItem danger icon={<IconTrash />} onClick={act(props.onRemove)}>
            Remove script
          </MenuItem>
        </div>
      )}
    </div>
  )
}


// First free "<stem>[-N]" name: not attached to this entity and not already a file
// in the project (probed over the data-layer so one click never silently attaches
// an unrelated existing script).
async function findAvailableName(existing: string[], stem = 'my-script'): Promise<string> {
  for (let i = 1; i <= 20; i++) {
    const name = i === 1 ? stem : `${stem}-${i}`
    if (existing.includes(buildScriptPath(name))) continue
    try {
      await dataLayerReadFile(buildScriptPath(name))
    } catch {
      return name
    }
  }
  return `${stem}-${Date.now()}`
}

function AddScriptForm(props: {
  existing: string[]
  online: boolean
  onCancel: () => void
  onAdd: (item: ScriptItem, openEditor: boolean) => void
}): JSX.Element {
  const { existing, online, onCancel, onAdd } = props
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (trimmed === '') return
    const path = buildScriptPath(trimmed)
    if (!isScriptFile(path)) {
      setErr('script files must end in .ts or .tsx')
      return
    }
    if (existing.includes(path)) {
      setErr('that script is already on this entity')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      let content: string
      let created = false
      try {
        content = await dataLayerReadFile(path) // attach if the file already exists
      } catch {
        content = getScriptTemplateClass(trimmed)
        await dataLayerSaveFile(path, content)
        refreshFileRail()
        created = true
      }
      onAdd({ path, priority: 0, layout: freshLayout(content) }, created)
    } catch (e) {
      setErr(String(e))
      setBusy(false)
    }
  }

  return (
    <div className="eui-script-add">
      <TextInput
        autoFocus
        placeholder="script name (e.g. rotator) or path"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') onCancel()
        }}
      />
      <div className="eui-script-add-hint">
        Attaches <code>{name.trim() !== '' ? buildScriptPath(name.trim()) : 'assets/scene/Scripts/…'}</code>{' '}
        if it exists, or creates it from the template.
      </div>
      {err !== null && <div className="eui-script-err">{err}</div>}
      <div className="eui-script-actions" style={{ justifyContent: 'flex-end' }}>
        <button className="eui-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="eui-btn primary"
          disabled={!online || busy || name.trim() === ''}
          onClick={() => void submit()}
        >
          {busy ? 'Adding…' : 'Add script'}
        </button>
      </div>
    </div>
  )
}
