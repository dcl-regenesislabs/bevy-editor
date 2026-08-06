// The scene's Game Config, reachable. The component lives on the scene root
// (entity 0), which the hierarchy deliberately never lists and no click can
// select — so without this modal there was no gesture anywhere in the editor
// that could create or edit one, and every kit prefab silently ran on its
// hard-coded defaults while the docs promised a tuning table.
//
// Edits go through the ordinary component funnel (uiSetComponentValue), so a
// config change is undoable and autosaved exactly like any other component.
import { componentKey, state } from '@scene/state'
import { Button, Modal, Notice } from '../ds'
import { useStore } from '../core/store'
import { uiSetComponentValue } from '../actions/components'
import { uiEnsureGameConfig } from '../actions/gameconfig'
import { GAME_CONFIG_COMPONENT } from '../gameconfig/normalize'
import { GameConfigView } from './views/game-config-view'

const ROOT = '0'

export function GameConfigModal(props: { onClose: () => void }): JSX.Element {
  const snapshot = useStore(() => state.snapshot)
  const value = snapshot[ROOT]?.[GAME_CONFIG_COMPONENT]
  const cKey = componentKey(ROOT, GAME_CONFIG_COMPONENT)
  return (
    <Modal
      title={<span className="eui-title">Game Config</span>}
      className="eui-gameconfig-modal"
      onClose={props.onClose}
      closeX
      closeTip="Close"
      footer={<Button onClick={props.onClose}>Done</Button>}
    >
      {value === undefined ? (
        <>
          <Notice>
            The numbers your game runs on — how many enemies a wave sends, how much damage a hit does — in one table
            instead of scattered through your scripts. Scripts read them through <code>gameConfig</code>, and the built-in
            game prefabs pick them up on their own.
          </Notice>
          <Button variant="primary" onClick={() => void uiEnsureGameConfig()}>
            Add a Game Config
          </Button>
        </>
      ) : (
        <GameConfigView
          cKey={cKey}
          entityId={ROOT}
          name={GAME_CONFIG_COMPONENT}
          value={value}
          schema={undefined}
          commit={() => undefined}
          apply={(json) => void uiSetComponentValue(cKey, ROOT, GAME_CONFIG_COMPONENT, json)}
        />
      )}
    </Modal>
  )
}
