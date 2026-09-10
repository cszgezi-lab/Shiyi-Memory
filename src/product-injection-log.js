import { clone, makeId } from './utils.js';
import { PRODUCT_VERSION } from './product-release.js';
import { recordTitle, sourceFloors } from './product-narrative.js';

export const INJECTION_LOG_LIMIT=30;
const STORAGE='injection-log-v1',MAX_CHARS=500000;
const statuses=new Set(['prepared','empty','disabled','stale','unavailable','failed','changed']);
const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0;
const str=(v,n)=>typeof v==='string'?v.slice(0,n):'';
const stage=v=>['passed','disabled','fallback','skipped'].includes(v)?v:'disabled';
const array=v=>Array.isArray(v)?v:[];
const reasons=new Set(['人物身份匹配','关键词匹配','标签匹配','分类检索','语义匹配','人物精确匹配','相关候选']);
const scores=v=>Object.fromEntries(['keyword','vector','fusion','final'].map(k=>[k,typeof v?.[k]==='number'&&Number.isFinite(v[k])?v[k]:null]));
function storedEntry(e){
  if(!statuses.has(e?.status)||typeof e.id!=='string')return null;
  const safe=injectionEntry({id:str(e.id,160),at:num(e.at),status:e.status,query:e.query,text:e.text,budgetUnits:e.budgetUnits,elapsedMs:e.elapsedMs,role:e.role,position:e.position,result:{usedUnits:e.usedUnits,degraded:e.degraded,cards:array(e.selected).filter(c=>c&&typeof c==='object'),trace:{timings:e.timings,vector:{status:e.vector},rerank:{status:e.rerank},local:{count:e.localCandidates},dictionary:{matched:array(e.dictionary).map(name=>({name}))},tags:{lanes:array(e.tags).map(tag=>({tag}))},packing:{duplicates:e.duplicates,decisions:array(e.decisions).filter(d=>d&&typeof d==='object')}}}});
  return {...safe,version:str(e.version,30),chars:num(e.chars),contentTruncated:Boolean(e.contentTruncated)||safe.contentTruncated};
}
export function injectionEntry(input={}){
  const result=input.result??{},trace=result.trace??{};
  return {id:input.id??makeId('injection'),at:input.at??Date.now(),version:PRODUCT_VERSION,status:statuses.has(input.status)?input.status:'failed',
    query:str(input.query,800),text:str(input.text,100000),contentTruncated:typeof input.text==='string'&&input.text.length>100000,
    chars:typeof input.text==='string'?input.text.length:0,usedUnits:num(result.usedUnits),budgetUnits:num(input.budgetUnits),elapsedMs:num(input.elapsedMs),
    role:['system','user'].includes(input.role)?input.role:null,position:['start','before_last'].includes(input.position)?input.position:null,
    sent:false,degraded:Boolean(result.degraded),selected:array(result.cards).slice(0,100).map(c=>({id:str(c.id,160),title:str(recordTitle(c),160),category:str(c.category,40),sourceFloors:sourceFloors({...c,sourceRefs:array(c.sourceRefs),sourceFloors:array(c.sourceFloors)}).slice(0,100)})),
    timings:Object.fromEntries(['localMs','vectorMs','rerankMs','recallMs'].map(k=>[k,num(trace.timings?.[k])])),
    vector:stage(trace.vector?.status),rerank:stage(trace.rerank?.status),localCandidates:num(trace.local?.count),duplicates:num(trace.packing?.duplicates),
    dictionary:(trace.dictionary?.matched??[]).slice(0,12).map(t=>str(t.name,80)),tags:(trace.tags?.lanes??[]).slice(0,12).map(t=>str(t.tag,40)),
    decisions:(trace.packing?.decisions??[]).slice(0,200).map(d=>({id:str(d.id,160),title:str(d.title,160),status:['selected','duplicate','budget','limit'].includes(d.status)?d.status:'limit',reason:String(d.reason??'').split('、').filter(r=>reasons.has(r)).join('、'),scores:scores(d.scores)})),
  };
}
export function createInjectionLog({workspace,onChange=()=>{}}){
  let entries=[],persistence='not_loaded',queue=Promise.resolve(),writable=false;
  const notify=()=>{try{onChange();}catch{}};
  function trim(){entries=entries.slice(-INJECTION_LOG_LIMIT);while(entries.length>1&&JSON.stringify(entries).length>MAX_CHARS)entries.shift();}
  function persist(){const frozen=clone(entries);queue=queue.catch(()=>{}).then(async()=>{if(!writable)return;try{await workspace.write(STORAGE,{version:1,entries:frozen});persistence='saved';}catch{persistence='failed';}notify();});return queue;}
  return {
    async load(){try{const doc=await workspace.read(STORAGE,{version:1,entries:[]});if(doc?.version!==1||!Array.isArray(doc.entries))throw new Error('invalid');entries=doc.entries.slice(-INJECTION_LOG_LIMIT).map(storedEntry).filter(Boolean);trim();writable=true;persistence='ready';}catch{persistence='unavailable';}notify();},
    append(input){const entry=injectionEntry(input);entries.push(entry);trim();notify();void persist();return entry;},
    get state(){return {entries:clone(entries),persistence,limit:INJECTION_LOG_LIMIT};},
    async remove(id){entries=entries.filter(e=>e.id!==id);notify();await persist();if(!writable||persistence!=='saved')throw new Error('注入日志删除未通过保存确认');},
    async clear(){entries=[];notify();await persist();if(!writable||persistence!=='saved')throw new Error('注入日志清空未通过保存确认');},
    async export({includeContent=false}={}){await queue;return {kind:'shiyi-injection-log',version:1,pluginVersion:PRODUCT_VERSION,persistence,containsStoryContent:includeContent,entries:entries.map(e=>includeContent?clone(e):{id:e.id,at:e.at,version:e.version,status:e.status,sent:false,chars:e.chars,usedUnits:e.usedUnits,budgetUnits:e.budgetUnits,elapsedMs:e.elapsedMs,degraded:e.degraded,timings:e.timings,vector:e.vector,rerank:e.rerank,localCandidates:e.localCandidates,selectedCount:e.selected.length,duplicates:e.duplicates,dictionaryCount:e.dictionary.length,tagCount:e.tags.length})};},
    async flush(){await queue;},
  };
}
