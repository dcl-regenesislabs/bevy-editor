// Origin-hash manifest IO over the data-layer. Written when a library prefab is
// copied into the project, read back by updatePrefabCopy to tell local edits
// from pristine master files.
import {
  dataLayerListFiles,
  dataLayerReadFile,
  dataLayerReadFileBytes,
  dataLayerSaveFile
} from '../engine/datalayer'
import { ORIGIN_HASHES_FILE, parseOriginHashes } from './versioning'

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// { relativePath: sha256hex } for every file under the folder. Dotfiles are
// skipped — the manifest itself must not hash itself, and the data-layer may not
// even list them.
export async function hashPrefabFolder(folder: string): Promise<Record<string, string>> {
  const prefix = `${folder}/`
  const files = (await dataLayerListFiles()).filter((p) => p.startsWith(prefix)).sort()
  const hashes: Record<string, string> = {}
  for (const path of files) {
    const rel = path.slice(prefix.length)
    if (rel.split('/').some((seg) => seg.startsWith('.'))) continue
    hashes[rel] = await sha256Hex(await dataLayerReadFileBytes(path))
  }
  return hashes
}

export async function writeOriginHashes(
  folder: string,
  hashes: Record<string, string>
): Promise<void> {
  await dataLayerSaveFile(`${folder}/${ORIGIN_HASHES_FILE}`, JSON.stringify(hashes, null, 2))
}

export async function readOriginHashes(folder: string): Promise<Record<string, string> | null> {
  try {
    return parseOriginHashes(await dataLayerReadFile(`${folder}/${ORIGIN_HASHES_FILE}`))
  } catch {
    return null
  }
}
