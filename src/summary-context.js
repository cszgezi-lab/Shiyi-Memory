import { clone, estimateUnits, stableStringify } from './utils.js';
import { tokenizeChinese } from './retrieval.js';
import { sourceTimeline } from './source-consistency.js';

// Storage proofs stay in the repository. Model context needs exact identifiers,
// meaningful fields and source locators, not repeated hashes and old revisions.
export function summaryRecord(record) {
  const result = clone(record);
  // Keep knowledge scope, not repeated full source proof, in future summary
  // context. Original citations remain in storage and the quality UI.
  if(result.acquisitionEvidence?.method==='summary-source-parts-v1')result.acquisitionEvidence={access:result.acquisitionEvidence.access};
  for (const key of ['history','qualityEvidence','originalSource','timeCorrections','localSearchText','sourceFloors','hash','contentHash','bundleHash','operationId','scopeKey','committedRevision','expectedRevision','createdAt','updatedAt']) delete result[key];
  if (Array.isArray(result.sourceRefs)) result.sourceRefs = result.sourceRefs.map(ref => typeof ref === 'string' ? {sourceId:ref} : {sourceId:ref.sourceId, ...(ref.fragmentId ? {fragmentId:ref.fragmentId} : {})});
  return result;
}

export function summarySources(messages = []) {
  const timeline=sourceTimeline(messages.map(m=>({...m,sourceId:m.id})),messages.map(m=>({...m,sourceId:m.id})));
  return messages.map(({id,index,text,fragmentId,role,name,isUser}) => {
    const scene=timeline.find(s=>s.sourceId===id&&s.fragmentId===fragmentId);
    return {id,index,text,...(fragmentId ? {fragmentId} : {}),role,name,isUser,...(scene?{sceneTime:scene.stamp}:{})};
  });
}

export function selectSummaryContext(records, messages, {budgetUnits=6000, maxRecords=48, categories=null}={}) {
  const query = messages.map(m=>m.text??'').join('\n').toLocaleLowerCase();
  const tokens = [...new Set(tokenizeChinese(query).filter(t=>t.length>1))];
  const sourceIds = new Set(messages.map(m=>m.id));
  const selected = {}, candidates=[];
  for (const [category, rows] of Object.entries(records??{})) {
    if (!Array.isArray(rows) || ['history','summaryView','conflicts','coverage'].includes(category) || categories && !categories.includes(category)) continue;
    selected[category]=[];
    for (const original of rows) {
      const record=summaryRecord(original);
      const text=stableStringify(record).toLocaleLowerCase();
      const overlap=(record.sourceRefs??[]).some(r=>sourceIds.has(r.sourceId));
      const hits=tokens.reduce((sum,t)=>sum+(text.includes(t)?1:0),0);
      // Never fill a large user budget with unrelated old rows.
      if (!overlap && !hits) continue;
      candidates.push({category,record,score:(overlap?1000:0)+hits,units:estimateUnits(JSON.stringify(record))});
    }
  }
  candidates.sort((a,b)=>b.score-a.score || String(a.record.id).localeCompare(String(b.record.id)));
  let usedUnits=0,count=0;
  for (const item of candidates) {
    if (count>=maxRecords) break;
    if (usedUnits+item.units>budgetUnits) continue;
    selected[item.category].push(item.record);usedUnits+=item.units;count++;
  }
  return {records:selected,usedUnits,candidateCount:candidates.length,omittedCount:candidates.length-count};
}
