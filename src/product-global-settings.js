import { persistedProductSettings, validateProductPatch } from './product-settings.js';
import { API_SETTINGS_ADDRESS } from './product-api-settings.js';
import { clone, stableStringify } from './utils.js';
import {losslessStore,verifiedWrite} from './reliable-storage.js';

export const GLOBAL_SETTINGS_ADDRESS = Object.freeze({namespace:'shiyi-product-global',key:'settings-v1'});
/** Installation-wide configuration. Chat contents never enter this document. */
export function createGlobalSettings({getStore,onApply=()=>{}}) {
  let store,loading,loaded=false,saved={},queue=Promise.resolve();
  const value=()=>({...persistedProductSettings(),...clone(saved)});
  const read=async address=>store.tryGetJson ? store.tryGetJson(address) : store.getJson(address).then(value=>({found:value!=null,value}));
  async function load(){
    if(loaded)return value();
    if(loading)return loading;
    loading=(async()=>{
      store=losslessStore(await getStore());const found=await read(GLOBAL_SETTINGS_ADDRESS);
      if(found.found){if(found.value?.version!==1)throw new Error('全局设置版本无效，未覆盖原数据');saved=validateProductPatch(found.value.settings);}
      else {const old=await read(API_SETTINGS_ADDRESS);if(old.found)saved=validateProductPatch(old.value.settings);}
      loaded=true;onApply(value());return value();
    })().finally(()=>{loading=null;});return loading;
  }
  function save(patch,{adopt=false}={}){
    const valid=validateProductPatch(patch);
    const pending=queue.catch(()=>{}).then(async()=>{
      await load();const next=adopt?{...valid,...saved}:{...saved,...valid};
      const document={version:1,settings:next};
      try{await verifiedWrite(store,GLOBAL_SETTINGS_ADDRESS,document);
      const check=await read(GLOBAL_SETTINGS_ADDRESS);
      if(!check.found||stableStringify(check.value)!==stableStringify(document))throw new Error('readback mismatch');}catch{throw new Error('全局设置保存或读回校验失败，请重试；未报告保存成功');}
      saved=clone(next);onApply(value());return value();
    });queue=pending;return pending;
  }
  async function adoptLegacy(settings){
    await load();if((await read(GLOBAL_SETTINGS_ADDRESS)).found)return false;
    await save(settings??{},{adopt:true});return true;
  }
  return {load,save,adoptLegacy,get current(){return value();}};
}
