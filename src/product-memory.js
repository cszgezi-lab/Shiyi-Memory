import { LocalBM25Index, retrieveMemories, tokenizeChinese } from './retrieval.js';
import { estimateUnits, clone, stableStringify } from './utils.js';
import { buildDictionary, dictionaryQuery,enrichRetrievalMetadata } from './product-dictionary.js';
import { fullSearchText, narrativeText, recordTitle, sourceFloors, sourceLabel, stateLabel, awarenessLabel, viaLabel, relationLabel, epistemicLabel, fieldLabel,scopeLabel } from './product-narrative.js';
import { hasStoryTime, storyDateOf } from './temporal.js';
import { coveredRecallRecord, recallSelectionReason, nameOnlyRecallCandidates, coverLocalQuestionParts } from './product-recall-packing.js';
import { factValue, fullCharacterGroups, awarenessSubjectLabel, characterRecordSubjects, explicitSubjectNames, PERSON_RECORD_CATEGORIES } from './product-person-profiles.js';
import {foldName} from './persona-identity.js';
import {markMemoryStates,memoryHistoryIntent} from './memory-current-state.js';
import { compileEventPacket } from './product-event-packet.js';
import { factValidity, awarenessAssociationSupported } from './memory-evidence.js';
import { originalSourceText, sourceRecallExcerpt, sourceQuote, evidenceTerms, sourceEvidenceQuery, projectSourceForRecall } from './source-recall-evidence.js';
import { innerLifeText, importantDialoguePacket,markDiaryHistory,characterKeepsakes } from './character-journal.js';

export const CATEGORY_LABELS = Object.freeze({ events: '事件', awarenessChanges: '知情', entityFactChanges: '人物与事实', relationshipChanges: '关系', personaChanges: '人设变化', commitmentChanges: '约定', performanceHints: '演绎参考', summaryView: '楼层摘要', conflicts: '冲突与疑点', knowledge: '资料' });
/** Short names for the compact category tiles only. At 390px the full labels
 * ("人物与事实", "冲突与疑点") wrapped onto two lines inside the 48px tile. The
 * published tile metrics are a fixed contract, so the tile uses a shorter word
 * while every other surface keeps the full name. */
export const CATEGORY_TILE_LABELS = Object.freeze({ events: '事件', awarenessChanges: '知情', entityFactChanges: '人物', relationshipChanges: '关系', personaChanges: '人设', commitmentChanges: '约定', performanceHints: '演绎', summaryView: '楼层', conflicts: '疑点', knowledge: '资料' });
/** Which page owns a module. Memory records the shared timeline; the people page
 * owns everything that belongs to one character. Both pages read the SAME stored
 * categories — this split is presentation only and never migrates, rewrites or
 * re-files an existing record. */
export const PERSON_CATEGORIES = PERSON_RECORD_CATEGORIES;
export const EVENT_CATEGORY_LABELS = Object.freeze(Object.fromEntries(Object.entries(CATEGORY_LABELS).filter(([key]) => !PERSON_CATEGORIES.includes(key))));
/** The one line that tells a reader where a moved module now lives. */
export const CATEGORY_PAGE_HINT = Object.freeze(Object.fromEntries(PERSON_CATEGORIES.map(key => [key, `${CATEGORY_LABELS[key]}已归入“人物”页，按人物查看和修改；记录本身没有移动。`])));
export const readable = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
/** Star level (1–5) for a record, used to colour and rank rows in the memory and
 * people pages. The summary model supplies importance 1–10; when a record has
 * none (older memories) the level is derived from evidence the program already
 * holds, so the UI is never blank and no extra model call is needed. */
export function recordImportance(record){
  const raw=typeof record?.importance==='number'?record.importance:Number(record?.importance);
  const score=Number.isFinite(raw)&&raw>=1?Math.min(10,Math.round(raw)):(()=>{
    const floors=(record?.sourceRefs??[]).length||(record?.sourceFloors??[]).length;
    const links=1+(record?.eventRefs??[]).length+(record?.eventRef?1:0)+((record?.participants??[]).length>1?1:0);
    if(record?.category==='performanceHints'||record?.category==='summaryView')return 3;
    if(record?.category==='conflicts')return 7;
    return Math.max(3,Math.min(7,links*2+(floors>1?1:0)));
  })();
  return Math.min(5,Math.max(1,Math.ceil(score/2)));
}
/** 最近修改：先看人间改过的记录（controls.edits 会留下 recordedAt），再看最新的
 * 有来源记录。只读展示，不新增字段、不改写任何记录。 */
export function recentChanges(cards = [], limit = 3) {
  const floor = record => Math.max(-1, ...(record?.sourceFloors ?? []).filter(Number.isInteger));
  const stamp = record => typeof record?.editedAt === 'string' ? Date.parse(record.editedAt) || 0 : 0;
  return [...cards]
    .sort((a, b) => stamp(b) - stamp(a) || floor(b) - floor(a))
    .slice(0, Math.max(0, limit));
}
const sameSource=(a,b)=>a.sourceId===b.sourceId&&['fragmentId','version','swipeId','hash','contentHash'].every(k=>(a[k]??null)===(b[k]??null));
const sharesSource=(a,b)=>(a.sourceRefs??[]).some(x=>(b.sourceRefs??[]).some(y=>sameSource(x,y)));
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
  const links=r=>[r.eventRef,r.eventId,r.sourceEventId,r.recordRef,...(r.eventRefs??[]),...(r.eventIds??[])].filter(Boolean);
  const events=(records.events??[]).filter(visible),eventById=new Map(events.map(e=>[e.id,e]));
  const eventsBySource=dependencyIndex(events,e=>(e.sourceRefs??[]).map(r=>r.sourceId));
  const knowledgeRows=(records.awarenessChanges??[]).filter(r=>visible(r)&&r.knowledgeReview?.status!=='pending');
  const awarenessFor = dependencyIndex(knowledgeRows,links);
  const unlinkedBySource=dependencyIndex(knowledgeRows.filter(a=>!links(a).length),a=>(a.sourceRefs??[]).map(r=>r.sourceId));
  const commitments=markMemoryStates((records.commitmentChanges??[]).filter(visible).map(r=>({...r,category:'commitmentChanges'})));
  const commitmentById=new Map(commitments.map(r=>[r.id,r]));
  const rawCommitmentById=new Map((records.commitmentChanges??[]).map(r=>[r.id,r]));
  const followUpLinks=a=>[a.eventRef,a.completionOf,a.correctionOf,a.supersedes,...(a.eventRefs??[])];
  const followUpsFor = dependencyIndex(commitments.filter(r=>r.state!=='unknown'&&!r.stateHistorical).map(r=>rawCommitmentById.get(r.id)), a => [...followUpLinks(a),...(commitmentById.get(a.id)?.stateHistoryIds??[]).flatMap(id=>followUpLinks(commitmentById.get(id)??{}))]);
  for (const category of Object.keys(CATEGORY_LABELS)) {
    if (category==='knowledge'||category==='awarenessChanges'&&!includeAwareness)continue;
    for (const record of records[category] ?? []) {
      if(record.journalOnly&&!record.innerLife?.text)continue;
      if (ignored.has(record.id) || ['retracted', 'superseded'].includes(record.lifecycleState)) continue;
      const refIds = new Set([record.id,...links(record)].filter(Boolean));
      // A knowledge row describes this actor's knowledge, not every other actor
      // linked to the same event. Shared event IDs don't make claims interchangeable.
      const associated = awarenessFor(refIds);
      const awareness = category==='awarenessChanges'?[record]:associated.filter(a=>category!=='events'||awarenessAssociationSupported(a,record));
      const followUps = followUpsFor(refIds).filter(a => a.id !== record.id);
      const description = recordDescription({...record,category});
      const card={ ...enrichRetrievalMetadata(clone(record),[description,...(record.keyDialogues??[]).map(q=>q.text)].join('\n')), id: record.id, category, description, awareness, followUps, temporal: record.temporal ?? record.storyTime ?? record.time ?? null };
      card.importanceLevel=recordImportance({...record,category});
      if(category==='events' && awareness.length!==associated.length)card.associationReviewCount=associated.length-awareness.length;
      if(category==='summaryView'||['awarenessChanges','relationshipChanges','personaChanges','commitmentChanges','performanceHints','conflicts'].includes(category)){
        const explicit=links(record);
        // Old summaries can reconnect by exact frozen source, never by names,
        // similar text, floor number alone, or memories in another chat.
        const related=explicit.length?explicit.map(id=>eventById.get(id)).filter(e=>e&&(category!=='awarenessChanges'||awarenessAssociationSupported(record,e))):category==='summaryView'?eventsBySource((record.sourceRefs??[]).map(r=>r.sourceId)).filter(e=>sharesSource(e,record)):[];
        const notLater=a=>{const floors=sourceFloors(a);return Number.isInteger(record.floorIndex)&&floors.length?Math.max(...floors)<=record.floorIndex:sharesSource(a,record)&&(a.sourceRefs??[]).length===1;};
        // A missing event ID must not make independently sourced knowledge
        // disappear. Attach only to its exact frozen floor, never invent an
        // event relationship or spread this actor's claim to participants.
        if(category==='summaryView')card.awareness=[...awarenessFor([record.id]),...unlinkedBySource((record.sourceRefs??[]).map(r=>r.sourceId)).filter(a=>sharesSource(a,record))].filter(notLater);
        card.relatedEvents=[...new Map(related.map(e=>[e.id,e])).values()].map(e=>({id:e.id,title:recordTitle(e),participants:clone(e.participants??[]),location:clone(e.location??null),temporal:clone(e.temporal??e.storyTime??e.time??null),awareness:category==='summaryView'?clone(awarenessFor([e.id]).filter(a=>notLater(a)&&awarenessAssociationSupported(a,e))):[]}));
      }
      card.text=card.searchText=fullSearchText(card,description);
      if(card.relatedEvents?.length)card.text=card.searchText+='\n'+card.relatedEvents.map(e=>fullSearchText(e,'')).join('\n');
      const original=originalSourceText(card);
      if(original)card.localSearchText=`${card.searchText}\n${original}`;
      cards.push(card);
    }
  }
  const attached=new Set(cards.filter(c=>c.category!=='awarenessChanges'&&c.category!=='summaryView').flatMap(c=>(c.awareness??[]).map(a=>a.id)));
  for(const card of cards)if(card.category==='awarenessChanges')card.standaloneRecall=!attached.has(card.id);
  return markMemoryStates([...markDiaryHistory(cards), ...knowledge.filter(r => !ignored.has(r.id))]);
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
  return rows.map(a=>`${awarenessSubjectLabel(a)}：${narrativeText(a.knowledge??a.fact??a.content)}〔${awarenessLabel(a.status??a.knowledgeStatus)}；${viaLabel(a.via)}${hasStoryTime(a.learnedAt)?`；获知时间：${narrativeText(a.learnedAt)}`:''}${a.acquisitionEvidence?.method==='context-review-v1'&&a.acquisitionEvidence.access?`；获知范围（不可超出）：${narrativeText(a.acquisitionEvidence.access)}`:''}〕`).join('；');
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
  if(card.stateHistorical)lines.push('这是已被后续记录接续的历史状态，不作当前关系或待履行约定。');
  if(card.stateHistoryIds?.length)lines.push(`当前记录；另有 ${card.stateHistoryIds.length} 条前序依据保留在历史，不重复注入旧状态。`);
  if(card.category==='commitmentChanges'&&card.state==='unknown')lines.push('约定状态待核对：正文已保留，暂不自动注入。可在内容校对中单独修正，无需重新总结。');
  if(card.knowledgeReview?.status==='pending')lines.push('获知依据待核对：暂不把这条作为角色已知信息注入，可在内容校对中单独修正。');
  if(card.category==='conflicts')lines.push('核对参考：保留分歧及原文结论；未解决不作事实，已否认不再当真。不由召回决定谁知情。');
  for(const warning of card.continuityWarnings??[])lines.push(`待确认：${warning}`);
  if(detail&&!full&&card.acquisitionEvidence?.method==='context-review-v1'){
    lines.push(`校对结论：${card.acquisitionEvidence.reason}`);
  }
  if(detail&&!full)for(const e of card.qualityEvidence??[])lines.push(`校对依据${Number.isInteger(e.floor)?` · 第 ${e.floor} 楼`:''}：「${e.quote}」`);
  if (Array.isArray(card.participants)&&card.participants.length)lines.push(`参与人物：${narrativeText(card.participants)}`);
  if (card.location&&!/^(null|undefined|unknown)$/i.test(String(card.location).trim()))lines.push(`地点：${narrativeText(card.location)}`);
  const names=[...(card.participants??[]),...(card.entities??[]).flatMap(e=>typeof e==='string'?[e]:[e.name,...(e.aliases??[])])].filter(n=>typeof n==='string');
  const topics=query===null?[]:tokenizeChinese(query).filter(t=>t.length>1&&!names.some(n=>n.includes(t))&&!/^(什么|怎么|为什么|这次|那个|这个|现在|是否|一下|告诉|关于|他们|她们)$/.test(t));
  const relevant=text=>full||detail||query===null||topics.some(t=>String(text).toLocaleLowerCase().includes(t));
  const viewpoints=(card.viewpoints??[]).filter(v=>relevant(`${v.content} ${v.context??''} ${v.target??''}`)).slice(0,full?Infinity:detail?8:2);
  const dialogues=(detail&&!full||settings.dialogueEnabled!==false?card.keyDialogues??[]:[]).filter(q=>(detail||!q.disabled)&&(relevant(`${q.text} ${q.context??''} ${q.meaning??''}`)||query!==null&&/原话|台词|说过什么/.test(query))).slice(0,full||detail?Infinity:2);
  for(const v of viewpoints)lines.push(`观念 / 态度：${v.holder}${v.target?` 对 ${v.target}`:''}：${v.content}${v.context?`〔${v.context}〕`:''}${v.basis?`（${epistemicLabel(v.basis)}）`:''}`);
  for(const q of dialogues)if(!full||!q.disabled)lines.push(`关键台词：${q.speaker}${q.to?` 对 ${q.to}`:''}：「${q.text}」${q.context?`〔${q.context}〕`:''}${q.meaning?`；体现：${q.meaning}`:''}${q.status==='historical'?'〔过去阶段，不作当前承诺〕':''}${q.disabled?'〔不再注入〕':''}${q.provenance==='user_authored'?'〔用户编写〕':''}`);
  if(dialogues.length)lines.push('原话仅作当时语境的证据，不要求复读；说过不等于仍持相同态度。');
  if(card.category==='performanceHints')lines.push('演绎范围：本条仅证明来源情境中的表现，不凭一次经历推定每次必然如此；与本轮正文及当前阶段不符时不沿用。');
  if(full&&(card.innerLifeHistorical||card.innerLife?.status==='historical'))lines.push(`心迹历程：${card.innerLife.stage}（过去阶段，完整心迹按相关往事召回；不作当前状态）`);
  else if((detail&&!full||settings.journalEnabled!==false)&&innerLifeText(card))lines.push(innerLifeText(card));
  if(detail&&card.detailWarnings?.rejectedDialogues)lines.push(`提取提示：${card.detailWarnings.rejectedDialogues} 句台词未通过原话或说话人校验，未作为逐字引语保存。可在关键对话中人工补充。`);
  if(detail&&card.detailWarnings?.invalidInnerLife)lines.push('提取提示：心迹缺少所属角色、阶段或正文，本条未保存日记内容。');
  if (card.state) lines.push(`状态：${stateLabel(card.state)}`);
  if (card.mergeReview?.status==='pending') {
    lines.push('合并待核对：尚未确认与已有记录为同一次事件，暂存独立；不据此认定发生了两次。');
    if(detail)lines.push(`旧记录发生时间：${narrativeText(card.mergeReview.previousTime)||'未提取'}；本次提取：${narrativeText(card.mergeReview.proposedTime)||'未提取'}`);
  }
  if (card.epistemicStatus && card.epistemicStatus !== 'observed') lines.push(`性质：${epistemicLabel(card.epistemicStatus)}`);
  if (card.category === 'knowledge') lines.push('外部设定资料：当前聊天分支事实优先，原作与计划不等于已经发生或角色已知情。');
  else if (card.category==='awarenessChanges') lines.push(`知情：${awarenessText([card])}`);
  else if (card.awareness?.length) lines.push(`知情：${awarenessText(card.awareness)}`);
  else if(!card.relatedEvents?.some(e=>e.awareness.length)&&(!detail||['events','summaryView'].includes(card.category)))lines.push('本条未关联知情记录，不等于无人知情；不能据此让所有角色知情。');
  if(detail||settings.timeProtection)lines.push(...timeLines(card.temporal,settings));
  if(full&&['awarenessChanges','relationshipChanges','personaChanges','performanceHints'].includes(card.category)&&sourceFloors(card).length)lines.push(`记录${sourceLabel(card)}（来源顺序，不代替生效时间）`);
  if(card.category==='entityFactChanges'){
    // Preserve a chronology anchor even when the model supplied no validity
    // date. A source floor is evidence provenance, not an inferred effective date.
    if(sourceFloors(card).length)lines.push(`属性记录${sourceLabel(card)}`);
    if(Object.hasOwn(card,'from')||Object.hasOwn(card,'oldValue')){
      const previous=Object.hasOwn(card,'from')?card.from:card.oldValue;
      lines.push(`原先取值：${previous===null?'空值（未提供具体旧值）':narrativeText(previous)}`);
    }
    if(hasStoryTime(factValidity(card,'validFrom')))lines.push(`开始适用：${narrativeText(factValidity(card,'validFrom'))}`);
    if(hasStoryTime(factValidity(card,'validUntil')))lines.push(`适用截至：${narrativeText(factValidity(card,'validUntil'))}`);
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
    lines.push(`适用情境与范围：${narrativeText(card.context)}；${narrativeText(scopeLabel(card.scope))}`);
    const validity=card.expiresAt??card.validUntil??card.term??card.duration;
    lines.push(validity?`有效期：${narrativeText(validity)}`:'有效期未确认；仅用于上述对象、情境与范围，不推定永久变化。');
  }else if (card.context || card.validUntil || card.term) lines.push(`适用范围：${narrativeText(card.context)} ${narrativeText(card.validUntil ?? card.term)}`);
  if(full){
    if(card.scope)lines.push(`记录范围：${narrativeText(scopeLabel(card.scope))}`);
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
  cards=cards.filter(c=>!(c.category==='commitmentChanges'&&c.state==='unknown'));
  cards=cards.filter(c=>c.knowledgeReview?.status!=='pending');
  cards=cards.filter(c=>!c.journalOnly||(settings.journalEnabled!==false&&c.innerLife?.text&&!c.innerLife.disabled));
  return cards.filter(c => c.customInject !== false && (includeAwareness||c.category !== 'awarenessChanges'||c.standaloneRecall===true) && !['retracted', 'superseded'].includes(c.lifecycleState) && (c.category !== 'conflicts'||c.sourceRefs?.length>0) && (settings.personaEnabled || !['entityFactChanges','personaChanges','relationshipChanges','awarenessChanges'].includes(c.category)) && (settings.performanceEnabled || c.category !== 'performanceHints') && (settings.knowledgeEnabled || c.category !== 'knowledge')).map(c=>projectSourceForRecall(c,settings.narrativeExtraction));
}
export function prepareRecallIndex(cache, cards, settings, { scopeKey, revision, signal } = {}) {
  if (revision === undefined) throw new Error('recall cache requires a snapshot revision');
  return cache.prepare(selectRecallCards(cards, settings), { scopeKey, revision: { snapshot: revision, persona: settings.personaEnabled, performance: settings.performanceEnabled, knowledge: settings.knowledgeEnabled,journal:settings.journalEnabled,reading:settings.narrativeExtraction??'' }, k1: settings.bm25K1, b: settings.bm25B, signal });
}
export async function recallMemory(cards, query, settings, { vectorAdapter = null, reranker = null, signal, indexCache = null, scopeKey, revision, dictionary=null,focusQuery=query,characterQuery=query,dossierPeople=[],dossierProfiles=[] } = {}) {
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const selected = selectRecallCards(cards, settings);
  const prepared = indexCache ? await prepareRecallIndex(indexCache, selected, settings, { scopeKey, revision, signal }) : null;
  const index = prepared?.index ?? new LocalBM25Index(selected, { k1: settings.bm25K1, b: settings.bm25B });
  const lexicon=dictionary??buildDictionary(selected,{aliases:settings.aliases,automatic:settings.dictionaryEnabled!==false});
  const historyIntent=memoryHistoryIntent(focusQuery);
  const historicalIds=new Set(markMemoryStates(cards,{dictionary:lexicon}).filter(c=>c.stateHistorical).map(c=>c.id));
  // A person's alias expands identity, not every topic in their lifetime.
  const matched=dictionaryQuery(query,lexicon,{expandTopics:false}),q=matched.query;
  const personNames=(lexicon.entries??[]).filter(e=>e.kind==='人物').flatMap(e=>[e.name,...(e.aliases??[])]);
  const queryTokens=tokenizeChinese(sourceEvidenceQuery(dictionaryQuery(focusQuery,lexicon,{expandTopics:false}).query,personNames));
  const evidenceExcerpts=new Map();
  const sourceExcerptFor=record=>{
    if(!evidenceExcerpts.has(record.id))evidenceExcerpts.set(record.id,sourceRecallExcerpt(record,queryTokens,personNames));
    return evidenceExcerpts.get(record.id);
  };
  // Only an actually inserted current dossier can replace the full-person lane.
  // Its historical records remain ordinary searchable candidates, not deleted.
  const canonical=name=>{const matches=(lexicon.entries??[]).filter(e=>!e.disabled&&[e.name,...(e.aliases??[])].some(n=>foldName(n)===foldName(name))&&!(e.ambiguous??[]).some(n=>foldName(n)===foldName(name)));return matches.length===1?matches[0].name:name;};
  const supplied=new Set(dossierPeople.map(name=>foldName(canonical(name))));
  const dossierCoverage=new Map();
  for(const profile of dossierProfiles??[]){
    if(!profile||typeof profile.name!=='string'||!Number.isInteger(profile.through))continue;
    const through=['pending','unreviewed'].includes(profile.reviewStatus)?profile.reviewedThrough:profile.through;
    if(!Number.isInteger(through)||through<0||through>profile.through)continue;
    const key=foldName(canonical(profile.name)),old=dossierCoverage.get(key)??-1;
    if(through>old)dossierCoverage.set(key,through);
  }
  const coveredPersonaHistory=record=>{
    if(historyIntent||!['relationshipChanges','personaChanges','performanceHints'].includes(record.category))return false;
    const floors=sourceFloors(record);if(!floors.length)return false;
    const last=Math.max(...floors);
    // A target's dossier does not certify the other person's attitude. In a
    // directed relationship, only the explicitly recorded actor owns it.
    const owners=record.category==='relationshipChanges'?explicitSubjectNames(record.from??record.subject):characterRecordSubjects(record);
    return owners.length>0&&owners.every(name=>(dossierCoverage.get(foldName(canonical(name)))??-1)>=last);
  };
  const characters=fullCharacterGroups(selectRecallCards(cards,settings,{includeAwareness:true}).filter(c=>(historyIntent||!historicalIds.has(c.id))&&!coveredPersonaHistory(c)),characterQuery,lexicon);
  characters.groups=characters.groups.filter(g=>!supplied.has(foldName(canonical(g.subject))));
  const fullIds=new Set(characters.groups.flatMap(g=>g.records.map(r=>r.id)));
  const tagLanes=settings.tagRecallEnabled===false?[]:matched.tags.map(tag=>({tag,limit:settings.tagCandidateLimit??4}));
  const categoryLanes=settings.distributedEnabled&&settings.distributedStrategy==='broadcast'
    ? [...new Set(selected.filter(c=>!fullIds.has(c.id)).map(c=>c.category))].filter(category=>category!=='summaryView').map(category=>({category,limit:settings.tagCandidateLimit??4})) : [];
  const channelFilter=settings.distributedEnabled&&settings.distributedStrategy==='leader_only'
    ? c=>(c.category==='knowledge'?'knowledge':'memory')===settings.distributedChannel : undefined;
  const filter=c=>(historyIntent||!historicalIds.has(c.id))&&!fullIds.has(c.id)&&!coveredPersonaHistory(c)&&(!channelFilter||channelFilter(c));
  const result = await retrieveMemories({ index, query: q, limit: Math.max(settings.retrievalLimit, settings.retrievalCandidateLimit ?? 24), vectorAdapter, reranker, signal,categoryLanes,filter,
    entityIds:matched.entities,tagLanes,
    totalTimeoutMs: settings.retrievalTimeoutMs,
    vectorTimeoutMs: settings.vectorTimeoutMs, vectorOptions: { rankConstant: settings.fusionRankConstant, localWeight: settings.fusionLocalWeight, vectorWeight: settings.vectorWeight },
    rerankOptions: { timeoutMs: settings.rerankTimeoutMs, maxCandidates: settings.rerankMaxCandidates, sourcePersonNames: personNames } });
  let candidates = [...result.candidates];
  const seen = new Set(); candidates = candidates.filter(c => !seen.has(c.id) && seen.add(c.id));
  candidates=coverLocalQuestionParts(candidates,focusQuery,index,{filter,dictionary:lexicon,limit:settings.retrievalLimit,reranked:result.trace.rerank.status==='passed'});
  // An explicit request for the next agreed schedule needs open commitments,
  // not only earlier scenes mentioning the same people. Reuse stored state;
  // never turn a proposal into completion or infer an unstated appointment.
  if(/接下来|下一步|下一次|接着/u.test(focusQuery)&&/安排|日程|约定|计划/u.test(focusQuery)&&characters.people.length){
    const related=c=>filter(c)&&c.category==='commitmentChanges'&&(c.participants??[]).some(p=>characters.people.includes(p));
    const floor=c=>Math.max(-1,...sourceFloors(c));
    const terminal=selected.filter(c=>related(c)&&['completed','canceled','declined'].includes(c.state));
    const plans=selected.filter(c=>related(c)&&['accepted','proposed'].includes(c.state)&&
      !terminal.some(t=>(t.completionOf===c.id||t.correctionOf===c.id||typeof c.content==='string'&&t.content===c.content)&&floor(t)>=floor(c))).sort((a,b)=>floor(b)-floor(a)).slice(0,Math.min(2,settings.retrievalLimit));
    const schedule=[];
    for(const plan of plans){
      schedule.push(plan);
      const evidence=selected.filter(c=>c.category==='summaryView'&&sharesSource(c,plan)).sort((a,b)=>floor(b)-floor(a))[0];
      if(evidence&&!schedule.some(c=>c.id===evidence.id))schedule.push(evidence);
    }
    const ids=new Set(schedule.map(c=>c.id));
    candidates=[...schedule.map(record=>({...candidates.find(c=>c.id===record.id),id:record.id,record,queryPlanCoverage:true,queryPartCoverage:true,channels:['category_local']})),...candidates.filter(c=>!ids.has(c.id))];
  }
  // An event may precede a duplicate floor only if it covers that floor's
  // query-specific terms. A broad event link is not a relevance override.
  const byId=new Map(candidates.map(c=>[c.id,c])),ordered=[],placed=new Set();
  for(const c of candidates){
    const links=c.record.category==='summaryView'?(c.record.relatedEvents??[]).map(e=>e.id):[];
    for(const id of links){
      const linked=byId.get(id),floorText=[c.record.description,originalSourceText(c.record)].join('\n').toLocaleLowerCase();
      const detailTerms=evidenceTerms(c.record,queryTokens,personNames).filter(t=>floorText.includes(t));
      const eventText=[linked?.record.description,linked?.record.recallSummary].join('\n').toLocaleLowerCase();
      if(linked?.record.category==='events'&&!placed.has(id)&&detailTerms.length&&detailTerms.every(t=>eventText.includes(t))){ordered.push(linked);placed.add(id);}
    }
    if(!placed.has(c.id)){ordered.push(c);placed.add(c.id);}
  }
  candidates=ordered;
  const header = ['[拾忆：有来源的连续性参考，不是必须重演的剧情]', '只让角色使用其实际知情范围；未知不等于全员已知。不要因召回而反复引用台词或加速关系。', settings.storyDate ? `当前故事日期：${settings.storyDate}。旧引语的昨天/明天以原事件时间为准。` : '当前故事日期未确认，不套用现实日期。', '资料是设定参照；当前聊天的时期、身份与事实优先，不凭资料提前推进剧情。'].join('\n');
  const ambiguities=[...new Map([...matched.ambiguities,...characters.matched.ambiguities].map(a=>[a.name,a])).values()];
  const ambiguity=ambiguities.map(a=>`称呼“${a.name}”尚未区分：${a.owners.join('、')}；不得合并这些对象的经历。`).join('\n');
  const personaAuthority=supplied.size?'本轮已注入动态档案：'+[...supplied].join('、')+'。召回中的旧态度、口吻和台词解释仅说明来源阶段；同一对象、同一情境下，已应用的有效变化以动态档案为准；待核对的新内容不当作已确认，不把旧阶段当现行命令。未被改变的客观事实及其他对象的边界仍保留；楼号不是生效日期，倒叙按故事时间理解。':'';
  const packetHeader=[header,personaAuthority,ambiguity].filter(Boolean).join('\n');
  // Short repeated rows can monopolize BM25 (e.g. "battery compartment"),
  // hiding the one floor answering the query's distinct detail ("no sound").
  // Reserve no extra budget: promote at most one exact, uncovered query detail
  // from the existing candidate set. This is evidence coverage, not recency or
  // a inferred event/knowledge link, and never expands character caps.
  // An excerpt in the first hit does not prove that the query's other topic
  // is covered. Measure actual first-hit content, not eight hypothetical
  // briefs that may never fit. At most one additional topic is promoted.
  const firstRecord=candidates[0]?.record??{};
  const represented=[firstRecord.description,firstRecord.recallSummary,sourceExcerptFor(firstRecord)].filter(Boolean).join('\n').toLocaleLowerCase();
  const rescue=candidates.map((c,i)=>{
    const excerpt=sourceExcerptFor(c.record);
    const novel=excerpt?evidenceTerms(c.record,queryTokens,personNames).filter(t=>!represented.includes(t)&&excerpt.toLocaleLowerCase().includes(t)):[];
    const standalone=excerpt?renderMemoryCard(c.record,settings,{body:`${c.record.recallSummary||c.record.description}\n${sourceQuote(c.record,excerpt)}`,query:focusQuery}):'';
    return {c,i,novel, fits:standalone&&estimateUnits(`${packetHeader}\n\n${standalone}`)<=settings.retrievalBudgetUnits};
  }).filter(r=>r.novel.length&&r.fits).sort((a,b)=>b.novel.length-a.novel.length||a.i-b.i)[0];
  if(rescue)candidates=[{...rescue.c,queryCoverageRescue:true},...candidates.filter(c=>c.id!==rescue.c.id)];
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
      parts.push(renderMemoryCard({...record,innerLife:null,innerLifeHistorical:false},{...settings,timeProtection:true},{body:record.description,detail:true,full:true}));
      characterChosen.push({record,body:record.description});packed.push(record);
      decisions.push({...decision,status:'selected',detail:'full_character'});
    }
    if(parts.length)characterParts.push(`[人物档案：${group.subject}]\n${parts.join('\n\n')}`);
  }
  const diaryRows=settings.journalEnabled===false?[]:characterKeepsakes(characterChosen.map(r=>r.record),{withExpected:false}).diaries;
  const oldDiaryQuery=/当初|以前|过去|当时|日记|心迹|心路|阶段|为什么.*(?:信任|喜欢|拒绝)/u.test(focusQuery);
  const diaryText=diaryRows.filter(r=>!r.data.disabled&&(oldDiaryQuery||!r.record.innerLifeHistorical&&r.data.status!=='historical')).map(r=>innerLifeText({...r.record,innerLife:{...r.data,...(r.record.innerLifeHistorical?{status:'historical'}:{})}})).filter(Boolean).join('\n\n');
  if(diaryText)characterParts.push(diaryText);
  // Count/length limits apply only to retrieved history, not to dossiers.
  // The header is charged once to history as before; dossiers cannot consume
  // the event allowance even when their full text exceeds it.
  const characterText=characterParts.length?['[本轮涉及人物的完整档案；提及不等于在场，资料不自动赋予其他角色知情权。不同时间、对象与情境的记录按各自条件使用，不把变化历史视为同时生效。]',...characterParts].join('\n\n'):'';
  let memoryCount=0;
  let excerpts=0;
  const budget = settings.retrievalBudgetUnits;
  const nameOnly=nameOnlyRecallCandidates(candidates,focusQuery,lexicon,result.trace.rerank.status==='passed'?(result.trace.rerank.scores??[]).map(s=>s.id):[]);
  for (const item of candidates) {
    // Disputes/corrections must retain the full qualification and outcome;
    // a short label could repeat a denied claim while omitting its denial.
    const brief=item.record.category==='conflicts'?item.record.description:typeof item.record.recallSummary==='string'&&item.record.recallSummary.trim()?item.record.recallSummary:item.record.description;
    // Detail is driven by the original request, not by available space or
    // expanded alias names. Store/search the full narrative without sending it.
    const excerpt=item.record.category==='conflicts'?'':relevantPassage(item.record.description,item.record.recallSummary,focusQuery);
    const sourceExcerpt=item.queryPlanCoverage&&item.record.category==='summaryView'?originalSourceText(item.record):sourceExcerptFor(item.record);
    const body=[excerpt?`${brief}\n相关经过：${excerpt}`:brief,sourceExcerpt?sourceQuote(item.record,sourceExcerpt):''].filter(Boolean).join('\n');
    const coveredBy=coveredRecallRecord(item.record,body,chosen);
    const decision={id:item.id,title:recordTitle(item.record),category:item.record.category,reason:item.queryCoverageRescue?'原文补充未覆盖的检索细节':item.queryPartCoverage?'分别覆盖本轮的问题':recallSelectionReason(item),scores:{keyword:item.localScore??null,vector:item.vectorScore??null,fusion:item.fusionScore??null,final:item.score??null}};
    if(nameOnly.has(item.id)&&!sourceExcerpt&&!item.queryPlanCoverage){omitted.push(item.id);decisions.push({...decision,status:'name_only'});continue;}
    if(coveredBy){decisions.push({...decision,status:'duplicate',coveredBy});omitted.push(item.id);continue;}
    let part = renderMemoryCard(item.record, settings,{body,query:focusQuery});
    const candidatePacket=()=>compileEventPacket([...packetEntries,{record:item.record,text:part}]);
    let trial=candidatePacket();
    let usedBody=body,usedExcerpt=Boolean(excerpt||sourceExcerpt);
    if(estimateUnits(`${packetHeader}\n\n${trial.text}`)>budget&&(excerpt||sourceExcerpt)){
      // If only the source contains the query's detail, never substitute an
      // irrelevant brief and claim that detail was recalled.
      // Naming the queried object does not prove the brief retained its
      // conditions. Never replace a source-backed restriction with a shorter
      // potentially unconditional claim merely to fit the history budget.
      if(sourceExcerpt){omitted.push(item.id);decisions.push({...decision,status:'budget',detail:'source_evidence_omitted'});continue;}
      part=renderMemoryCard(item.record,settings,{body:brief,query:focusQuery});usedBody=brief;usedExcerpt=false;trial=candidatePacket();
    }
    if (memoryCount >= settings.retrievalLimit || estimateUnits(`${packetHeader}\n\n${trial.text}`) > budget) { omitted.push(item.id);decisions.push({...decision,status:memoryCount>=settings.retrievalLimit?'limit':'budget'});continue; }
    packed.push(item.record);packetEntries.push({record:item.record,text:part});chosen.push({record:item.record,body:usedBody});content = `${packetHeader}\n\n${trial.text}`;
    memoryCount++;
    if(usedExcerpt)excerpts++;
    decisions.push({...decision,status:'selected',detail:sourceExcerpt&&usedExcerpt?'source_evidence':usedExcerpt?'excerpt':'brief',detailOmitted:Boolean(excerpt||sourceExcerpt)&&!usedExcerpt});
  }
  const memoryUnits=memoryCount?estimateUnits(content):0;
  const eventPacket=compileEventPacket(packetEntries);
  // Dossiers include each actor's knowledge in full. A knowledge row selected
  // there must not become an unexplained “knows about it” when its event falls
  // outside ordinary top-K. Resolve only the already checked explicit links,
  // locally, once per event, and never re-enable hidden/deleted event cards.
  const packedIds=new Set(packed.map(r=>r.id)),eventLookup=new Map(selected.filter(c=>c.category==='events').map(c=>[c.id,c]));
  const relevantContextIds=new Set(candidates.filter(c=>!nameOnly.has(c.id)).map(c=>c.id));
  const knowledgeContext=new Map(),unresolvedKnowledge=[];
  const recalledKnowledge=new Map(packed.flatMap(c=>c.category==='awarenessChanges'?[c]:(c.awareness??[])).map(row=>[row.id,row]));
  for(const row of recalledKnowledge.values()){
    const ids=[...new Set([row.eventRef,row.eventId,row.sourceEventId,row.recordRef,...(row.eventRefs??[])].filter(Boolean))];
    let resolved=false;
    for(const id of ids){
      const event=eventLookup.get(id);
      if(!event||!(event.awareness??[]).some(a=>a.id===row.id))continue;
      resolved=true;
      // Full dossiers can mention a lifetime of unrelated facts. Concrete
      // propositions already explain themselves; don't import all those past
      // events merely because the holder's name appeared. Vague legacy rows
      // need their explicit referent even if it missed ordinary retrieval.
      const vague=/^(?:(?:知道|了解|听说|得知|不知|不清楚|明白|目睹|获知)了?)?(?:这|那|此|该|相关|某|一些|整个|具体|其中|发生的|之前的|所有|的|个|件)*(?:事|事情|事件|情况|详情|经过|秘密|信息|内容|真相)[。.!！]?$/u.test(String(row.knowledge??'').trim());
      if(!packedIds.has(id)&&(relevantContextIds.has(id)||vague))knowledgeContext.set(id,event);
    }
    if(!resolved)unresolvedKnowledge.push(row.id);
  }
  const contextText=knowledgeContext.size?['[知情所指的事件背景：仅解释具体事实的来龙去脉，不扩大任何角色的知情范围；知情状态仍以人物条目为准。]',...[...knowledgeContext.values()].map(event=>renderMemoryCard(event,{...settings,timeProtection:true},{body:event.recallSummary||event.description,query:focusQuery}))].join('\n\n'):'';
  // The important-dialogue lane is another injection route over the same
  // records. Apply the dossier coverage rule here too, or covered relationship
  // history returns after ordinary retrieval correctly filtered it out.
  const dialogueSource=selected.filter(record=>!coveredPersonaHistory(record));
  const dialoguePacket=settings.dialogueEnabled===false?{rows:[],text:''}:importantDialoguePacket(dialogueSource,characterQuery,lexicon,[characterText,eventPacket.text,contextText].join('\n'));
  const dialogueCards=[...new Map(dialoguePacket.rows.map(r=>[r.recordId,r.record])).values()].filter(c=>!packedIds.has(c.id)&&!knowledgeContext.has(c.id));
  content=packed.length||dialoguePacket.rows.length?[packetHeader,characterText,eventPacket.text,contextText,dialoguePacket.text].filter(Boolean).join('\n\n'):'';
  result.trace.importantDialogues={count:dialoguePacket.rows.length,units:estimateUnits(dialoguePacket.text),extraModelCalls:0};
  result.trace.personaAuthority={people:[...dossierCoverage.keys()],suppressedIds:selected.filter(coveredPersonaHistory).map(c=>c.id),historicalQuery:historyIntent,extraModelCalls:0};
  for(const c of dialogueCards)decisions.push({id:c.id,title:recordTitle(c),category:c.category,status:'selected',detail:'important_dialogue',reason:'人物重要对话'});
  result.trace.index = prepared?.stats ?? { status: 'uncached', size: selected.length };
  result.trace.dictionary={matched:matched.terms,ambiguous:lexicon.entries.filter(e=>e.ambiguous.length).length};
  result.trace.evidence={quarantinedLinks:selected.reduce((n,c)=>n+(c.associationReviewCount??0),0)};
  result.trace.characters={mode:'full',people:[...new Set(characters.groups.map(g=>g.subject))],records:characterChosen.length,units:estimateUnits(characterText),truncated:false};
  result.trace.knowledgeContext={eventIds:[...knowledgeContext.keys()],units:estimateUnits(contextText),unresolvedRecordIds:unresolvedKnowledge,mode:'explicit_link_brief',extraModelCalls:0};
  for(const event of knowledgeContext.values())decisions.push({id:event.id,title:recordTitle(event),category:'events',status:'selected',detail:'knowledge_context',reason:'解释已注入知情的明确关联事件'});
  result.trace.packing={selected:packed.length+knowledgeContext.size+dialogueCards.length,memorySelected:memoryCount,memoryUnits,expanded:0,excerpts,brief:memoryCount-excerpts,omitted:omitted.length,duplicates:decisions.filter(d=>d.status==='duplicate').length,decisions};
  result.trace.packing.eventPacket={groups:eventPacket.groups,groupedRecords:eventPacket.groupedRecords,sharedLines:eventPacket.sharedLines,beforeChars:eventPacket.beforeChars,afterChars:eventPacket.afterChars,savedChars:eventPacket.savedChars};
  result.trace.timings.recallMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
  return { status: 'preview', previewOnly: true, sent: false, degraded: result.trace.degraded, text: content, cards: [...packed,...knowledgeContext.values(),...dialogueCards], usedUnits: content ? estimateUnits(content) : 0, omitted, trace: result.trace };
}
