// External files a glTF references by relative uri (images/buffers). GLBs
// usually embed everything, but exporters can keep textures/buffers external —
// those files must ship alongside the model or renderers 404 at load time.
// Separate module: assets.ts touches browser globals at import time, this must
// stay unit-testable.
export function gltfExternalUris(name: string, bytes: Uint8Array): string[] {
  let json: { images?: Array<{ uri?: string }>; buffers?: Array<{ uri?: string }> }
  try {
    if (/\.glb$/i.test(name)) {
      // GLB container: 12-byte header ("glTF", version, length), then chunks;
      // chunk 0 must be JSON
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      if (view.getUint32(0, true) !== 0x46546c67) return []
      const chunkLen = view.getUint32(12, true)
      if (view.getUint32(16, true) !== 0x4e4f534a) return []
      json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + chunkLen)))
    } else {
      json = JSON.parse(new TextDecoder().decode(bytes))
    }
  } catch {
    return [] // unparseable model — the engine will complain louder than us
  }
  const uris: string[] = []
  for (const item of [...(json.images ?? []), ...(json.buffers ?? [])]) {
    const uri = item?.uri
    // relative refs only: data: is embedded, scheme'd uris are remote,
    // and anything escaping the model's folder can't be satisfied here
    if (typeof uri !== 'string' || uri === '' || uri.startsWith('data:')) continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) continue
    // Windows exporters emit backslash uris; posix-normalize so the saved file
    // path matches the reference (and so `..\` can't dodge the traversal check)
    const clean = decodeURIComponent(uri).replace(/\\/g, '/').replace(/^\.\//, '')
    if (clean.split('/').includes('..')) continue
    uris.push(clean)
  }
  return uris
}
