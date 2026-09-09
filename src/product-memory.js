import { LocalBM25Index, retrieveMemories } from './retrieval.js';
import { estimateUnits, clone } from './utils.js';

export const CATEGORY_LABELS = Object.freeze({ events: '事件', awarenessChanges: '知情', entityFactChanges: '人物与事实', relationshipChanges: '关系', personaChanges: '人设变化', commitmentChanges: '约定', performanceHints: '演绎参考', summaryView: '楼层摘要', conflicts: '待核对', knowledge: '资料' });
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
  const awarenessFor = dependencyIndex(records.awarenessChanges ?? [], a => [a.eventRef, ...(a.eventRefs ?? [])]);
  const followUpsFor = dependencyIndex(records.commitmentChanges ?? [], a => [a.eventRef, a.completionOf, a.correctionOf, ...(a.eventRefs ?? [])]);
  for (const category of Object.keys(CATEGORY_LABELS)) {
    if (category==='knowledge'||category==='awarenessChanges'&&!includeAwareness)continue;
    for (const record of records[category] ?? []) {
      if (ignored.has(record.id) || ['retracted', 'superseded'].includes(record.lifecycleState)) continue;
      const refIds = new Set([record.id, record.eventRef, ...(record.eventRefs ?? [])].filter(Boolean));
      const awareness = awarenessFor(refIds);
      const followUps = followUpsFor(refIds).filter(a => a.id !== record.id);
      const description = recordDescription(record);
      cards.push({ ...clone(record), id: record.id, category, description, text: description, awareness, followUps, temporal: record.temporal ?? record.storyTime ?? record.time ?? null });
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
  if (!d || !current) return readable(value);
  const delta = Math.round((d.n - current.n) / 86400000);
  const relative = ({ '-2': '前天', '-1': '昨天', 0: '今天', 1: '明天', 2: '后天' })[delta] ?? `${Math.abs(delta)}天${delta < 0 ? '前' : '后'}`;
  return `${d.text}（${relative}）`;
}
export function renderMemoryCard(card, settings = {}) {
  const lines = [`[${CATEGORY_LABELS[card.category] ?? '记忆'}] ${card.description}`];
  if (card.state) lines.push(`状态：${({ proposed: '提出', attempted: '尝试', accepted: '接受', completed: '完成', declined: '拒绝', canceled: '取消' })[card.state] ?? card.state}`);
  if (card.epistemicStatus && card.epistemicStatus !== 'observed') lines.push(`性质：${({ user_asserted: '用户确认', inferred: '推测而非事实', character_claim: '角色自述', unknown: '未确认' })[card.epistemicStatus] ?? card.epistemicStatus}`);
  if (card.category === 'knowledge') lines.push('外部设定资料，不等于角色已经历或已知情。');
  else if (card.awareness?.length) lines.push(`知情：${card.awareness.map(a => `${readable(a.actorId ?? a.person ?? a.audience)}=${readable(a.knowledge ?? a.fact ?? a.content)}〔${a.status}；${a.via}〕`).join('；')}`);
  else lines.push('知情范围未确认，不据此让未获知的角色知情。');
  if (settings.timeProtection && card.temporal) {
    const t = card.temporal;
    if (typeof t === 'string') lines.push(`故事时间：${relativeStoryDate(t, settings.storyDate)}`);
    else for (const [key, label] of [['assertedAt','作出表述'], ['occurredAt','事件发生'], ['plannedFor','原定'], ['actualAt','实际发生']]) if(t[key]) lines.push(`${label}：${relativeStoryDate(t[key], settings.storyDate)}`);
  }
  for (const f of card.followUps ?? []) lines.push(`后续：${recordDescription(f)}〔${f.state ?? '未确认'}〕`);
  if (card.context || card.validUntil || card.term) lines.push(`适用范围：${readable(card.context)} ${readable(card.validUntil ?? card.term)}`);
  return lines.join('\n');
}
export function expandAliases(query, aliases = '') {
  let out = query;
  for (const line of aliases.split('\n')) { const names = line.split(/[=,，]/).map(s => s.trim()).filter(Boolean); if (names.length && names.some(n => query.includes(n))) out += ` ${names.join(' ')}`; }
  return out;
}
export function selectRecallCards(cards, settings) {
  return cards.filter(c => c.customInject !== false && c.category !== 'awarenessChanges' && !['retracted', 'superseded'].includes(c.lifecycleState) && c.category !== 'conflicts' && (settings.personaEnabled || !['entityFactChanges','personaChanges','relationshipChanges'].includes(c.category)) && (settings.performanceEnabled || c.category !== 'performanceHints') && (settings.knowledgeEnabled || c.category !== 'knowledge'));
}
export function prepareRecallIndex(cache, cards, settings, { scopeKey, revision, signal } = {}) {
  if (revision === undefined) throw new Error('recall cache requires a snapshot revision');
  return cache.prepare(selectRecallCards(cards, settings), { scopeKey, revision: { snapshot: revision, persona: settings.personaEnabled, performance: settings.performanceEnabled, knowledge: settings.knowledgeEnabled }, k1: settings.bm25K1, b: settings.bm25B, signal });
}
export async function recallMemory(cards, query, settings, { vectorAdapter = null, reranker = null, signal, indexCache = null, scopeKey, revision } = {}) {
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const selected = selectRecallCards(cards, settings);
  const prepared = indexCache ? await prepareRecallIndex(indexCache, selected, settings, { scopeKey, revision, signal }) : null;
  const index = prepared?.index ?? new LocalBM25Index(selected, { k1: settings.bm25K1, b: settings.bm25B });
  const q = expandAliases(query, settings.aliases);
  const result = await retrieveMemories({ index, query: q, limit: Math.max(settings.retrievalLimit, settings.retrievalCandidateLimit ?? 24), vectorAdapter, reranker, signal,
    totalTimeoutMs: settings.retrievalTimeoutMs,
    vectorTimeoutMs: settings.vectorTimeoutMs, vectorOptions: { rankConstant: settings.fusionRankConstant, localWeight: settings.fusionLocalWeight, vectorWeight: settings.vectorWeight },
    rerankOptions: { timeoutMs: settings.rerankTimeoutMs, maxCandidates: settings.rerankMaxCandidates } });
  // Entity facts are an explicit metadata lane, not another model call.
  const identities = selected.filter(c => c.category === 'entityFactChanges' && readable(c.entity ?? c.entityId).length > 0 && q.includes(readable(c.entity ?? c.entityId)));
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
  let content = header;
  const packed = [], omitted = [];
  const budget = settings.retrievalBudgetUnits;
  for (const item of candidates) {
    const part = renderMemoryCard(item.record, settings);
    if (packed.length >= settings.retrievalLimit || estimateUnits(`${content}\n\n${part}`) > budget) { omitted.push(item.id); continue; }
    packed.push(item.record); content += `\n\n${part}`;
  }
  if (!packed.length) content = '';
  result.trace.index = prepared?.stats ?? { status: 'uncached', size: selected.length };
  result.trace.timings.recallMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
  return { status: 'preview', previewOnly: true, sent: false, degraded: result.trace.degraded, text: content, cards: packed, usedUnits: content ? estimateUnits(content) : 0, omitted, trace: result.trace };
}
