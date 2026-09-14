import { tokenizeChinese } from './retrieval.js';

// Only narrative is speech evidence. Planning and variable patches may quote
// things that were never said, or contain a character's private thoughts.
export function evidenceWithoutPlanning(value) {
  let text=String(value??'');
  text=text.replace(/<(?:think|thinking|analysis|konatan_planning~)>[\s\S]*?<\/(?:think|thinking|analysis|konatan_planning~)>/gi,'');
  const orphan=/<\/(?:think|thinking|konatan_planning~)>/i.exec(text);
  if(orphan)text=text.slice(orphan.index+orphan[0].length);
  return text;
}
export function narrativeEvidence(value) {
  const text=evidenceWithoutPlanning(value).replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi,'');
  const body=/^\s*<content>\s*\r?\n([\s\S]*?)<\/content>/mi.exec(text);
  return body?body[1]:text;
}

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
  const spans = String(evidence).match(/“[^”]{1,12000}”|「[^」]{1,12000}」|『[^』]{1,12000}』|"[^"]{1,12000}"/gu) ?? [];
  return spans.some(span => span.slice(1, -1).includes(quote));
}

export function hasSpeechEvidence(evidence,quote,speaker){
  evidence=narrativeEvidence(evidence);
  if(!String(evidence).includes(speaker)||!String(evidence).includes(quote))return false;
  // GAL pairs have an explicitly attributed Japanese line AND a Chinese
  // translation. Neither unrelated speakers nor narrator brackets qualify.
  const gal=/^\s*([^\r\n「〔【]{1,160}?)\s*(?:【[^】\r\n]*】\s*)?「[^」]{1,12000}」\s*〔([^〕]{1,12000})〕/gmu;
  const pairs=[...String(evidence).matchAll(gal)];
  if(pairs.some(m=>m[2].includes(quote)))return pairs.some(m=>m[1].trim()===speaker&&m[2].includes(quote));
  if(hasQuotedEvidence(evidence,quote))return true;
  // No narrator-substring promotion: unquoted dialogue must have an explicit
  // same-line speaker and speech marker. Newline continuations need quotes.
  const escaped=speaker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const start=new RegExp(`^\\s*${escaped}(?:\\s*(?:对|向)[^：:\\n]{1,80})?\\s*(?:说(?:道)?|说道|回答|答道|问道|问|喊道|喊|回应)?\\s*[：:]\\s*(.+)$`,'u');
  return String(evidence).split(/\r?\n/).some(line=>{const m=start.exec(line);return m&&m[1]===quote;});
}

export function bindKnowledgeEvidence(record,evidence,{actorNames=[],narrativeText=null}={}){
  if(record.acquisitionEvidence===undefined)return record; // legacy records remain readable
  const quote=record.acquisitionEvidence?.quote,person=record.person??record.actorId??record.personId;
  const text=typeof narrativeText==='string'?narrativeText:narrativeEvidence(evidence);
  // Accept only explicitly declared, unambiguous aliases from this source.
  // No suffix guessing, pronoun resolution, or unverified dictionary aliases.
  const declarations=[...text.matchAll(/([\p{L}\p{N}·]{1,40})的(?:昵称|别名|别称|简称|小名)是[“「"]?([\p{L}\p{N}·]{1,20})[”」"]?(?=[，。；\s]|$)/gu)];
  const names=typeof person==='string'?[person,...actorNames,...declarations.filter(m=>m[1]===person&&!declarations.some(other=>other[2]===m[2]&&other[1]!==person)).map(m=>m[2])]:[];
  const valid=typeof quote==='string'&&quote.trim().length>=2&&quote.length<=4000&&text.includes(quote)&&names.some(name=>quote.includes(name));
  return {...record,acquisitionEvidence:valid?{quote}:null,
    knowledgeReview:valid?null:{status:'pending',reason:'acquisition_evidence_missing'}};
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
