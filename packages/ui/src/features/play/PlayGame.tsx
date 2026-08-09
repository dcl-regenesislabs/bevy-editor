import { useEffect, useMemo, useRef, useState } from 'react'
import { state } from '@scene/state'
import { cmd } from '../../engine/cmd'
import { log } from '../../log'
import { Chip } from '../../ds'
import { useStore } from '../../core/store'
import { consumerStore, ensureConsumersLoaded } from '../../prefabs/consumers'
import { sceneScriptRows } from '../editor/scene-check-model'
import { allProblemLines, relayedLines, type RelayedLine } from '../editor/log-roles'
import { usesGame } from '../../script/uses-game'
import { GAME_LOG_TAIL, GAME_POLL_MS, gameLife, gameStrip, parseGameLife, withProblems, type GameLife, type ServerPresence } from './game-life'
import { readServerPresence } from './server-presence'

const TICK_MS = 1000

export function PlayGame(props: { onLogs: () => void }): JSX.Element | null {
  const scripts = useStore(() => consumerStore.scripts)
  const snapshot = useStore(() => state.snapshot)
  const [reported, setReported] = useState<{ life: GameLife; at: number } | null>(null)
  const [server, setServer] = useState<ServerPresence>('unknown')
  const [now, setNow] = useState(() => Date.now())
  const [problems, setProblems] = useState(0)
  const startedAt = useRef(Date.now())
  const seenProblems = useRef(new Set<string>())
  const attached = useMemo(() => sceneScriptRows(snapshot).map((row) => row.path), [snapshot])
  const game = useMemo(() => usesGame(scripts, attached), [scripts, attached])
  useEffect(() => ensureConsumersLoaded(), [])
  useEffect(() => {
    if (!game) return
    startedAt.current = Date.now()
    setNow(Date.now())
    seenProblems.current = new Set()
    setProblems(0)
    let live = true
    let seen: GameLife | null = null
    setServer('unknown')
    readServerPresence()
      .then((presence) => {
        if (live) setServer(presence)
      })
      .catch((e) => log.debug('server presence probe failed', e))
    const shell = window.editorShell
    const poll = (): void => {
      Promise.all([
        cmd.sceneLogs(GAME_LOG_TAIL),
        shell === undefined
          ? Promise.resolve<RelayedLine[]>([])
          : shell.getState().then((s) => relayedLines(s.logs))
      ])
        .then(([text, relayed]) => {
          if (!live) return
          for (const row of allProblemLines(text, relayed)) seenProblems.current.add(row)
          setProblems(seenProblems.current.size)
          const next = parseGameLife(text)
          if (next === null || next === seen) return
          seen = next
          setReported({ life: next, at: Date.now() })
        })
        .catch((e) => log.debug('game-life poll failed', e))
    }
    poll()
    const polling = setInterval(poll, GAME_POLL_MS)
    const ticking = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => {
      live = false
      clearInterval(polling)
      clearInterval(ticking)
    }
  }, [game])
  if (!game) return null
  const life = gameLife(reported?.life ?? null, now - startedAt.current, server)
  const since = reported?.at ?? startedAt.current
  const strip = withProblems(gameStrip(life, (now - since) / 1000), problems)
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
