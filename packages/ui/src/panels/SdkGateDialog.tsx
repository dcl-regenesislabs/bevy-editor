import { Button, Modal, Spinner } from '../ds'
import { useStore } from '../core/store'
import { sdkGate, clearSdkGate, installSdkForGate } from '../prefabs/sdk-gate'
import { uiPlacePrefab } from '../actions/prefabs'

export function SdkGateDialog(): JSX.Element | null {
  const pending = useStore(() => sdkGate.pending)
  const installing = useStore(() => sdkGate.installing)
  const error = useStore(() => sdkGate.error)
  if (pending === null) return null

  if (pending.reason.kind === 'runtime') {
    return (
      <Modal
        title={`${pending.prefabName} needs a newer Decentraland Studio`}
        onClose={clearSdkGate}
        scrimClose
        footer={<Button onClick={clearSdkGate}>Close</Button>}
      >
        <p>{pending.reason.message}</p>
      </Modal>
    )
  }

  const install = async (): Promise<void> => {
    const folder = await installSdkForGate()
    if (folder !== null) await uiPlacePrefab(folder)
  }

  return (
    <Modal
      title={`${pending.prefabName} needs the server SDK`}
      onClose={installing ? undefined : clearSdkGate}
      scrimClose={!installing}
      footer={
        <>
          <Button onClick={clearSdkGate} disabled={installing}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void install()} disabled={installing}>
            {installing ? 'Installing…' : 'Install and place'}
          </Button>
        </>
      }
    >
      <p>
        This prefab runs part of its code on the Multiplayer Server, which this scene&apos;s SDK
        doesn&apos;t support yet.
      </p>
      <p>
        Installing runs <code>npm install @dcl/sdk@auth-server</code> here. It updates this
        scene&apos;s SDK and <code>package.json</code>, takes a minute or two, and only affects this
        project.
      </p>
      {installing && (
        <p className="eui-sdk-gate-busy">
          <Spinner size={14} /> Installing — the scene will rebuild when it finishes.
        </p>
      )}
      {error !== null && <p className="eui-sdk-gate-error">{error}</p>}
    </Modal>
  )
}
