import {clone,estimateModelInputUnits,sha256,yieldLocalWork} from './utils.js';
import {QUALITY_PROMPT,qualityGroups,qualityStatus,qualityReviewedIds} from './product-memory-quality.js';
import {summaryRecord,selectSummaryContext} from './summary-context.js';
import {MEMORY_CATEGORIES} from './product-batches.js';

export const qualityRows=records=>MEMORY_CATEGORIES.flatMap(category=>(records[category]??[]).map(r=>({...r,category})));
export function qualityTargets(records,saved={},recordIds=null){
  const status=qualityStatus(records,saved);
  const completed=new Set(Object.values(saved).flatMap(entry=>qualityReviewedIds(entry,records)));
  const current=new Map(qualityRows(records).map(({category,...r})=>[r.id,r]));
  const ids=new Set([...status.issues,...status.unresolved].flatMap(i=>i.recordIds??[]));
  for(const entry of Object.values(saved))if(entry.status==='failed')for(const [id,hash] of Object.entries(entry.anchors??{}))if(current.has(id)&&sha256(current.get(id))===hash)ids.add(id);
  return qualityRows(records).filter(r=>ids.has(r.id)&&!completed.has(r.id)&&!r.manualQualityChecked&&(!recordIds||recordIds.includes(r.id)));
}

/** Pure preflight: source loading is outside this loop, no model or storage
 * calls. A split replaces a pending candidate; only actual requests are counted. */
export async function planQuality({records,effectiveRecords=records,saved={},sources,settings,model,recordIds=null,check=()=>{},yieldTask=yieldLocalWork}){
  const status=qualityStatus(records,saved),targets=qualityTargets(records,saved,recordIds),rawById=new Map(targets.map(r=>[r.id,r]));
  // Read the accepted projection, but keep write guards tied to the original
  // records. A retry must not teach the model the superseded version again.
  const effectiveById=new Map(qualityRows(effectiveRecords).map(r=>[r.id,r]));
  const byId=new Map(targets.map(r=>[r.id,effectiveById.get(r.id)??r]));
  const pending=qualityGroups(records).map(ids=>ids.filter(id=>byId.has(id))).filter(ids=>ids.length);
  const sourceMap=new Map(sources.map(m=>[m.id,m])),jobs=[],blocked=[];
  const limit=settings.inputBudgetUnits;
  while(pending.length){
    check();await yieldTask();check();
    const ids=pending.shift(),rows=ids.map(id=>byId.get(id));
    const refs=new Set(rows.flatMap(r=>r.sourceRefs??[]).map(r=>r.sourceId));
    const evidence=[...refs].map(id=>sourceMap.get(id)).filter(Boolean);
    if(evidence.length!==refs.size){blocked.push({ids,reason:'来源缺失，请查看原文后人工校对'});continue;}
    const related=selectSummaryContext(effectiveRecords,evidence,{budgetUnits:4000,maxRecords:24});
    const input={sources:evidence.map(({id,index,text})=>({id,index,text})),records:rows.map(summaryRecord),referenceRecords:qualityRows(related.records).filter(r=>!byId.has(r.id)).map(summaryRecord),issues:[...status.issues,...status.unresolved].filter(i=>i.recordIds.some(id=>ids.includes(id)))};
    const payload=()=>({model,messages:[{role:'system',content:QUALITY_PROMPT},{role:'user',content:JSON.stringify(input)}],stream:false,...(settings.outputBudgetUnits>0?{max_tokens:settings.outputBudgetUnits}:{})});
    let wire=payload(),inputUnits=estimateModelInputUnits(wire);
    while(inputUnits>limit&&input.referenceRecords.length){input.referenceRecords.pop();wire=payload();inputUnits=estimateModelInputUnits(wire);}
    if(inputUnits>limit){
      if(ids.length>1){const middle=Math.ceil(ids.length/2);pending.unshift(ids.slice(0,middle),ids.slice(middle));}
      else blocked.push({ids,inputUnits,reason:`完整来源超过设置的输入预算 ${limit}；可人工校对或调整输入预算后重新预览`});
      continue;
    }
    jobs.push({ids,payload:wire,inputUnits,sourceIds:[...refs],anchors:Object.fromEntries(ids.map(id=>{const {category,...r}=rawById.get(id);return [id,sha256(r)];}))});
  }
  return {jobs,blocked,targetCount:targets.length,sourceCount:sources.length,inputLimit:limit};
}

// Retrying the same target set must not erase valid fields saved by a partial
// earlier answer merely because the new answer contains only remaining edits.
export function mergeQualityEntry(previous,next){
  if(!previous||Object.entries(previous.anchors??{}).some(([id,hash])=>Object.hasOwn(next.anchors??{},id)&&next.anchors[id]!==hash))return next;
  if(next.status==='failed')return previous.status==='reviewed'?{...clone(previous),retryError:next.error}:next;
  const updates=new Map((previous.updates??[]).map(u=>[u.id,clone(u)]));
  for(const u of next.updates??[]){const old=updates.get(u.id);updates.set(u.id,{...u,fields:{...old?.fields,...u.fields},evidence:[...(old?.evidence??[]),...(u.evidence??[])]});}
  return {...next,anchors:{...previous.anchors,...next.anchors},updates:[...updates.values()],additions:[...new Map([...(previous.additions??[]),...(next.additions??[])].map(a=>[a.record.id,a])).values()]};
}
