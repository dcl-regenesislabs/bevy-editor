import { useEffect, useRef, useState } from 'react'
import { Modal, Shelf, StateBlock, useLoad } from '../../ds'
import { hasValidIdentity, useAuth } from '../account/auth'
import { ensureWorlds, useWorlds } from '../worlds/worlds-store'
import { resetPublish, usePublish } from './publish-flow'
import { readLocalFootprint } from './publish-preflight'
import { GlobeIcon } from '../worlds/common'
import { PublishFooter } from './PublishFooter'
import { anyAction, publishView } from './publish-view'

export function PublishModal(props: {
  dir: string
  sceneTitle: string
  currentWorld: string | null
  onClose: () => void
  onManageWorld?: (name: string) => void
}): JSX.Element {
  const auth = useAuth()
  const { worlds, status, error: worldsError } = useWorlds()
  const job = usePublish()
  const [picked, setPicked] = useState<string | null>(props.currentWorld?.toLowerCase() ?? null)
  const logRef = useRef<HTMLPreElement | null>(null)
  const { data: local } = useLoad(() => readLocalFootprint(props.dir), [props.dir])
  useEffect(ensureWorlds, [auth.wallet])
  useEffect(() => {
    if (logRef.current !== null) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job.logs])

  useEffect(() => {
    if (status === 'ready' && picked !== null && !worlds.some((w) => w.name === picked)) setPicked(null)
  }, [status, worlds, picked])

  const attachLog = (el: HTMLPreElement | null): void => {
    logRef.current = el
    if (el !== null) el.scrollTop = el.scrollHeight
  }

  const close = (): void => {
    resetPublish()
    props.onClose()
  }

  const view = publishView({
    job,
    wallet: hasValidIdentity() ? auth.wallet : null,
    signIn: auth.signIn,
    worlds,
    worldsStatus: status,
    worldsError,
    dir: props.dir,
    sceneTitle: props.sceneTitle,
    picked,
    localBase: local?.base ?? null,
    attachLog,
    onPick: setPicked,
    onManageWorld: props.onManageWorld,
    close
  })

  return (
    <Modal
      title={<><GlobeIcon /> Publish to a world</>}
      className="eui-publish-modal"
      onClose={close}
      scrimClose={view.scrimClose}
      closeX
      closeTip={view.closeTip}
      footer={anyAction(view.actions) ? <PublishFooter actions={view.actions} /> : undefined}
    >
      <StateBlock tone={view.tone} icon={view.icon} headline={view.headline} note={view.note} align={view.align}>
        {view.evidence}
        {view.disclosure !== null && (
          <Shelf title={view.disclosure.title} count={view.disclosure.count} defaultOpen={false}>
            {view.disclosure.children}
          </Shelf>
        )}
      </StateBlock>
    </Modal>
  )
}
