import { stableStringify } from './utils.js';

const normalized = value => String(value ?? '').toLocaleLowerCase().replace(/\s+/gu, '').replace(/[。！？]+$/u,'');
const refs = record => [...new Set([record.eventRef, record.eventId, ...(record.eventRefs ?? []), ...(record.relatedEvents ?? []).map(e => e.id)].filter(Boolean))];
const sentences = value => String(value ?? '').match(/[^。！？\n]+[。！？]?/g) ?? [];

export function sceneRecallQuery(messages=[]) {
  const text=m=>typeof m?.content==='string'?m.content:Array.isArray(m?.content)?m.content.filter(p=>p?.type==='text').map(p=>p.text??'').join('\n'):'';
  const rows=messages.filter(m=>['user','assistant'].includes(m?.role)),latest=rows.filter(m=>m.role==='user').at(-1);
  const intent=text(latest),prior=rows.slice(0,rows.lastIndexOf(latest)).filter(m=>m.role==='assistant').at(-1);
  const narrative=text(prior).replace(/<(think|thinking)\b[^>]*>[\s\S]*?<\/\1>/gi,'').trim();
  const context=narrative.length>1600?`${narrative.slice(0,400)}\n${narrative.slice(-1200)}`:narrative;
  // Previous assistant prose supplies search context for pronouns/"continue";
  // never read system prompts/worldbooks as if they were the current scene.
  return {intent,context};
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

function guardSignature(record) {
  // Ignoring display IDs here is safe, ignoring facts/knowledge/time is not.
  const rows = value => (value ?? []).map(({ id, sourceRefs, ...rest }) => rest);
  return stableStringify({ temporal: record.temporal??null, participants: record.participants??[], location: record.location??null,
    awareness: rows(record.awareness), state: record.state??null, epistemicStatus: record.epistemicStatus??null,
    followUps: rows(record.followUps), context: record.context??null, validUntil: record.validUntil??null,
    expiresAt:record.expiresAt??null,term:record.term??null,duration:record.duration??null,
    subject:record.subject??record.person??record.entity??null,object:record.object??record.objectRef??null,aspect:record.aspect??record.field??record.key??null,
    viewpoints: record.viewpoints??[], keyDialogues: record.keyDialogues??[], customModuleId: record.customModuleId??null,scope:record.scope??null });
}

export function coveredRecallRecord(record, body, chosen) {
  for (const previous of chosen) {
    if (!sameRecallEvent(record, previous.record)) continue;
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
    if (guardSignature(comparable) !== guardSignature(previous.record)) continue;
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
