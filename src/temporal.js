import { clone, normalizeText, stableStringify } from './utils.js';

export const TEMPORAL_FIELDS = Object.freeze(['assertedAt', 'occurredAt', 'plannedFor', 'actualAt', 'anchorRef']);

export function hasStoryTime(value) {
  if(value==null)return false;
  if(typeof value==='string')return Boolean(value.trim())&&!/^(?:unknown|null|未明确|原文未明确|未知|不详)$/i.test(value.trim());
  if(typeof value!=='object'||Array.isArray(value)||value.kind==='unknown')return false;
  return ['date','time','period','raw','occurredAt','assertedAt','plannedFor','actualAt','start','end'].some(k=>hasStoryTime(value[k]));
}

// Precision is an interval, not string equality. No real-world clock, locale
// parsing or guessed year is used; unparseable periods remain unverified.
export function storyTimeRange(value) {
  if(!hasStoryTime(value))return null;
  if(typeof value==='object'){
    if(value.start!=null&&value.end!=null){const a=storyTimeRange(value.start),b=storyTimeRange(value.end);return joinTimeRange(a,b);}
    value=value.date?`${value.date}${value.time?' '+value.time:value.period?' '+value.period:''}`:value.raw??value.period??value.occurredAt;
  }
  if(typeof value!=='string')return null;
  const text=value.trim().replace(/年|月/g,'-').replace(/日|号/g,'').replace(/\//g,'-').replace(/：/g,':');
  // Explicit end points only. Do not infer a next day for a reversed clock.
  const interval=/^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:[-–—~～至到])\s*((?:\d{4}-\d{1,2}-\d{1,2}\s+)?\d{1,2}:\d{2}(?::\d{2})?)$/.exec(text);
  if(interval)return joinTimeRange(storyTimeRange(`${interval[1]} ${interval[2]}`),storyTimeRange(/^\d{4}-/.test(interval[3])?interval[3]:`${interval[1]} ${interval[3]}`));
  const m=/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?)?)?(?:\s*([\u3400-\u9fff]{1,12}))?$/.exec(text);
  if(!m)return null;
  const year=Number(m[1]),month=Number(m[2]??1),day=Number(m[3]??1),hour=Number(m[4]??0),minute=Number(m[5]??0),second=Number(m[6]??0),millisecond=Number((m[7]??'').padEnd(3,'0'));
  const startDate=new Date(0);startDate.setUTCFullYear(year,month-1,day);startDate.setUTCHours(hour,minute,second,millisecond);
  if(startDate.getUTCFullYear()!==year||startDate.getUTCMonth()!==month-1||startDate.getUTCDate()!==day||hour>23||minute>59||second>59)return null;
  const endDate=new Date(startDate);
  if(!m[2])endDate.setUTCFullYear(year+1);else if(!m[3])endDate.setUTCMonth(month);else if(!m[4])endDate.setUTCDate(day+1);
  const precision=m[7]?'millisecond':m[6]?'second':m[4]?'minute':m[3]?'day':m[2]?'month':'year';
  const start=startDate.getTime(),end=m[4]?start+(m[7]?1:m[6]?1000:60000):endDate.getTime();
  let offset=null;
  if(m[8]){
    const z=m[8]==='Z'?null:/^([+-])(\d{2}):?(\d{2})$/.exec(m[8]);
    if(z&&(Number(z[2])>14||Number(z[3])>59||Number(z[2])===14&&Number(z[3])!==0))return null;
    offset=z?(z[1]==='-'?-1:1)*(Number(z[2])*60+Number(z[3]))*60000:0;
  }
  return {start,end,offset,precision,qualifier:m[9]??null};
}

function joinTimeRange(a,b){
  if(!a||!b||a.offset!==b.offset||b.start<a.start)return null;
  return {start:a.start,end:b.end,offset:a.offset,precision:'range',qualifier:null};
}

export function storyDateOf(value){
  const time=storyTimeRange(value);
  if(!time||['year','month'].includes(time.precision))return null;
  const start=new Date(time.start).toISOString().slice(0,10),end=new Date(time.end-1).toISOString().slice(0,10);
  return start===end?start:null;
}

/** Only the live scene text supplies "now", never the maximum recalled date.
 * Multiple dates (flashbacks/plans/quotes) stay ambiguous without an explicit
 * scene marker. Callers keep this derived value inside their chat workspace. */
export function sceneClock(text=''){
  const clean=String(text).replace(/<(think|thinking)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  const pattern=/\d{4}(?:年|[-/])\d{1,2}(?:月|[-/])\d{1,2}(?:日|号)?(?:[ T]+\d{1,2}[:：]\d{2}(?:\s*[-–—~～至到]\s*\d{1,2}[:：]\d{2})?)?/g;
  const anchors=[];
  for(const line of clean.split(/\n/))if(/(?:当前(?:剧情|故事|场景)?(?:时间|日期)|故事(?:时间|日期)|场景(?:时间|日期)|<time\b|\[时间\]|🕒|🕐|🕰)/i.test(line)&&!/(?:回忆|约定|计划|预计)/.test(line))anchors.push(...(line.match(pattern)??[]));
  const values=anchors.length?anchors:clean.match(pattern)??[];
  const dates=[...new Set(values.map(storyDateOf).filter(Boolean))];
  if(dates.length!==1||!anchors.length&&/(?:回忆|倒叙|去年|约定|计划|明天|昨日|昨天)/.test(clean))return {date:null,status:dates.length?'ambiguous':'unknown',source:'scene'};
  return {date:dates[0],raw:values.at(-1),status:'known',source:'scene'};
}

export function sceneClockFromMessages(messages=[]){
  for(const message of [...messages].reverse()){
    if(message.role==='system')continue;
    const body=message.text??message.content??'';
    if(typeof body!=='string')continue;
    const clock=sceneClock(body);
    if(clock.status!=='unknown')return clock;
    // An explicit jump without a date invalidates an earlier scene anchor.
    if(/(?:第二天|次日|翌日|数日后|几天后|一年后|一年[前后]|时间[跳倒]转)/.test(body))return {date:null,status:'ambiguous',source:'scene'};
  }
  return {date:null,status:'unknown',source:'scene'};
}

export function compareStoryTimes(a,b) {
  if(!hasStoryTime(a)||!hasStoryTime(b))return 'compatible';
  if(stableStringify(a)===stableStringify(b))return 'compatible';
  const x=storyTimeRange(a),y=storyTimeRange(b);
  if(!x||!y)return 'unresolved';
  const zoned=x.offset!==null&&y.offset!==null;
  if(Math.max(x.start-(zoned?x.offset:0),y.start-(zoned?y.offset:0))>=Math.min(x.end-(zoned?x.offset:0),y.end-(zoned?y.offset:0)))return 'conflict';
  if(x.qualifier&&y.qualifier&&x.qualifier!==y.qualifier||x.qualifier&&['minute','second','millisecond'].includes(y.precision)||y.qualifier&&['minute','second','millisecond'].includes(x.precision))return 'unresolved';
  return 'compatible';
}

export function preciseStoryTime(previous,next) {
  if(!hasStoryTime(next))return clone(previous??null);
  const a=storyTimeRange(previous),b=storyTimeRange(next);
  if(a&&b&&compareStoryTimes(previous,next)==='compatible'&&(a.end-a.start<b.end-b.start||a.end-a.start===b.end-b.start&&a.qualifier&&!b.qualifier))return clone(previous);
  return clone(next);
}

/** Keep asserted/story/planned/actual times separate; never collapse them to createdAt. */
export function normalizeTemporalFact(value = {}, { sourceRefs = [] } = {}) {
  const input = value && typeof value === 'object' ? value : { raw: value };
  return {
    assertedAt: input.assertedAt ?? null,
    occurredAt: input.occurredAt ?? null,
    plannedFor: input.plannedFor ?? null,
    actualAt: input.actualAt ?? null,
    anchorRef: input.anchorRef ?? null,
    raw: input.raw ?? (typeof value === 'string' ? value : null),
    sourceRefs: clone(input.sourceRefs ?? sourceRefs),
    certainty: input.certainty ?? (input.occurredAt ? 'asserted' : 'unknown'),
  };
}

function identityOf(record) {
  return record?.identityKey ?? record?.eventIdentity ?? record?.id ?? record?.event?.id ?? null;
}

/** Conflicting story times are diagnostic candidates; they do not rewrite either source. */
export function detectTemporalConflicts(records = []) {
  const groups = new Map();
  for (const record of records) {
    const identity = identityOf(record);
    if (!identity) continue;
    const temporal = normalizeTemporalFact(record.temporal ?? record.storyTime ?? record.event?.storyTime ?? {});
    const value = stableStringify({ occurredAt: temporal.occurredAt, plannedFor: temporal.plannedFor, actualAt: temporal.actualAt });
    const group = groups.get(identity) ?? [];
    group.push({ recordId: record.id, sourceRefs: clone(record.sourceRefs ?? []), value, temporal });
    groups.set(identity, group);
  }
  const conflicts = [];
  for (const [identity, values] of groups) {
    if (new Set(values.map((value) => value.value)).size > 1) conflicts.push({ type: 'temporal_conflict', identity, evidence: values });
  }
  return conflicts;
}

/** Return an event together with completion/correction/cancel/resolution dependants. */
export function collectLifecycleDependencies(eventId, records = []) {
  const wanted = new Set([eventId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      const refs = [record.eventRef, record.eventId, record.aboutEventId, record.completionOf, record.canceledEventId, record.cancelationOf, record.resolutionOf, record.correctionOf, record.supersedes, ...(record.eventRefs ?? []), ...(record.followUps ?? []).flatMap((item) => [item.eventRef, item.eventId, item.aboutEventId].filter(Boolean))].filter(Boolean);
      if (refs.some((ref) => wanted.has(ref)) && record.id && !wanted.has(record.id)) { wanted.add(record.id); changed = true; }
    }
  }
  return records.filter((record) => wanted.has(record.id) || wanted.has(record.eventRef) || wanted.has(record.eventId)).map(clone);
}

const VALID_STATES = new Set(['proposed', 'attempted', 'accepted', 'completed', 'declined', 'canceled']);

/** State updates require evidence; a date passing alone never completes/cancels a commitment. */
export function applyLifecycleTransition(previous, next, { sourceRefs = [], explicit = false } = {}) {
  const current = previous?.state ?? previous?.status ?? null;
  const requested = next?.state ?? next?.status;
  if (!VALID_STATES.has(requested)) return { accepted: false, reason: 'invalid_state', value: clone(previous) };
  if (!explicit && (!Array.isArray(sourceRefs) || sourceRefs.length === 0)) return { accepted: false, reason: 'evidence_required', value: clone(previous) };
  return { accepted: true, previousState: current, state: requested, value: clone(next), sourceRefs: clone(sourceRefs) };
}
