import { LocalBM25Index, retrieveMemories, tokenizeChinese } from './retrieval.js';
import { estimateUnits, clone, stableStringify } from './utils.js';
import { buildDictionary, dictionaryQuery,enrichRetrievalMetadata } from './product-dictionary.js';
import { fullSearchText, narrativeText, recordTitle, sourceFloors, stateLabel, awarenessLabel, viaLabel, relationLabel, epistemicLabel, fieldLabel } from './product-narrative.js';
import { hasStoryTime, storyDateOf } from './temporal.js';
import { coveredRecallRecord, recallSelectionReason, nameOnlyRecallCandidates } from './product-recall-packing.js';
import { factValue, fullCharacterGroups, awarenessSubjectLabel } from './product-person-profiles.js';
import { compileEventPacket } from './product-event-packet.js';

export const CATEGORY_LABELS = Object.freeze({ events: '事件', awarenessChanges: '知情', entityFactChanges: '人物与事实', relationshipChanges: '关系', personaChanges: '人设变化', commitmentChanges: '约定', performanceHints: '演绎参考', summaryView: '楼层摘要', conflicts: '冲突与疑点', knowledge: '资料' });
export const readable = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
export function recordDescription(record) {
  const category=record.category;
  if ((record.entity||record.entityId)&&(record.field||record.key)&&category!=='personaChanges') return `${narrativeText(record.entity ?? record.entityId)} · ${record.fieldLabel??fieldLabel(record.field ?? record.key)}：${factValue(record)===null?'已清空 / 未赋值':narrativeText(factValue(record))}`;
  const body=record.description??record.content??record.text??record.summary??record.knowledge??record.fact??record.guidance??record.instruction??record.hint??record.explanation??record.issue;
  if(category==='relationshipChanges'||record.evidenceKind){
    const heading=`${narrativeText(record.from??record.subject)} → ${narrativeText(record.to??record.object)}：${relationLabel(record.evidenceKind??record.kind)}`;
    // Preserve narrative/evidence, including asymmetric responses. An enum is not a narrative.
    const evidence=['expression','response','mutualConfirmation','publicScope'].filter(k=>record[k]!=null).map(k=>narrativeText({[k]:record[k]}));
    const text=narrativeText(body);
    return [text.startsWith(heading)?text:[heading,text].filter(Boolean).join('\n'),...evidence.filter(e=>!text.includes(e))].filter(Boolean).join('\n');
  }
  if(body!=null)return narrativeText(body);
  return [record.subject??record.person??record.actorId??record.entity,fieldLabel(record.aspect??record.field??record.key),record.action,record.object??record.objectRef,record.reason].map(narrativeText).filter(Boolean).join(' · ')||'暂无文字说明';
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
      // A knowledge row describes this actor's knowledge, not every other actor
      // linked to the same event. Shared event IDs don't make claims interchangeable.
      const awareness = category==='awarenessChanges'?[record]:awarenessFor(refIds);
      const followUps = followUpsFor(refIds).filter(a => a.id !== record.id);
      const description = recordDescription({...record,category});
      const card={ ...enrichRetrievalMetadata(clone(record),[description,...(record.keyDialogues??[]).map(q=>q.text)].join('\n')), id: record.id, category, description, awareness, followUps, temporal: record.temporal ?? record.storyTime ?? record.time ?? null };
      if(category==='summaryView'||['relationshipChanges','personaChanges','commitmentChanges','performanceHints','conflicts'].includes(category)){
        const explicit=links(record);
        // Old summaries can reconnect by exact frozen source, never by names,
        // similar text, floor number alone, or memories in another chat.
        const related=explicit.length?explicit.map(id=>eventById.get(id)).filter(Boolean):category==='summaryView'?eventsBySource((record.sourceRefs??[]).map(r=>r.sourceId)).filter(e=>sharesSource(e,record)):[];
        const notLater=a=>{const floors=sourceFloors(a);return Number.isInteger(record.floorIndex)&&floors.length?Math.max(...floors)<=record.floorIndex:sharesSource(a,record)&&(a.sourceRefs??[]).length===1;};
        if(category==='summaryView')card.awareness=awarenessFor([record.id]).filter(notLater);
        card.relatedEvents=[...new Map(related.map(e=>[e.id,e])).values()].map(e=>({id:e.id,title:recordTitle(e),participants:clone(e.participants??[]),location:clone(e.location??null),temporal:clone(e.temporal??e.storyTime??e.time??null),awareness:category==='summaryView'?clone(awarenessFor([e.id]).filter(notLater)):[]}));
      }
      card.text=card.searchText=fullSearchText(card,description);
      if(card.relatedEvents?.length)card.text=card.searchText+='\n'+card.relatedEvents.map(e=>fullSearchText(e,'')).join('\n');
      cards.push(card);
    }
  }
  return [...cards, ...knowledge.filter(r => !ignored.has(r.id))];
}
function dateOnly(value) {
  const s = storyDateOf(value);
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
  return rows.map(a=>`${awarenessSubjectLabel(a)}：${narrativeText(a.knowledge??a.fact??a.content)}〔${awarenessLabel(a.status??a.knowledgeStatus)}；${viaLabel(a.via)}${hasStoryTime(a.learnedAt)?`；获知时间：${narrativeText(a.learnedAt)}`:''}〕`).join('；');
}
export function renderMemoryCard(card, settings = {}, { body=card.description, metadataOnly=false, detail=false, full=false, query=null }={}) {
  if(card.mergedParts?.length){
    const parts=card.mergedParts;
    const guard=p=>stableStringify({temporal:p.temporal,location:p.location,state:p.state,epistemicStatus:p.epistemicStatus,perspective:p.perspective,awareness:(p.awareness??[]).map(({id,sourceRefs,eventRef,eventId,...a})=>a),followUps:p.followUps??[]});
    if(parts.every(p=>guard(p)===guard(parts[0]))){
      const {mergedParts,...single}=card;
      return renderMemoryCard({...single,temporal:parts[0].temporal,awareness:parts[0].awareness,followUps:parts[0].followUps},settings,{body,metadataOnly,detail,full,query});
    }
    return ['[同一事件的分段记录；知情范围仅适用于各自片段，不自动扩散]',...parts.map(p=>{
      const copy={...p};delete copy.mergeReview;
      const brief=detail||full?p.description:p.recallSummary||p.description;
      const excerpt=!detail&&!full&&query!==null?relevantPassage(p.description,p.recallSummary,query):'';
      return `来源：${sourceFloors(p).map(n=>`第 ${n} 楼`).join('、')||'原记录'}\n${renderMemoryCard(copy,settings,{body:excerpt?`${brief}\n相关经过：${excerpt}`:brief,detail,full,query})}`;
    })].join('\n\n');
  }
  const lines = metadataOnly?[]:[`[${CATEGORY_LABELS[card.category] ?? '记忆'}] ${body}`];
  for(const warning of card.continuityWarnings??[])lines.push(`待确认：${warning}`);
  if(detail&&!full)for(const e of card.qualityEvidence??[])lines.push(`校对依据${Number.isInteger(e.floor)?` · 第 ${e.floor} 楼`:''}：「${e.quote}」`);
  if (Array.isArray(card.participants)&&card.participants.length)lines.push(`参与人物：${narrativeText(card.participants)}`);
  if (card.location)lines.push(`地点：${narrativeText(card.location)}`);
  const names=[...(card.participants??[]),...(card.entities??[]).flatMap(e=>typeof e==='string'?[e]:[e.name,...(e.aliases??[])])].filter(n=>typeof n==='string');
  const topics=query===null?[]:tokenizeChinese(query).filter(t=>t.length>1&&!names.some(n=>n.includes(t))&&!/^(什么|怎么|为什么|这次|那个|这个|现在|是否|一下|告诉|关于|他们|她们)$/.test(t));
  const relevant=text=>full||detail||query===null||topics.some(t=>String(text).toLocaleLowerCase().includes(t));
  const viewpoints=(card.viewpoints??[]).filter(v=>relevant(`${v.content} ${v.context??''} ${v.target??''}`)).slice(0,full?Infinity:detail?8:2);
  const dialogues=(card.keyDialogues??[]).filter(q=>relevant(`${q.text} ${q.context??''} ${q.meaning??''}`)||query!==null&&/原话|台词|说过什么/.test(query)).slice(0,full?Infinity:detail?8:2);
  for(const v of viewpoints)lines.push(`观念 / 态度：${v.holder}${v.target?` 对 ${v.target}`:''}：${v.content}${v.context?`〔${v.context}〕`:''}${v.basis?`（${v.basis}）`:''}`);
  for(const q of dialogues)lines.push(`关键台词：${q.speaker}${q.to?` 对 ${q.to}`:''}：「${q.text}」${q.context?`〔${q.context}〕`:''}${q.meaning?`；体现：${q.meaning}`:''}`);
  if(dialogues.length)lines.push('原话仅作当时语境的证据，不要求复读；说过不等于仍持相同态度。');
  if (card.state) lines.push(`状态：${stateLabel(card.state)}`);
  if (card.mergeReview?.status==='pending') {
    lines.push('合并待核对：尚未确认与已有记录为同一次事件，暂存独立；不据此认定发生了两次。');
    if(detail)lines.push(`旧记录发生时间：${narrativeText(card.mergeReview.previousTime)||'未提取'}；本次提取：${narrativeText(card.mergeReview.proposedTime)||'未提取'}`);
  }
  if (card.epistemicStatus && card.epistemicStatus !== 'observed') lines.push(`性质：${epistemicLabel(card.epistemicStatus)}`);
  if (card.category === 'knowledge') lines.push(card.worldMode==='fanfiction'?'同人原作资料：当前分支事实优先，原作未来不是已经发生或全员知情。':card.worldMode==='original'?'原创世界资料：设定与主线计划不是当前已发生或全员知情的经历。':'外部设定资料，不等于角色已经历或已知情。');
  else if (card.category==='awarenessChanges') lines.push(`知情：${awarenessText([card])}`);
  else if (card.awareness?.length) lines.push(`知情：${awarenessText(card.awareness)}`);
  else if(!card.relatedEvents?.some(e=>e.awareness.length)&&(!detail||['events','summaryView'].includes(card.category)))lines.push('本条未关联知情记录，不等于无人知情；不能据此让所有角色知情。');
  if(detail||settings.timeProtection)lines.push(...timeLines(card.temporal,settings));
  if(card.category==='entityFactChanges'){
    if(Object.hasOwn(card,'from')||Object.hasOwn(card,'oldValue'))lines.push(`原先取值：${narrativeText(Object.hasOwn(card,'from')?card.from:card.oldValue)}`);
    if(hasStoryTime(card.validFrom))lines.push(`开始适用：${narrativeText(card.validFrom)}`);
    if(hasStoryTime(card.validUntil))lines.push(`适用截至：${narrativeText(card.validUntil)}`);
  }
  if(card.relatedEvents?.length&&(detail||card.category==='summaryView')){
    lines.push('关联事件（不代表全部发生在本楼，参与者不等于本楼全部在场）：');
    for(const e of card.relatedEvents){
      lines.push(`事件：${e.title}`);
      if(e.participants.length)lines.push(`事件参与者：${narrativeText(e.participants)}`);
      if(e.location)lines.push(`事件地点：${narrativeText(e.location)}`);
      if(detail||settings.timeProtection)lines.push(...timeLines(e.temporal,settings));
      if(e.awareness.length)lines.push(`截至本楼的知情记录：${awarenessText(e.awareness)}`);
      else if(card.category==='summaryView')lines.push('该事件暂无可关联到本楼及此前的知情记录，不据参与者推断。');
    }
  }
  if(detail&&['events','summaryView'].includes(card.category)){
    if(!hasStoryTime(card.temporal)&&!card.relatedEvents?.some(e=>hasStoryTime(e.temporal)))lines.push('发生时间：尚未单独记录');
    if(!card.location&&!card.relatedEvents?.some(e=>e.location))lines.push('发生地点：尚未单独记录');
  }
  for (const f of card.followUps ?? []) lines.push(`后续：${recordDescription(f)}〔${stateLabel(f.state) ?? '未确认'}〕`);
  if(card.category==='personaChanges'){
    if(Object.hasOwn(card,'before')||Object.hasOwn(card,'after'))lines.push(`变化前：${narrativeText(card.before)}；变化后：${narrativeText(card.after)}`);
    lines.push(`变化人物：${narrativeText(card.subject??card.person??card.entity)}；针对对象：${narrativeText(card.object??card.objectRef)}`);
    lines.push(`适用情境与范围：${narrativeText(card.context)}；${narrativeText(card.scope)}`);
    const validity=card.expiresAt??card.validUntil??card.term??card.duration;
    lines.push(validity?`有效期：${narrativeText(validity)}`:'有效期未确认；仅用于上述对象、情境与范围，不推定永久变化。');
  }else if (card.context || card.validUntil || card.term) lines.push(`适用范围：${narrativeText(card.context)} ${narrativeText(card.validUntil ?? card.term)}`);
  if(full){
    if(card.scope)lines.push(`记录范围：${narrativeText(card.scope)}`);
    if(card.perspective)lines.push(`叙述视角：${narrativeText({perspective:card.perspective})}`);
    if(card.customModuleId)lines.push(`扩展模块：${card.customModuleId}${card.readonly?'（只读）':''}`);
  }
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
export function selectRecallCards(cards, settings, {includeAwareness=false}={}) {
  return cards.filter(c => c.customInject !== false && (includeAwareness||c.category !== 'awarenessChanges') && !['retracted', 'superseded'].includes(c.lifecycleState) && c.category !== 'conflicts' && (settings.personaEnabled || !['entityFactChanges','personaChanges','relationshipChanges','awarenessChanges'].includes(c.category)) && (settings.performanceEnabled || c.category !== 'performanceHints') && (settings.knowledgeEnabled || c.category !== 'knowledge'));
}
export function prepareRecallIndex(cache, cards, settings, { scopeKey, revision, signal } = {}) {
  if (revision === undefined) throw new Error('recall cache requires a snapshot revision');
  return cache.prepare(selectRecallCards(cards, settings), { scopeKey, revision: { snapshot: revision, persona: settings.personaEnabled, performance: settings.performanceEnabled, knowledge: settings.knowledgeEnabled }, k1: settings.bm25K1, b: settings.bm25B, signal });
}
export async function recallMemory(cards, query, settings, { vectorAdapter = null, reranker = null, signal, indexCache = null, scopeKey, revision, dictionary=null,focusQuery=query,characterQuery=query } = {}) {
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const selected = selectRecallCards(cards, settings);
  const prepared = indexCache ? await prepareRecallIndex(indexCache, selected, settings, { scopeKey, revision, signal }) : null;
  const index = prepared?.index ?? new LocalBM25Index(selected, { k1: settings.bm25K1, b: settings.bm25B });
  const lexicon=dictionary??buildDictionary(selected,{aliases:settings.aliases,automatic:settings.dictionaryEnabled!==false});
  const matched=dictionaryQuery(query,lexicon),q=matched.query;
  const characters=fullCharacterGroups(selectRecallCards(cards,settings,{includeAwareness:true}),characterQuery,lexicon);
  const fullIds=new Set(characters.groups.flatMap(g=>g.records.map(r=>r.id)));
  const tagLanes=settings.tagRecallEnabled===false?[]:matched.tags.map(tag=>({tag,limit:settings.tagCandidateLimit??4}));
  const categoryLanes=settings.distributedEnabled&&settings.distributedStrategy==='broadcast'
    ? [...new Set(selected.filter(c=>!fullIds.has(c.id)).map(c=>c.category))].filter(category=>category!=='summaryView').map(category=>({category,limit:settings.tagCandidateLimit??4})) : [];
  const channelFilter=settings.distributedEnabled&&settings.distributedStrategy==='leader_only'
    ? c=>(c.category==='knowledge'?'knowledge':'memory')===settings.distributedChannel : undefined;
  const filter=c=>!fullIds.has(c.id)&&(!channelFilter||channelFilter(c));
  const result = await retrieveMemories({ index, query: q, limit: Math.max(settings.retrievalLimit, settings.retrievalCandidateLimit ?? 24), vectorAdapter, reranker, signal,categoryLanes,filter,
    entityIds:matched.entities,tagLanes,
    totalTimeoutMs: settings.retrievalTimeoutMs,
    vectorTimeoutMs: settings.vectorTimeoutMs, vectorOptions: { rankConstant: settings.fusionRankConstant, localWeight: settings.fusionLocalWeight, vectorWeight: settings.vectorWeight },
    rerankOptions: { timeoutMs: settings.rerankTimeoutMs, maxCandidates: settings.rerankMaxCandidates } });
  let candidates = [...result.candidates];
  const seen = new Set(); candidates = candidates.filter(c => !seen.has(c.id) && seen.add(c.id));
  // Present a canonical event before its floor duplicate, without changing
  // relative order of unrelated events or deleting any stored floor summary.
  const byId=new Map(candidates.map(c=>[c.id,c])),ordered=[],placed=new Set();
  for(const c of candidates){
    const links=c.record.category==='summaryView'?(c.record.relatedEvents??[]).map(e=>e.id):[];
    for(const id of links)if(byId.get(id)?.record.category==='events'&&!placed.has(id)){ordered.push(byId.get(id));placed.add(id);}
    if(!placed.has(c.id)){ordered.push(c);placed.add(c.id);}
  }
  candidates=ordered;
  const header = ['[拾忆：有来源的连续性参考，不是必须重演的剧情]', '只让角色使用其实际知情范围；未知不等于全员已知。不要因召回而反复引用台词或加速关系。', settings.storyDate ? `当前故事日期：${settings.storyDate}。旧引语的昨天/明天以原事件时间为准。` : '当前故事日期未确认，不套用现实日期。', settings.worldMode === 'fanfiction' ? '同人资料是原作参照；当前分支的时期、身份和已经发生的事实优先，不强行回归原作。' : '按当前原创分支记录，不凭资料提前推进主线。'].join('\n');
  const ambiguities=[...new Map([...matched.ambiguities,...characters.matched.ambiguities].map(a=>[a.name,a])).values()];
  const ambiguity=ambiguities.map(a=>`称呼“${a.name}”尚未区分：${a.owners.join('、')}；不得合并这些对象的经历。`).join('\n');
  const packetHeader=[header,ambiguity].filter(Boolean).join('\n');
  let content = packetHeader;
  const packetEntries=[];
  const packed = [], omitted = [], chosen=[],decisions=[];
  const characterParts=[],characterChosen=[];
  for(const group of characters.groups){
    const parts=[];
    for(const record of group.records){
      const decision={id:record.id,title:recordTitle(record),category:record.category,reason:'人物档案全量',scores:{keyword:null,vector:null,fusion:null,final:null}};
      const coveredBy=coveredRecallRecord(record,record.description,characterChosen);
      if(coveredBy){decisions.push({...decision,status:'duplicate',coveredBy});omitted.push(record.id);continue;}
      // Full payload, never recallSummary, query excerpts or a character cap.
      parts.push(renderMemoryCard(record,{...settings,timeProtection:true},{body:record.description,detail:true,full:true}));
      characterChosen.push({record,body:record.description});packed.push(record);
      decisions.push({...decision,status:'selected',detail:'full_character'});
    }
    if(parts.length)characterParts.push(`[人物档案：${group.subject}]\n${parts.join('\n\n')}`);
  }
  // Count/length limits apply only to retrieved history, not to dossiers.
  // The header is charged once to history as before; dossiers cannot consume
  // the event allowance even when their full text exceeds it.
  const characterText=characterParts.length?['[本轮涉及人物的完整档案；提及不等于在场，资料不自动赋予其他角色知情权。不同时间、对象与情境的记录按各自条件使用，不把变化历史视为同时生效。]',...characterParts].join('\n\n'):'';
  let memoryCount=0;
  let excerpts=0;
  const budget = settings.retrievalBudgetUnits;
  const nameOnly=nameOnlyRecallCandidates(candidates,focusQuery,lexicon,result.trace.rerank.status==='passed'?(result.trace.rerank.scores??[]).map(s=>s.id):[]);
  for (const item of candidates) {
    const brief=typeof item.record.recallSummary==='string'&&item.record.recallSummary.trim()?item.record.recallSummary:item.record.description;
    // Detail is driven by the original request, not by available space or
    // expanded alias names. Store/search the full narrative without sending it.
    const excerpt=relevantPassage(item.record.description,item.record.recallSummary,focusQuery);
    const body=excerpt?`${brief}\n相关经过：${excerpt}`:brief;
    const coveredBy=coveredRecallRecord(item.record,body,chosen);
    const decision={id:item.id,title:recordTitle(item.record),category:item.record.category,reason:recallSelectionReason(item),scores:{keyword:item.localScore??null,vector:item.vectorScore??null,fusion:item.fusionScore??null,final:item.score??null}};
    if(nameOnly.has(item.id)){omitted.push(item.id);decisions.push({...decision,status:'name_only'});continue;}
    if(coveredBy){decisions.push({...decision,status:'duplicate',coveredBy});omitted.push(item.id);continue;}
    let part = renderMemoryCard(item.record, settings,{body,query:focusQuery});
    const candidatePacket=()=>compileEventPacket([...packetEntries,{record:item.record,text:part}]);
    let trial=candidatePacket();
    let usedBody=body,usedExcerpt=Boolean(excerpt);
    if(estimateUnits(`${packetHeader}\n\n${trial.text}`)>budget&&excerpt){part=renderMemoryCard(item.record,settings,{body:brief,query:focusQuery});usedBody=brief;usedExcerpt=false;trial=candidatePacket();}
    if (memoryCount >= settings.retrievalLimit || estimateUnits(`${packetHeader}\n\n${trial.text}`) > budget) { omitted.push(item.id);decisions.push({...decision,status:memoryCount>=settings.retrievalLimit?'limit':'budget'});continue; }
    packed.push(item.record);packetEntries.push({record:item.record,text:part});chosen.push({record:item.record,body:usedBody});content = `${packetHeader}\n\n${trial.text}`;
    memoryCount++;
    if(usedExcerpt)excerpts++;
    decisions.push({...decision,status:'selected',detail:usedExcerpt?'excerpt':'brief',detailOmitted:Boolean(excerpt)&&!usedExcerpt});
  }
  const memoryUnits=memoryCount?estimateUnits(content):0;
  const eventPacket=compileEventPacket(packetEntries);
  content=packed.length?[packetHeader,characterText,eventPacket.text].filter(Boolean).join('\n\n'):'';
  result.trace.index = prepared?.stats ?? { status: 'uncached', size: selected.length };
  result.trace.dictionary={matched:matched.terms,ambiguous:lexicon.entries.filter(e=>e.ambiguous.length).length};
  result.trace.characters={mode:'full',people:characters.people,records:characterChosen.length,units:estimateUnits(characterText),truncated:false};
  result.trace.packing={selected:packed.length,memorySelected:memoryCount,memoryUnits,expanded:0,excerpts,brief:memoryCount-excerpts,omitted:omitted.length,duplicates:decisions.filter(d=>d.status==='duplicate').length,decisions};
  result.trace.packing.eventPacket={groups:eventPacket.groups,groupedRecords:eventPacket.groupedRecords,sharedLines:eventPacket.sharedLines,beforeChars:eventPacket.beforeChars,afterChars:eventPacket.afterChars,savedChars:eventPacket.savedChars};
  result.trace.timings.recallMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
  return { status: 'preview', previewOnly: true, sent: false, degraded: result.trace.degraded, text: content, cards: packed, usedUnits: content ? estimateUnits(content) : 0, omitted, trace: result.trace };
}
