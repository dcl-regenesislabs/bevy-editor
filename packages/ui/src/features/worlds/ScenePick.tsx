import { useState, type ReactNode } from 'react'
import { CardPicker, Notice, SearchField } from '../../ds'
import { formatAgo, sceneTitle } from '../../lib/format'
import type { WorldEntry, WorldScene } from './inventory'
import { orderScenesByCoordinate, sceneKeyOf, sceneLabel, sceneListShort, sceneTotalOf } from './scene-label'
import { pickedKeys } from './scene-panel'

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

  const cards = scenes.map((scene) => ({ key: sceneKeyOf(w, scene), scene }))
  const selected = pickedKeys(cards.map((c) => c.key), props.picked, props.mode ?? 'one')
  const shown = cards.filter((c) => matches(c.scene, query))

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
        items={shown.map(({ key, scene }) => ({
          key,
          label: sceneLabel(scene, total),
          note: props.note?.(scene) ?? null,
          image: scene.thumbnail,
          tip: scene.timestamp === null ? undefined : `Published ${formatAgo(scene.timestamp)}`,
          disabledReason: props.unavailable?.(scene) ?? null
        }))}
      />
      {shown.length === 0 && <p className="eui-world-hint">No scene here matches “{query}”.</p>}
      {cards
        .filter(({ key }) => selected.includes(key))
        .map(({ key, scene }) => (
          <div key={key}>{props.render(scene)}</div>
        ))}
    </>
  )
}
