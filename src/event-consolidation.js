import { clone, stableStringify } from './utils.js';
import { ValidationError } from './errors.js';

const unique=values=>[...new Map(values.map(v=>[stableStringify(v),clone(v)])).values()];
export function mergeEventDetails(previous,next){
  const merged={...clone(previous),...clone(next)};
  for(const key of ['sourceRefs','sourceFloors','participants','entities','tags','keyDialogues','viewpoints']){
    if(Array.isArray(previous[key])||Array.isArray(next[key]))merged[key]=unique([...(previous[key]??[]),...(next[key]??[])]);
  }
  merged.temporal={...(typeof previous.temporal==='object'?previous.temporal:{}),...Object.fromEntries(Object.entries(typeof next.temporal==='object'&&next.temporal?next.temporal:{}).filter(([,v])=>v!=null&&v!==''))};
  if(typeof next.temporal==='string'||typeof previous.temporal==='string')merged.temporal=next.temporal??previous.temporal;
  if(!next.location&&previous.location)merged.location=previous.location;
  // Retain complementary sentences without turning one event into many cards.
  // Explicit later corrections remain visible alongside the earlier occurrence.
  const before=String(previous.description??previous.content??''),after=String(next.description??next.content??'');
  const sentences=s=>s.match(/[^。！？\n]+[。！？]?/g)??[];
  if(before&&after&&!after.includes(before))merged.description=unique([...sentences(before),...sentences(after)]).join('');
  else merged.description=after||before;
  // A previous short view must not hide the newer outcome. The same-call model
  // must emit a revised brief; otherwise use the full materialized narrative.
  merged.recallSummary=next.recallSummary||null;
  return merged;
}

function occurrenceDate(e){const t=e.temporal;return typeof t==='string'?t:t?.occurredAt??t?.date;}
function linkCompatible(a,b){
  const x=occurrenceDate(a),y=occurrenceDate(b);
  return !(x&&y&&stableStringify(x)!==stableStringify(y));
}
export function exactEventDuplicate(a,b){
  if(!linkCompatible(a,b))return false;
  const body=e=>String(e.description??e.content??'').trim();
  return body(a)&&body(a)===body(b)&&['state','epistemicStatus','perspective','subject','object','location'].every(k=>stableStringify(a[k])===stableStringify(b[k]))&&(a.sourceRefs??[]).some(x=>(b.sourceRefs??[]).some(y=>stableStringify(x)===stableStringify(y)));
}

/** Resolve only explicit links to events actually shown in this request (or
 * earlier events in this output). Similar topic/tags alone never imply identity. */
export function resolveEventMerges(bundle,relevantRecords={}){
  const known=new Map((relevantRecords.events??[]).map(e=>[e.id,e])),aliases=new Map(),output=[];
  for(const [eventIndex,event] of (bundle.events??[]).entries()){
    let target=event.mergeInto;
    if(target){
      const prior=known.get(target);
      if(!prior||!linkCompatible(prior,event))throw new ValidationError('事件合并目标不存在或发生时间冲突',{validationIssueCount:1,validationIssues:[{path:`events[${eventIndex}].mergeInto`,reason:'invalid_event_merge'}]});
      const canonical=aliases.get(target)??target;
      aliases.set(event.id,canonical);event.id=canonical;
      // Do not accept a new model-generated identity in place of the checked link.
      delete event.identityKey;delete event.eventIdentity;
      if(prior.identityKey)event.identityKey=prior.identityKey;
      else if(prior.eventIdentity)event.eventIdentity=prior.eventIdentity;
      delete event.mergeInto;
    }
    const index=output.findIndex(e=>e.id===event.id||exactEventDuplicate(e,event));
    if(index>=0){aliases.set(event.id,output[index].id);output[index]=mergeEventDetails(output[index],event);}
    else output.push(event);
    known.set(event.id,event);
  }
  bundle.events=output;
  for(const category of Object.keys(bundle))if(Array.isArray(bundle[category]))for(const row of bundle[category]){
    for(const key of ['eventRef','eventId','sourceEventId','completionOf','correctionOf'])if(aliases.has(row[key]))row[key]=aliases.get(row[key]);
    for(const key of ['eventRefs','eventIds'])if(Array.isArray(row[key]))row[key]=[...new Set(row[key].map(id=>aliases.get(id)??id))];
  }
  return bundle;
}

export function bindCharacterDetails(record,evidence){
  const result={...record};
  if(record.keyDialogues!==undefined)result.keyDialogues=(Array.isArray(record.keyDialogues)?record.keyDialogues:[]).filter(q=>q&&typeof q.text==='string'&&q.text.length>0&&q.text.length<=2000&&typeof q.speaker==='string'&&q.speaker.length<=80&&evidence.includes(q.text)&&evidence.includes(q.speaker)).slice(0,8).map(q=>({speaker:q.speaker,text:q.text,...Object.fromEntries(['to','context','meaning'].filter(k=>typeof q[k]==='string'&&q[k].length<=2000).map(k=>[k,q[k]]))}));
  if(record.viewpoints!==undefined)result.viewpoints=(Array.isArray(record.viewpoints)?record.viewpoints:[]).filter(v=>v&&typeof v.holder==='string'&&evidence.includes(v.holder)&&typeof v.content==='string'&&v.content.length<=2000).slice(0,8).map(v=>({holder:v.holder,content:v.content,...Object.fromEntries(['target','context','basis'].filter(k=>typeof v[k]==='string'&&v[k].length<=2000).map(k=>[k,v[k]]))}));
  return result;
}
