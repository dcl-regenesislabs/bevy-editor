import { useRef, useState, type ReactNode } from 'react'
import { Notice, ParcelMap, SearchField, Shelf } from '../../ds'
import { sceneTitle } from '../../lib/format'
import type { WorldEntry, WorldScene } from './inventory'
import { orderScenesByCoordinate, sceneKeyOf, sceneLabel, sceneListShort, sceneToneOf, sceneTotalOf } from './scene-label'

const AUTO_OPEN = 3
const SEARCH_ABOVE = 8

function matches(s: WorldScene, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (needle === '') return true
  return `${sceneTitle(s.title)} ${s.x},${s.y}`.toLowerCase().includes(needle)
}

export function SceneSections(props: {
  w: WorldEntry
  publishFirst: string
  render: (scene: WorldScene) => ReactNode
  order?: (scenes: WorldScene[]) => WorldScene[]
  count?: (scene: WorldScene) => number | undefined
}): JSX.Element {
  const { w } = props
  const scenes = (props.order ?? orderScenesByCoordinate)(w.scenes)
  const total = sceneTotalOf(w)
  const keys = scenes.map((s) => sceneKeyOf(w, s))
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const [opened, setOpened] = useState(() => new Set(keys.slice(0, AUTO_OPEN)))
  const [query, setQuery] = useState('')

  const live = new Set(keys)
  const open = new Set([...opened].filter((k) => live.has(k)))

  const toggle = (key: string): void => {
    setOpened((prev) => {
      const next = new Set([...prev].filter((k) => live.has(k)))
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const reveal = (key: string): void => {
    setQuery('')
    setOpened((prev) => new Set([...prev].filter((k) => live.has(k))).add(key))
    nodes.current.get(key)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const short = sceneListShort(w)
  const unreadable = short && (
    <Notice>Part of {w.name} couldn't be read, so this list may be missing scenes.</Notice>
  )

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

  const hits = scenes.filter((s) => matches(s, query)).length

  return (
    <>
      {unreadable}
      <div className="eui-wsec-index">
        <ParcelMap
          regions={scenes.map((s) => ({
            key: sceneKeyOf(w, s),
            parcels: s.parcels,
            base: `${s.x},${s.y}`,
            label: sceneLabel(s, total),
            tone: sceneToneOf(s)
          }))}
          cell={14}
          onSelect={reveal}
        />
      </div>
      {scenes.length > SEARCH_ABOVE && (
        <SearchField size="sm" placeholder="Find a scene" value={query} onChange={setQuery} />
      )}
      {hits === 0 && <p className="eui-world-hint">No scene here matches “{query}”.</p>}
      {scenes.map((s) => {
        const key = sceneKeyOf(w, s)
        return (
          <div
            key={key}
            className="eui-wsec"
            hidden={!matches(s, query)}
            ref={(el) => {
              if (el === null) nodes.current.delete(key)
              else nodes.current.set(key, el)
            }}
          >
            <Shelf
              title={sceneLabel(s, total)}
              count={props.count?.(s)}
              open={open.has(key)}
              onToggle={() => toggle(key)}
            >
              {open.has(key) && props.render(s)}
            </Shelf>
          </div>
        )
      })}
    </>
  )
}
