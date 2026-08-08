import { useEffect, useState } from 'react'
import { cmd } from '../../engine/cmd'
import { log } from '../../log'
import { Chip } from '../../ds'
import { gameStrip, parseGameLife, type GameLife } from './game-life'

const POLL_MS = 2000
const TAIL = 60

export function PlayGame(props: { onLogs: () => void }): JSX.Element | null {
  const [life, setLife] = useState<GameLife | null>(null)
  const [sinceMs, setSinceMs] = useState(0)
  const [nowMs, setNowMs] = useState(0)
  useEffect(() => {
    let live = true
    let seen: GameLife | null = null
    const poll = (): void => {
      cmd
        .sceneLogs(TAIL)
        .then((text) => {
          if (!live) return
          const next = parseGameLife(text)
          if (next === null) return
          setNowMs(Date.now())
          if (next === seen) return
          seen = next
          setSinceMs(Date.now())
          setLife(next)
        })
        .catch((e) => log.debug('game-life poll failed', e))
    }
    poll()
    const t = setInterval(poll, POLL_MS)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])
  // A scene that never reported has no game in it — no strip rather than an
  // empty one, the same rule the zone read-out follows.
  if (life === null) return null
  const strip = gameStrip(life, (nowMs - sinceMs) / 1000)
  return (
    <div className="eui-play-game">
      <Chip tone={strip.tone}>
        {strip.text}
        {strip.logs && (
          <button className="eui-play-game-logs" onClick={props.onLogs}>
            Logs
          </button>
        )}
      </Chip>
    </div>
  )
}
