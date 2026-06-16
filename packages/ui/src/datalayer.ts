// Minimal client for the sdk-commands dev server's data-layer (the same RPC the
// official inspector uses), speaking just the one method we need: saveFile.
// The server side: `sdk-commands start --data-layer` exposes a protobuf RPC
// over ws://<realm-host>/data-layer; saveFile(path, bytes) writes relative to
// the scene project root. The request message is hand-encoded (two fields)
// against @dcl/rpc's ts-proto codegen interface, so we don't have to drag the
// whole @dcl/inspector bundle into the page.
import { createRpcClient } from '@dcl/rpc'
import { WebSocketTransport } from '@dcl/rpc/dist/transports/WebSocket'
import { loadService } from '@dcl/rpc/dist/codegen'
import { Writer, Reader } from 'protobufjs/minimal'

type SaveFileRequest = { path: string; content: Uint8Array }

const SaveFileRequestType = {
  encode(message: SaveFileRequest, writer: Writer = Writer.create()): Writer {
    if (message.path !== '') writer.uint32(10).string(message.path) // field 1, len-delimited
    if (message.content.length > 0) writer.uint32(18).bytes(message.content) // field 2
    return writer
  },
  decode(_input: Reader | Uint8Array): SaveFileRequest {
    return { path: '', content: new Uint8Array() }
  },
  fromJSON(object: unknown): SaveFileRequest {
    return object as SaveFileRequest
  }
}

const EmptyType = {
  encode(_message: Record<string, never>, writer: Writer = Writer.create()): Writer {
    return writer
  },
  decode(_input: Reader | Uint8Array): Record<string, never> {
    return {}
  },
  fromJSON(_object: unknown): Record<string, never> {
    return {}
  }
}

// must match the server's DataServiceDefinition registration ("DataService")
const DataServiceLite = {
  name: 'DataService',
  fullName: 'DataService',
  methods: {
    saveFile: {
      name: 'saveFile',
      requestType: SaveFileRequestType,
      requestStream: false,
      responseType: EmptyType,
      responseStream: false,
      options: {}
    }
  }
} as const

type DataLayerClient = { saveFile: (req: SaveFileRequest) => Promise<unknown> }

let clientPromise: Promise<DataLayerClient> | null = null
let availableFlag: boolean | null = null // null = not probed yet

// In-world the page URL carries ?realm; in the electron host it does NOT (the
// host is editor-app.html?project=…, the realm arrives via servers-ready), so
// the embedded shell sets it explicitly. Falls back to the page URL.
let realmOverride: string | null = null
export function setDataLayerRealm(realm: string): void {
  realmOverride = realm
  availableFlag = null // re-probe against the new realm
  clientPromise = null
}
export function dataLayerRealm(): string | null {
  return realmOverride ?? new URLSearchParams(window.location.search).get('realm')
}

function realmDataLayerUrl(): string | null {
  const realm = dataLayerRealm()
  if (realm === null || realm === '') return null
  try {
    const u = new URL(realm)
    const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProto}//${u.host}/data-layer`
  } catch {
    return null
  }
}

async function connect(): Promise<DataLayerClient> {
  const url = realmDataLayerUrl()
  if (url === null) throw new Error('no realm in page url')
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error(`data-layer unreachable at ${url}`)), {
      once: true
    })
  })
  ws.addEventListener('close', () => {
    clientPromise = null // reconnect lazily on next use
  })
  const transport = WebSocketTransport(ws as unknown as Parameters<typeof WebSocketTransport>[0])
  const rpcClient = await createRpcClient(transport)
  const port = await rpcClient.createPort('editor-ui')
  return loadService(port, DataServiceLite) as unknown as DataLayerClient
}

function getClient(): Promise<DataLayerClient> {
  if (clientPromise === null) clientPromise = connect()
  return clientPromise
}

// Probe once at boot so the UI can show whether auto-save is possible.
export async function probeDataLayer(): Promise<boolean> {
  try {
    await getClient()
    availableFlag = true
  } catch {
    availableFlag = false
    clientPromise = null
  }
  return availableFlag
}

export function dataLayerAvailable(): boolean | null {
  return availableFlag
}

export async function dataLayerSaveFile(path: string, content: string): Promise<void> {
  await dataLayerSaveFileBytes(path, new TextEncoder().encode(content))
}

export async function dataLayerSaveFileBytes(path: string, content: Uint8Array): Promise<void> {
  const client = await getClient()
  try {
    await client.saveFile({ path, content })
    availableFlag = true
  } catch (e) {
    clientPromise = null
    availableFlag = false
    throw e
  }
}
