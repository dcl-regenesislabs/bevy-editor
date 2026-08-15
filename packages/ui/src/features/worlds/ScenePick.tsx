import { useState, type ReactNode } from 'react'
import { CardPicker, Notice, SearchField } from '../../ds'
import { formatAgo, sceneTitle } from '../../lib/format'
import type { WorldEntry, WorldScene } from './inventory'
import { orderScenesByCoordinate, sceneKeyOf, sceneLabel, sceneListShort, sceneTotalOf } from './scene-label'

const SEARCH_ABOVE = 8

function matches(s: WorldScene, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (needle === '') return true
  return `${sceneTitle(s.title)} ${s.x},${s.y}`.toLowerCase().includes(needle)
}

export function ScenePick(props: {
  w: WorldEntry
  publishFirst: string
  picked: string[]
  onPick: (key: string) => void
  render: (scene: WorldScene) => ReactNode
  mode?: 'one' | 'many'
  order?: (scenes: WorldScene[]) => WorldScene[]
  note?: (scene: WorldScene) => string | null
  unavailable?: (scene: WorldScene) => string | null
}): JSX.Element {
  const { w } = props
  const [query, setQuery] = useState('')
  const scenes = (props.order ?? orderScenesByCoordinate)(w.scenes)
  const total = sceneTotalOf(w)
  const short = sceneListShort(w)
  const unreadable = short && <Notice>Part of {w.name} couldn't be read, so this list may be missing scenes.</Notice>

  if (scenes.length === 0) {
    return (
      <section className="eui-world-block">
        {short ? unreadable : <p className="eui-world-hint">{props.publishFirst}</p>}
      </section>
    )
  }

  if (scenes.length === 1 && total === 1) {
    return (
      <>
        {unreadable}
        {props.render(scenes[0])}
      </>
    )
  }

  const live = scenes.map((s) => sceneKeyOf(w, s))
  const kept = props.picked.filter((k) => live.includes(k))
  // Watching nothing is a real answer, so `many` never back-fills: unticking the
  // last card must leave zero. `one` always reads something, so it falls back to
  // the first scene when the held key names a scene that is gone.
  const selected = props.mode === 'many' ? kept : kept.length > 0 ? kept : [live[0]]
  const shown = scenes.filter((s) => matches(s, query))

  return (
    <>
      {unreadable}
      {scenes.length > SEARCH_ABOVE && (
        <SearchField size="sm" placeholder="Find a scene" value={query} onChange={setQuery} />
      )}
      <CardPicker
        ariaLabel="Pick a scene"
        mode={props.mode}
        selected={selected}
        onSelect={props.onPick}
        items={shown.map((s) => {
          const key = sceneKeyOf(w, s)
          return {
            key,
            label: sceneLabel(s, total),
            note: props.note?.(s) ?? null,
            image: s.thumbnail,
            tip: s.timestamp === null ? undefined : `Published ${formatAgo(s.timestamp)}`,
            disabledReason: props.unavailable?.(s) ?? null
          }
        })}
      />
      {shown.length === 0 && <p className="eui-world-hint">No scene here matches “{query}”.</p>}
      {scenes.filter((s) => selected.includes(sceneKeyOf(w, s))).map((s) => (
        <div key={sceneKeyOf(w, s)}>{props.render(s)}</div>
      ))}
    </>
  )
}
