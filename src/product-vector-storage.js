import { sha256,sha256Async,yieldLocalWork } from './utils.js';
import { PersistenceError } from './errors.js';

const KIND = 'shiyi-vector-document';
export function sameVectorDocument(a,b){
  return a?.kind===KIND&&b?.kind===KIND&&Object.keys(a).length===4&&Object.keys(b).length===4&&['kind','version','payload','checksum'].every(key=>a[key]===b[key]);
}
export async function encodeVectorDocumentAsync(name,value){
  if(!vectorStorageArtifact(name))return value;
  // Index documents are maps of independent records. Serialize one record at
  // a time, preserving ordinary JSON bytes, including full-precision doubles.
  let payload;
  if(value&&typeof value==='object'&&!Array.isArray(value)&&!value.toJSON){
    const parts=[];let chars=0;
    for(const key of Object.keys(value)){
      const text=JSON.stringify(value[key]);if(text!==undefined){parts.push(`${JSON.stringify(key)}:${text}`);chars+=text.length;}
      if(chars>=262144){chars=0;await yieldLocalWork();}
    }
    payload=`{${parts.join(',')}}`;
  }else payload=JSON.stringify(value);
  await yieldLocalWork();
  return {kind:KIND,version:1,payload,checksum:await sha256Async(payload)};
}
export async function decodeVectorDocumentAsync(name,value){
  if(!vectorStorageArtifact(name)||value?.kind!==KIND)return value;
  if(value.version!==1||typeof value.payload!=='string'||value.checksum!==await sha256Async(value.payload))throw new PersistenceError('向量存档完整性校验失败',{storageStage:'decode',storageArtifact:vectorStorageArtifact(name)});
  await yieldLocalWork();
  try{return JSON.parse(value.payload);}catch{throw new PersistenceError('向量存档内容无效',{storageStage:'decode',storageArtifact:vectorStorageArtifact(name)});}
}
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
