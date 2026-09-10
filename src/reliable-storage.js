import {clone,sha256,stableStringify} from './utils.js';
import {PersistenceError} from './errors.js';

const stores=new WeakMap(),wrapped=new WeakSet();
const KIND='shiyi-lossless-json';
export function encodeStoredValue(value){
  let decimal=false;
  const payload=JSON.stringify(value,(_,v)=>{if(typeof v==='number'){if(!Number.isFinite(v))throw new PersistenceError('不能保存非有限数值',{storageStage:'write'});if(!Number.isInteger(v))decimal=true;}return v;});
  return decimal?{kind:KIND,version:1,payload,checksum:sha256(payload)}:clone(value);
}
export function decodeStoredValue(value){
  if(value?.kind!==KIND)return value;
  try{if(value.version!==1||typeof value.payload!=='string'||sha256(value.payload)!==value.checksum)throw Error();return JSON.parse(value.payload);}
  catch{throw new PersistenceError('存档完整性校验失败',{storageStage:'decode'});}
}
/** Stable adapter identity preserves existing scope locks. Existing plain JSON
 * remains readable. Only numbers at risk of cross-runtime rounding are wrapped. */
export function losslessStore(store){
  if(wrapped.has(store))return store;
  if(stores.has(store))return stores.get(store);
  const adapter={
    setJson:args=>store.setJson({...args,value:encodeStoredValue(args.value)}),
    ...(store.getJson?{getJson:async args=>decodeStoredValue(await store.getJson(args))}:{}),
    ...(store.tryGetJson?{tryGetJson:async args=>{const r=await store.tryGetJson(args);return r?.found?{...r,value:decodeStoredValue(r.value)}:r;}}:{}),
    ...(store.deleteJson?{deleteJson:args=>store.deleteJson(args)}:{}),
    ...(store.listKeys?{listKeys:args=>store.listKeys(args)}:{}),
  };
  stores.set(store,adapter);wrapped.add(adapter);return adapter;
}

export async function readStored(store,address){
  if(store.tryGetJson)return store.tryGetJson(address);
  const value=await store.getJson(address);return {found:value!==undefined,value};
}
/** A rejected write may already have reached storage. Read first, then report
 * the precise failure; never issue a second mutable write blindly. */
export async function verifiedWrite(store,address,value){
  const expected=stableStringify(value);let writeError;
  try{await store.setJson({...address,value});}catch(error){writeError=error;}
  let actual;
  try{actual=await readStored(store,address);}catch{
    throw new PersistenceError('写入后的读回未完成',{storageStage:writeError?'write':'readback'});
  }
  if(actual?.found&&stableStringify(actual.value)===expected)return clone(actual.value);
  throw new PersistenceError('保存尚未通过读回确认',{storageStage:writeError?'write':'compare'});
}
