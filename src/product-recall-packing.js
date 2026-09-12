import { stableStringify } from './utils.js';
import { sameFactForRecall } from './product-person-profiles.js';
import { tokenizeChinese } from './retrieval.js';
import { dictionaryQuery } from './product-dictionary.js';

const normalized = value => String(value ?? '').toLocaleLowerCase().replace(/\s+/gu, '').replace(/[。！？]+$/u,'');
const refs = record => [...new Set([record.eventRef, record.eventId, ...(record.eventRefs ?? []), ...(record.relatedEvents ?? []).map(e => e.id)].filter(Boolean))];
const sentences = value => String(value ?? '').match(/[^。！？\n]+[。！？]?/g) ?? [];

export function sceneRecallQuery(messages=[]) {
  const text=m=>typeof m?.content==='string'?m.content:Array.isArray(m?.content)?m.content.filter(p=>p?.type==='text').map(p=>p.text??'').join('\n'):'';
  const rows=messages.filter(m=>['user','assistant'].includes(m?.role)),latest=rows.filter(m=>m.role==='user').at(-1);
  const intent=text(latest),prior=rows.filter(m=>m.role==='assistant').at(-1);
  const narrative=text(prior).replace(/<(think|thinking)\b[^>]*>[\s\S]*?<\/\1>/gi,'').trim();
  const context=narrative.length>1600?`${narrative.slice(0,400)}\n${narrative.slice(-1200)}`:narrative;
  // Previous assistant prose supplies search context for pronouns/"continue";
  // never read system prompts/worldbooks as if they were the current scene.
  // Keep the full recent narrative for local roster matching. Only the search
  // query sent to optional retrieval services uses the compact context above.
  return {intent,context,characterContext:narrative};
}

// Only verified event links or identical evidence qualify. Similar wording,
// shared names, categories and dates alone never establish event identity.
export function sameRecallEvent(a, b) {
  if (a.category === 'knowledge' || b.category === 'knowledge') return false;
  const left = a.category === 'events' ? [a.id] : refs(a);
  const right = b.category === 'events' ? [b.id] : refs(b);
  if (left.length === 1 && right.length === 1 && left[0] === right[0]) return true;
  return a.category === b.category && a.sourceRefs?.length > 0 &&
    normalized(a.description) === normalized(b.description) &&
    stableStringify(a.sourceRefs) === stableStringify(b.sourceRefs);
}

export function recallGuardSignature(record) {
  // Ignoring display IDs here is safe, ignoring facts/knowledge/time is not.
  const rows = value => (value ?? []).map(({ id, sourceRefs, ...rest }) => rest);
  return stableStringify({ temporal: record.temporal??null, participants: record.participants??[], location: record.location??null,
    awareness: rows(record.awareness), state: record.state??null, epistemicStatus: record.epistemicStatus??null,validFrom:record.validFrom??null,
    followUps: rows(record.followUps), context: record.context??null, validUntil: record.validUntil??null,
    expiresAt:record.expiresAt??null,term:record.term??null,duration:record.duration??null,perspective:record.perspective??null,
    subject:record.subject??record.person??record.entity??null,object:record.object??record.objectRef??null,aspect:record.aspect??record.field??record.key??null,
    viewpoints: record.viewpoints??[], keyDialogues: record.keyDialogues??[], customModuleId: record.customModuleId??null,fieldId:record.fieldId??null,scope:record.scope??null });
}

export function coveredRecallRecord(record, body, chosen) {
  for (const previous of chosen) {
    // Facts with a shared event/source can still have different validity or
    // distinct DIY field IDs. They must pass the stronger fact comparison.
    if(record.category==='entityFactChanges'||previous.record.category==='entityFactChanges'){
      if(!sameFactForRecall(record,previous.record))continue;
    }else if (!sameRecallEvent(record, previous.record)) continue;
    // For a floor, only compare when its projected event metadata is exactly
    // the same; a later disclosure must never replace an earlier perspective.
    let comparable = record;
    if (record.category === 'summaryView' && previous.record.category === 'events' && record.relatedEvents?.length === 1) {
      const event = record.relatedEvents[0];
      comparable = { ...record, temporal: record.temporal ?? event.temporal,
        location: record.location ?? event.location,
        participants: record.participants?.length ? record.participants : event.participants,
        awareness: record.awareness?.length ? record.awareness : event.awareness,
        state: record.state??previous.record.state, epistemicStatus: record.epistemicStatus??previous.record.epistemicStatus,
        viewpoints:record.viewpoints??previous.record.viewpoints,keyDialogues:record.keyDialogues??previous.record.keyDialogues };
    }
    if (recallGuardSignature(comparable) !== recallGuardSignature(previous.record)) continue;
    const text = normalized(previous.body), parts = sentences(body).map(normalized).filter(Boolean);
    if (parts.length && parts.every(part => text.includes(part))) return previous.record.id;
  }
  return null;
}

export function recallSelectionReason(candidate) {
  const names = { entity_identity: '人物身份匹配', bm25: '关键词匹配', local: '关键词匹配',
    tag_local: '标签匹配', category_local: '分类检索', vector_optional: '语义匹配', entity_exact: '人物精确匹配' };
  const channels = [...new Set((candidate.channels ?? []).map(c => names[c] ?? (/bm25/i.test(c) ? '关键词匹配' : '相关候选')))];
  return channels.join('、') || '相关候选';
}

// When semantic reranking is unavailable, independent questions must not
// compete as one bag of words. Reuse the existing local index and candidate
// pool, promoting at most one hit per question; no API calls or larger packet.
export function coverLocalQuestionParts(candidates,query,index,{filter,dictionary,limit=8,reranked=false}={}){
  if(reranked||!index?.search||limit<2)return candidates;
  // A comma often joins a claim and its correction ("why cancelled, was it
  // stage fright?"). Splitting there can promote the disproved claim.
  const parts=[...new Set(String(query??'').split(/[；;？?\n]+/u).map(s=>s.trim()).filter(s=>s.length>=4&&/谁|什么|怎么|哪里|哪儿|何时|是否|吗|多久|几个|多少|如何|为何|为什么/u.test(s)))].slice(0,3);
  if(parts.length<2)return candidates;
  const byId=new Map(candidates.map(c=>[String(c.id),c])),selected=[],seen=new Set();
  for(const part of parts){
    const expanded=dictionary?dictionaryQuery(part,dictionary,{expandTopics:false}).query:part;
    const hit=index.search(expanded,{limit:candidates.length,filter:r=>r.keywordEnabled!==false&&(!filter||filter(r))}).find(c=>byId.has(String(c.id))&&!seen.has(String(c.id)));
    if(hit&&selected.length<Math.min(3,limit)){seen.add(String(hit.id));selected.push({...byId.get(String(hit.id)),queryPartCoverage:true});}
  }
  return selected.length>1?[...selected,...candidates.filter(c=>!seen.has(String(c.id)))]:candidates;
}

// A person's presence is not evidence that every past scene with that person
// matters to a concrete question. This only rejects topic-unrelated local matches
// when another candidate supplies actual topic evidence. Broad continuation,
// semantic hits, reranked rows and explicit event dependencies are untouched.
export function nameOnlyRecallCandidates(candidates,query,dictionary,rerankedIds=[]){
  const original=String(query??'').toLocaleLowerCase();
  const names=[...new Set((dictionary.entries??[]).filter(e=>!e.disabled&&e.kind==='人物')
    .flatMap(e=>[e.name,...(e.aliases??[])].filter(n=>!(e.ambiguous??[]).includes(n))))]
    .map(n=>n.toLocaleLowerCase()).sort((a,b)=>b.length-a.length);
  const mentioned=names.filter(n=>original.includes(n));
  let rest=original;for(const name of mentioned)rest=rest.split(name).join(' ');
  const generic=/^(的|在|是|了|吗|呢|啊|吧|我|你|他|她|它|和|与|及|什么|怎么|为什么|怎样|如何|哪个|这个|那个|是否|现在|之前|以前|当时|后来|继续|然后|一下|告诉|关于|他们|她们|究竟|到底|还是)$/;
  // Keep exact object/place aliases useful after removing person names. The
  // BM25 query already expands these aliases; judging the original alias only
  // here would discard the correct canonical match as "name only". Related
  // index words stay off, and ambiguous/disabled aliases still do not expand.
  const exactEntities=dictionaryQuery(rest,dictionary,{expandTopics:false}).entities;
  const topicalQuery=[rest,...exactEntities.filter(name=>(dictionary.entries??[]).some(e=>e.name===name&&e.kind!=='人物'))].join(' ');
  const topics=[...new Set(tokenizeChinese(topicalQuery).filter(t=>t.length>1&&!generic.test(t)))];
  if(!topics.length)return new Set();
  // Don't qualify an unrelated event via attached knowledge, expanded tags
  // or the participants of an associated event. Judge its own actual content.
  const hasTopic=c=>topics.some(t=>[c.record.description,c.record.recallSummary,c.record.title,
    c.record.content,c.record.knowledge,c.record.field,c.record.to].filter(v=>typeof v==='string').join('\n').toLocaleLowerCase().includes(t));
  const topical=candidates.filter(hasTopic);if(!topical.length)return new Set();
  const linked=new Set(topical.flatMap(c=>c.record.category==='events'?[c.id]:refs(c.record)));
  const ranked=new Set(rerankedIds.map(String));
  return new Set(candidates.filter(c=>!hasTopic(c)&&!ranked.has(String(c.id))&&
    !(c.channels??[]).includes('vector_optional')&&!refs(c.record).some(id=>linked.has(id)))
    .map(c=>c.id));
}
