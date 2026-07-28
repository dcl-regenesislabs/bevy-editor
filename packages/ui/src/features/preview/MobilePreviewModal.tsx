// Preview on your phone: a QR of the decentraland:// deep link into the
// LAN-reachable scene server. The phone joins the same live preview the editor
// shows — edits hot-reload there too, since it's the same server rebuilding on
// save. Everything is derived in main (mobile-preview IPC); this only renders.
import type { MobilePreview } from '@dcl-editor/contract'
import { CopyField, Modal, PanelState, useLoad } from '../../ds'
import css from './preview.css?inline'
import { registerCss } from '../../ds/styles/registry'

registerCss('features/preview', 'features', css)

const FAIL_HINT: Record<Extract<MobilePreview, { ok: false }>['reason'], string> = {
  'no-network': 'No local network found. Connect this computer to Wi-Fi and try again.',
  'no-scene': 'The scene server is still starting. Try again in a moment.'
}

export function MobilePreviewModal(props: { onClose: () => void }): JSX.Element {
  const { data, err, reload } = useLoad(async () => {
    const fn = window.editorShell?.mobilePreview
    if (fn === undefined) throw new Error('Mobile preview needs the desktop app')
    return fn()
  }, [])
  return (
    <Modal title="Preview on your phone" onClose={props.onClose} closeX>
      <div className="eui-preview-body">
        <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
        {data !== undefined && !data.ok && (
          <p className="eui-preview-hint">
            {FAIL_HINT[data.reason]} <button className="eui-link" onClick={reload}>Retry</button>
          </p>
        )}
        {data !== undefined && data.ok && (
          <>
            <img className="eui-preview-qr" src={data.qr} alt="QR code for the mobile preview link" />
            <p className="eui-preview-hint">
              Scan with your phone's camera to open this scene in the Decentraland mobile app. The
              phone must be on the same network — it joins the live preview, so your edits show up
              there as you make them.
            </p>
            <CopyField label="Link" value={data.deepLink} />
          </>
        )}
      </div>
    </Modal>
  )
}
