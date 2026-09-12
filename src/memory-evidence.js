import { tokenizeChinese } from './retrieval.js';

// Read-time compatibility: an explicit top-level null still means unknown.
export function factValidity(record, field) {
  return Object.hasOwn(record, field) ? record[field] : record.temporal?.[field];
}

export function normalizeFactValidity(record) {
  const result = { ...record };
  for (const key of ['validFrom', 'validUntil']) {
    if (!Object.hasOwn(result, key) && result.temporal && Object.hasOwn(result.temporal, key)) result[key] = result.temporal[key];
  }
  return result;
}

export function hasQuotedEvidence(evidence, quote) {
  // Substrings in narrator prose are not direct speech. Do not change or
  // fabricate an original line just to satisfy the quotation field.
  const spans = String(evidence).match(/[“「『"][^”」』"\n]{1,4000}[”」』"]/gu) ?? [];
  return spans.some(span => span.slice(1, -1).includes(quote));
}

const generic = /^(知道|不知|知情|得知|已经|此前|之前|当时|位置|信息|事情|内容|消息|他们|她们|没有|不能|明确|现在|相关|带来|来了|带了)$/;
export function topicalTokens(text, names = []) {
  let body = String(text ?? '').toLocaleLowerCase();
  for (const name of [...names].filter(n => typeof n === 'string' && n).sort((a, b) => b.length - a.length)) body = body.split(name.toLocaleLowerCase()).join(' ');
  return [...new Set(tokenizeChinese(body).filter(t => t.length > 1 && !generic.test(t)))];
}

// Conservative isolation, not automatic reassignment: preserve the knowledge
// row, but don't distribute it through an unrelated event. A later disclosure
// can legitimately refer to an earlier event, so source overlap isn't required.
export function awarenessAssociationSupported(row, event) {
  if (!row.sourceRefs?.length || !event.sourceRefs?.length) return true; // insufficient evidence, keep legacy behavior
  if (row.sourceRefs.some(a => event.sourceRefs.some(b => a.sourceId === b.sourceId && a.fragmentId === b.fragmentId))) return true;
  const names = [...(event.participants ?? []), row.actorId, row.person,
    ...(event.entities ?? []).filter(e => e.kind === '人物').map(e => e.name)];
  const terms = topicalTokens(row.knowledge ?? row.fact ?? row.content, names);
  if (!terms.length) return true;
  const text = [event.title, event.description, event.action, event.object, event.recallSummary].filter(Boolean).join('\n').toLocaleLowerCase();
  return terms.some(t => text.includes(t));
}
