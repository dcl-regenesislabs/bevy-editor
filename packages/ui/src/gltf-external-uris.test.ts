import { describe, it, expect } from 'vitest'
import { gltfExternalUris } from './gltf-refs'

// A model can reference textures/buffers by relative uri instead of embedding
// them. Whatever it references must ship with it — see uploadModel.

const gltfJson = {
  images: [
    { uri: 'Balloon1Baked3.png' }, // external, case matters
    { uri: 'data:image/png;base64,AAAA' }, // embedded
    { uri: 'https://cdn.example/tex.png' }, // remote
    { uri: './textures/wood%20floor.png' }, // relative with ./ and escapes
    { uri: '../outside.png' } // escapes the model folder — unsatisfiable
  ],
  buffers: [{ uri: 'model.bin' }, {}]
}

function glbFrom(json: unknown): Uint8Array {
  const enc = new TextEncoder().encode(JSON.stringify(json))
  const padded = new Uint8Array(Math.ceil(enc.length / 4) * 4).fill(0x20)
  padded.set(enc)
  const out = new Uint8Array(20 + padded.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true) // "glTF"
  view.setUint32(4, 2, true)
  view.setUint32(8, out.length, true)
  view.setUint32(12, padded.length, true)
  view.setUint32(16, 0x4e4f534a, true) // "JSON"
  out.set(padded, 20)
  return out
}

const external = ['Balloon1Baked3.png', 'textures/wood floor.png', 'model.bin']

describe('gltfExternalUris', () => {
  it('extracts only satisfiable relative refs from a .glb', () => {
    expect(gltfExternalUris('balloon.glb', glbFrom(gltfJson))).toEqual(external)
  })

  it('reads a .gltf as plain JSON', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(gltfJson))
    expect(gltfExternalUris('balloon.gltf', bytes)).toEqual(external)
  })

  it('returns nothing for an unparseable or non-glTF file', () => {
    expect(gltfExternalUris('x.glb', new TextEncoder().encode('not a glb'))).toEqual([])
    expect(gltfExternalUris('x.gltf', new TextEncoder().encode('not json'))).toEqual([])
  })

  it('returns nothing when everything is embedded', () => {
    expect(
      gltfExternalUris('x.glb', glbFrom({ images: [{ uri: 'data:image/png;base64,AA' }] }))
    ).toEqual([])
  })
})
