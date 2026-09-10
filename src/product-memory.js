import { LocalBM25Index, retrieveMemories, tokenizeChinese } from './retrieval.js';
import { estimateUnits, clone } from './utils.js';
import { buildDictionary, dictionaryQuery } from './product-dictionary.js';
import { fullSearchText, narrativeText, recordTitle, sourceFloors, stateLabel, awarenessLabel, viaLabel } from './product-narrative.js';
import { hasStoryTime } from './temporal.js';

export const CATEGORY_LABELS = Object.freeze({ events: '事件', awarenessChanges: '知情', entityFactChanges: '人物与事实', relationshipChanges: '关系', personaChanges: '人设变化', commitmentChanges: '约定', performanceHints: '演绎参考', summaryView: '楼层摘要', conflicts: '冲突与疑点', knowledge: '资料' });
export const readable = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
export function recordDescription(record) {
  if (record.field || record.key) return `${readable(record.entity ?? record.entityId ?? record.subject)} · ${record.field ?? record.key}：${readable(record.to ?? record.value ?? record.newValue)}`;
  return readable(record.description ?? record.content ?? record.text ?? record.summary ?? record.knowledge ?? record.fact ?? [record.subject ?? record.from ?? record.person, record.action ?? record.aspect ?? record.evidenceKind, record.object ?? record.to].filter(Boolean).join(' · '));
}
function dependencyIndex(records, keysFor) {
  const index = new Map();
  records.forEach((record, position) => {
    for (const key of new Set(keysFor(record).filter(Boolean))) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ position, record });
    }
  });
  return keys => {
    const found = new Map();
    for (const key of keys) for (const entry of index.get(key) ?? []) found.set(entry.position, entry.record);
    return [...found].sort((a, b) => a[0] - b[0]).map(([, record]) => record);
  };
}
export function memoryCards(records = {}, { hidden = [], knowledge = [], includeAwareness = false } = {}) {
  const ignored = new Set(hidden);
  const cards = [];
  const visible=r=>!ignored.has(r.id)&&!['retracted','superseded'].includes(r.lifecycleState);
  const links=r=>[r.eventRef,r.eventId,r.sourceEventId,...(r.eventRefs??[]),...(r.eventIds??[])].filter(Boolean);
  const sameSource=(a,b)=>a.sourceId===b.sourceId&&['fragmentId','version','swipeId','hash','contentHash'].every(k=>(a[k]??null)===(b[k]??null));
  const sharesSource=(a,b)=>(a.sourceRefs??[]).some(x=>(b.sourceRefs??[]).some(y=>sameSource(x,y)));
  const events=(records.events??[]).filter(visible),eventById=new Map(events.map(e=>[e.id,e]));
  const eventsBySource=dependencyIndex(events,e=>(e.sourceRefs??[]).map(r=>r.sourceId));
  const awarenessFor = dependencyIndex((records.awarenessChanges ?? []).filter(visible),links);
  const followUpsFor = dependencyIndex(records.commitmentChanges ?? [], a => [a.eventRef, a.completionOf, a.correctionOf, ...(a.eventRefs ?? [])]);
  for (const category of Object.keys(CATEGORY_LABELS)) {
    if (category==='knowledge'||category==='awarenessChanges'&&!includeAwareness)continue;
    for (const record of records[category] ?? []) {
      if (ignored.has(record.id) || ['retracted', 'superseded'].includes(record.lifecycleState)) continue;
      const refIds = new Set([record.id,...links(record)].filter(Boolean));
      const awareness = awarenessFor(refIds);
      const followUps = followUpsFor(refIds).filter(a => a.id !== record.id);
      const description = recordDescription(record);
      const card={ ...clone(record), id: record.id, category, description, awareness, followUps, temporal: record.temporal ?? record.storyTime ?? record.time ?? null };
      if(category==='summaryView'){
        const explicit=links(record);
        // Old summaries can reconnect by exact frozen source, never by names,
        // similar text, floor number alone, or memories in another chat.
        const related=explicit.length?explicit.map(id=>eventById.get(id)).filter(Boolean):eventsBySource((record.sourceRefs??[]).map(r=>r.sourceId)).filter(e=>sharesSource(e,record));
        const notLater=a=>{const floors=sourceFloors(a);return Number.isInteger(record.floorIndex)&&floors.length?Math.max(...floors)<=record.floorIndex:sharesSource(a,record)&&(a.sourceRefs??[]).length===1;};
        card.awareness=awarenessFor([record.id]).filter(notLater);
        card.relatedEvents=[...new Map(related.map(e=>[e.id,e])).values()].map(e=>({id:e.id,title:recordTitle(e),participants:clone(e.participants??[]),location:clone(e.location??null),temporal:clone(e.temporal??e.storyTime??e.time??null),awareness:clone(awarenessFor([e.id]).filter(notLater))}));
      }
      card.text=card.searchText=fullSearchText(card,description);
      if(card.relatedEvents?.length)card.text=card.searchText+='\n'+card.relatedEvents.map(e=>fullSearchText(e,'')).join('\n');
      cards.push(card);
    }
  }
  return [...cards, ...knowledge.filter(r => !ignored.has(r.id))];
}
function dateOnly(value) {
  const s = typeof value === 'string' ? value.slice(0, 10) : value?.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? '')) return null;
  const n = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === s ? { text: s, n } : null;
}
export function relativeStoryDate(value, now) {
  const d = dateOnly(value), current = dateOnly(now);
  if (!d || !current) return narrativeText(value);
  const delta = Math.round((d.n - current.n) / 86400000);
  const relative = ({ '-2': '前天', '-1': '昨天', 0: '今天', 1: '明天', 2: '后天' })[delta] ?? `${Math.abs(delta)}天${delta < 0 ? '前' : '后'}`;
  return `${narrativeText(value)}（${relative}）`;
}
function timeLines(time,settings){
  if(!hasStoryTime(time))return [];
  if(typeof time==='string')return [`故事时间：${relativeStoryDate(time,settings.storyDate)}`];
  const lines=[];
  for(const [key,label]of [['assertedAt','作出表述'],['occurredAt','事件发生'],['plannedFor','原定'],['actualAt','实际发生']])if(hasStoryTime(time[key]))lines.push(`${label}：${relativeStoryDate(time[key],settings.storyDate)}`);
  if(!lines.length)lines.push(`故事时间：${relativeStoryDate(time,settings.storyDate)}`);
  return lines;
}
function awarenessText(rows){
  return rows.map(a=>`${narrativeText(a.actorId??a.person??a.personId??a.audience)}：${narrativeText(a.knowledge??a.fact??a.content)}〔${awarenessLabel(a.status??a.knowledgeStatus)}；${viaLabel(a.via)}${hasStoryTime(a.learnedAt)?`；获知时间：${narrativeText(a.learnedAt)}`:''}〕`).join('；');
}
export function renderMemoryCard(card, settings = {}, { body=card.description, metadataOnly=false, detail=false }={}) {
  const lines = metadataOnly?[]:[`[${CATEGORY_LABELS[card.category] ?? '记忆'}] ${body}`];
  if (Array.isArray(card.participants)&&card.participants.length)lines.push(`参与人物：${narrativeText(card.participants)}`);
  if (card.location)lines.push(`地点：${narrativeText(card.location)}`);
  for(const v of (card.viewpoints??[]).slice(0,detail?8:2))lines.push(`观念 / 态度：${v.holder}${v.target?` 对 ${v.target}`:''}：${v.content}${v.context?`〔${v.context}〕`:''}${v.basis?`（${v.basis}）`:''}`);
  for(const q of (card.keyDialogues??[]).slice(0,detail?8:2))lines.push(`关键台词：${q.speaker}${q.to?` 对 ${q.to}`:''}：「${q.text}」${q.context?`〔${q.context}〕`:''}${q.meaning?`；体现：${q.meaning}`:''}`);
  if(card.keyDialogues?.length)lines.push('原话仅作当时语境的证据，不要求复读；说过不等于仍持相同态度。');
  if (card.state) lines.push(`状态：${stateLabel(card.state)}`);
  if (card.epistemicStatus && card.epistemicStatus !== 'observed') lines.push(`性质：${({ user_asserted: '用户确认', inferred: '推测而非事实', character_claim: '角色自述', unknown: '未确认' })[card.epistemicStatus] ?? card.epistemicStatus}`);
  if (card.category === 'knowledge') lines.push('外部设定资料，不等于角色已经历或已知情。');
  else if (card.awareness?.length) lines.push(`知情：${awarenessText(card.awareness)}`);
  else if(!card.relatedEvents?.some(e=>e.awareness.length))lines.push('本条未关联知情记录，不等于无人知情；不能据此让所有角色知情。');
  if(detail||settings.timeProtection)lines.push(...timeLines(card.temporal,settings));
  if(card.relatedEvents?.length){
    lines.push('关联事件（不代表全部发生在本楼，参与者不等于本楼全部在场）：');
    for(const e of card.relatedEvents){
      lines.push(`事件：${e.title}`);
      if(e.participants.length)lines.push(`事件参与者：${narrativeText(e.participants)}`);
      if(e.location)lines.push(`事件地点：${narrativeText(e.location)}`);
      if(detail||settings.timeProtection)lines.push(...timeLines(e.temporal,settings));
      if(e.awareness.length)lines.push(`截至本楼的知情记录：${awarenessText(e.awareness)}`);
      else lines.push('该事件暂无可关联到本楼及此前的知情记录，不据参与者推断。');
    }
  }
  if(detail&&!hasStoryTime(card.temporal)&&!card.relatedEvents?.some(e=>hasStoryTime(e.temporal)))lines.push('时间：本条记录未提取');
  if(detail&&!card.location&&!card.relatedEvents?.some(e=>e.location))lines.push('地点：本条记录未提取');
  for (const f of card.followUps ?? []) lines.push(`后续：${recordDescription(f)}〔${stateLabel(f.state) ?? '未确认'}〕`);
  if (card.context || card.validUntil || card.term) lines.push(`适用范围：${narrativeText(card.context)} ${narrativeText(card.validUntil ?? card.term)}`);
  return lines.join('\n');
}
export function expandAliases(query, aliases = '') {
  let out = query;
  for (const line of aliases.split('\n')) { const names = line.split(/[=,，]/).map(s => s.trim()).filter(Boolean); if (names.length && names.some(n => query.includes(n))) out += ` ${names.join(' ')}`; }
  return out;
}
export function relevantPassage(body,brief,query){
  if(typeof body!=='string'||!brief)return '';
  const tokens=[...new Set(tokenizeChinese(query).filter(t=>t.length>1&&!String(brief).toLocaleLowerCase().includes(t)))];
  if(!tokens.length)return '';
  const sentences=body.match(/[^。！？\n]+[。！？]?/g)??[body];
  const ranked=sentences.map((text,i)=>({i,score:tokens.filter(t=>text.toLocaleLowerCase().includes(t)).length})).filter(s=>s.score).sort((a,b)=>b.score-a.score||a.i-b.i);
  if(!ranked.length)return '';
  const n=ranked[0].i;
  // Keep neighbouring sentences so a refusal/cancellation after an action is
  // not silently stripped. Never truncate inside a sentence.
  return sentences.slice(Math.max(0,n-1),n+2).join('');
}
export function selectRecallCards(cards, settings) {
  return cards.filter(c => c.customInject !== false && c.category !== 'awarenessChanges' && !['retracted', 'superseded'].includes(c.lifecycleState) && c.category !== 'conflicts' && (settings.personaEnabled || !['entityFactChanges','personaChanges','relationshipChanges'].includes(c.category)) && (settings.performanceEnabled || c.category !== 'performanceHints') && (settings.knowledgeEnabled || c.category !== 'knowledge'));
}
export function prepareRecallIndex(cache, cards, settings, { scopeKey, revision, signal } = {}) {
  if (revision === undefined) throw new Error('recall cache requires a snapshot revision');
  return cache.prepare(selectRecallCards(cards, settings), { scopeKey, revision: { snapshot: revision, persona: settings.personaEnabled, performance: settings.performanceEnabled, knowledge: settings.knowledgeEnabled }, k1: settings.bm25K1, b: settings.bm25B, signal });
}
export async function recallMemory(cards, query, settings, { vectorAdapter = null, reranker = null, signal, indexCache = null, scopeKey, revision, dictionary=null } = {}) {
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const selected = selectRecallCards(cards, settings);
  const prepared = indexCache ? await prepareRecallIndex(indexCache, selected, settings, { scopeKey, revision, signal }) : null;
  const index = prepared?.index ?? new LocalBM25Index(selected, { k1: settings.bm25K1, b: settings.bm25B });
  const lexicon=dictionary??buildDictionary(selected,{aliases:settings.aliases,automatic:settings.dictionaryEnabled!==false});
  const matched=dictionaryQuery(query,lexicon),q=matched.query;
  const tagLanes=settings.tagRecallEnabled===false?[]:matched.tags.map(tag=>({tag,limit:settings.tagCandidateLimit??4}));
  const result = await retrieveMemories({ index, query: q, limit: Math.max(settings.retrievalLimit, settings.retrievalCandidateLimit ?? 24), vectorAdapter, reranker, signal,
    entityIds:matched.entities,tagLanes,
    totalTimeoutMs: settings.retrievalTimeoutMs,
    vectorTimeoutMs: settings.vectorTimeoutMs, vectorOptions: { rankConstant: settings.fusionRankConstant, localWeight: settings.fusionLocalWeight, vectorWeight: settings.vectorWeight },
    rerankOptions: { timeoutMs: settings.rerankTimeoutMs, maxCandidates: settings.rerankMaxCandidates } });
  // Entity facts are an explicit metadata lane, not another model call.
  const identities = selected.filter(c => {const name=readable(c.entity??c.entityId);return c.category==='entityFactChanges'&&name.length>0&&(matched.entities.includes(name)||(!lexicon.entries.some(e=>e.name===name)&&String(query).includes(name)));});
  let candidates = [...identities.map(record => ({ id: record.id, record, channels: ['entity_identity'] })), ...result.candidates];
  if (settings.distributedEnabled) {
    if (settings.distributedStrategy === 'leader_only') candidates = candidates.filter(c => (c.record.category === 'knowledge' ? 'knowledge' : 'memory') === settings.distributedChannel);
    else if (settings.distributedStrategy === 'broadcast') {
      const groups = [...new Set(result.candidates.map(c => c.record.category))];
      const lanes = groups.map(g => result.candidates.filter(c => c.record.category === g));
      const interleaved = [];
      for (let n = 0; n < settings.retrievalLimit; n++) for(const lane of lanes) if(lane[n]) interleaved.push(lane[n]);
      candidates = [...identities.map(record => ({ id: record.id, record })), ...interleaved];
    }
  }
  const seen = new Set(); candidates = candidates.filter(c => !seen.has(c.id) && seen.add(c.id));
  const header = ['[拾忆：有来源的连续性参考，不是必须重演的剧情]', '只让角色使用其实际知情范围；未知不等于全员已知。不要因召回而反复引用台词或加速关系。', settings.storyDate ? `当前故事日期：${settings.storyDate}。旧引语的昨天/明天以原事件时间为准。` : '当前故事日期未确认，不套用现实日期。', settings.worldMode === 'fanfiction' ? '同人资料是原作参照；当前分支的时期、身份和已经发生的事实优先，不强行回归原作。' : '按当前原创分支记录，不凭资料提前推进主线。'].join('\n');
  const ambiguity=matched.ambiguities.map(a=>`称呼“${a.name}”尚未区分：${a.owners.join('、')}；不得合并这些对象的经历。`).join('\n');
  const packetHeader=[header,ambiguity].filter(Boolean).join('\n');
  let content = packetHeader;
  const packed = [], omitted = [], portions=[];
  const budget = settings.retrievalBudgetUnits;
  for (const item of candidates) {
    const brief=typeof item.record.recallSummary==='string'&&item.record.recallSummary.trim()?item.record.recallSummary:item.record.description;
    const part = renderMemoryCard(item.record, settings,{body:brief});
    if (packed.length >= settings.retrievalLimit || estimateUnits(`${content}\n\n${part}`) > budget) { omitted.push(item.id); continue; }
    packed.push(item.record);portions.push(part);content += `\n\n${part}`;
  }
  // Reserve room for the selected records first, then expand the most relevant
  // narratives. No sentence cutting, and knowledge/time guards remain atomic.
  let expanded=0;
  let excerpts=0;
  for(let i=0;i<packed.length;i++){
    const full=renderMemoryCard(packed[i],settings);
    if(full===portions[i])continue;
    const proposed=[packetHeader,...portions.map((part,n)=>n===i?full:part)].join('\n\n');
    if(estimateUnits(proposed)<=budget){portions[i]=full;content=proposed;expanded++;}
    else {
      const excerpt=relevantPassage(packed[i].description,packed[i].recallSummary,q);
      if(!excerpt)continue;
      const part=renderMemoryCard(packed[i],settings,{body:`${packed[i].recallSummary}\n相关经过（节选）：${excerpt}`});
      const proposal=[packetHeader,...portions.map((p,n)=>n===i?part:p)].join('\n\n');
      if(estimateUnits(proposal)<=budget){portions[i]=part;content=proposal;excerpts++;}
    }
  }
  if (!packed.length) content = '';
  result.trace.index = prepared?.stats ?? { status: 'uncached', size: selected.length };
  result.trace.dictionary={matched:matched.terms,ambiguous:lexicon.entries.filter(e=>e.ambiguous.length).length};
  result.trace.packing={selected:packed.length,expanded,excerpts,brief:packed.length-expanded-excerpts,omitted:omitted.length};
  result.trace.timings.recallMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
  return { status: 'preview', previewOnly: true, sent: false, degraded: result.trace.degraded, text: content, cards: packed, usedUnits: content ? estimateUnits(content) : 0, omitted, trace: result.trace };
}
