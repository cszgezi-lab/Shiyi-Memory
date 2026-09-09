import { normalizeTerms, normalizeTags } from './product-dictionary.js';
export function narrativeText(value) {
  if(typeof value==='string')return value;
  if(value==null)return '';
  if(Array.isArray(value))return value.map(narrativeText).filter(Boolean).join('、');
  if(typeof value==='object')return Object.entries(value).map(([k,v])=>`${({name:'名称',date:'日期',period:'时期',time:'时间',location:'地点',value:'内容',description:'说明',kind:'类型',unknown:'未知'})[k]??k}：${narrativeText(v)}`).join('；');
  return String(value);
}
export function recordTitle(card) {
  if(typeof card.title==='string'&&card.title.trim())return card.title.trim();
  if(Number.isInteger(card.floorIndex))return `第 ${card.floorIndex} 楼纪要`;
  const body=String(card.description??card.text??card.content??card.action??'记忆');
  const first=body.split(/[。！？\n]/)[0];return first.length<=48?first:`${first.slice(0,48)}…`;
}
export function sourceFloors(card) {
  const floors=Array.isArray(card.sourceFloors)?[...card.sourceFloors]:[];
  if(Number.isSafeInteger(card.floorIndex))floors.push(card.floorIndex);
  // Older TT host locators included the absolute floor; arbitrary IDs don't.
  for(const ref of card.sourceRefs??[]){const m=/^message:(\d+):[a-f\d]+$/i.exec(ref.sourceId??'');if(m)floors.push(Number(m[1]));}
  return [...new Set(floors.filter(n=>Number.isSafeInteger(n)&&n>=0))].sort((a,b)=>a-b);
}
export function sourceLabel(card) {
  const floors=sourceFloors({...card,sourceFloors:[...(card.sourceFloors??[])]}),ranges=[];
  for(let i=0;i<floors.length;i++){let end=floors[i],start=end;while(floors[i+1]===end+1)end=floors[++i];ranges.push(start===end?`${start}`:`${start}–${end}`);}
  if(ranges.length)return `来源：第 ${ranges.join('、')} 楼`;
  if(card.documentName)return `来源：${card.documentName}`;
  if((card.sourceRefs??[]).some(r=>String(r.sourceId).startsWith('user-note')))return '来源：用户手动记录';
  return '来源：已关联原文；旧记录未保存楼层号';
}
export function fullSearchText(card,body) {
  return [...new Set([card.title,body,card.recallSummary,narrativeText(card.participants),narrativeText(card.location),narrativeText(card.temporal),...(card.keyDialogues??[]).map(q=>[q.speaker,q.to,q.text,q.context,q.meaning].filter(Boolean).join(' ')),...(card.viewpoints??[]).map(v=>[v.holder,v.target,v.content,v.context].filter(Boolean).join(' ')),...normalizeTerms(card.entities).flatMap(t=>[t.name,...t.aliases,...t.indexWords]),...normalizeTags(card.tags)].filter(v=>typeof v==='string'&&v.trim()))].join('\n');
}
export const stateLabel=value=>({proposed:'提出',attempted:'尝试',accepted:'接受',completed:'完成',declined:'拒绝',canceled:'取消',resolved:'已解决',active:'有效'})[value]??value;
export const awarenessLabel=value=>({known:'知道',heard:'听说',suspected:'怀疑',mistaken:'误以为',explicitly_unaware:'明确不知情'})[value]??value;
export const viaLabel=value=>({witnessed:'亲眼见证',heard_in_scene:'现场听见',read:'阅读获知',told:'被告知',background:'背景已知',user_confirmed:'用户确认',special_ability:'特殊能力获知'})[value]??value??'渠道未注明';

export function recallExplanation(trace={}){
  const matched=(trace.dictionary?.matched??[]).map(t=>`${t.matched.join('、')} → ${t.name}`);
  const tags=(trace.tags?.lanes??[]).map(l=>l.tag);
  const status=s=>({passed:'完成',disabled:'未启用',fallback:'未完成，已降级',skipped:'已跳过'})[s]??'未使用';
  return [`字典匹配：${matched.join('；')||'没有命中词条'}`,`标签辅助：${tags.join('、')||'本轮没有触发相关标签'}`,`关键词候选：${trace.local?.count??0} 条；语义检索：${status(trace.vector?.status)}；重排：${status(trace.rerank?.status)}`,`本轮注入：${trace.packing?.selected??0} 条，其中展开完整经过 ${trace.packing?.expanded??0} 条、相关句段 ${trace.packing?.excerpts??0} 条。`,'只有命中的记忆按预算加入；没有把全部字典和标签发送给聊天模型。'].join('\n');
}
