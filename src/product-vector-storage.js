import { sha256 } from './utils.js';
import { PersistenceError } from './errors.js';

const KIND = 'shiyi-vector-document';
export function vectorStorageArtifact(name) {
  if (!/^vectors-[a-zA-Z0-9_-]+$/.test(name)) return null;
  return name.endsWith('-jobs-v1') ? 'vector_jobs' : name.endsWith('-rebuild-v1') ? 'vector_staging' : 'vector_index';
}

// Keep floating-point values inside an opaque JSON string across the native
// JSON bridge. No quantization, approximate comparison or new storage backend.
// The existing workspace still performs an exact wire-document readback.
export function encodeVectorDocument(name, value) {
  if (!vectorStorageArtifact(name)) return value;
  const payload = JSON.stringify(value);
  return { kind: KIND, version: 1, payload, checksum: sha256(payload) };
}

export function decodeVectorDocument(name, value) {
  const storageArtifact = vectorStorageArtifact(name);
  // Existing plain numeric indexes and interrupted jobs remain readable.
  if (!storageArtifact || value?.kind !== KIND) return value;
  try {
    if (value.version !== 1 || typeof value.payload !== 'string' || value.checksum !== sha256(value.payload)) throw new Error();
    return JSON.parse(value.payload);
  } catch {
    throw new PersistenceError('向量存档完整性校验失败', { storageStage: 'decode', storageArtifact });
  }
}
