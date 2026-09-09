import { DRAFT_CATEGORIES } from './contracts.js';

export const MEMORY_CATEGORIES=Object.freeze(DRAFT_CATEGORIES.filter(k=>k!=='coverage'));
export function planSummaryRanges({count,startIndex,endIndex,lastIndex,batchSize}){
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>200)throw new Error('每批楼数应为 1–200');
  if((startIndex==null)!==(endIndex==null))throw new Error('请同时填写起止楼层');
  if(startIndex==null){if(!Number.isInteger(count)||count<1)throw new Error('总结楼数应为正整数');endIndex=lastIndex;startIndex=Math.max(0,lastIndex-count+1);}
  if(!Number.isInteger(startIndex)||!Number.isInteger(endIndex)||startIndex<0||endIndex<startIndex||endIndex>lastIndex)throw new Error('总结范围超出当前聊天');
  if(endIndex-startIndex+1>100000)throw new Error('一次任务最多 100000 楼，请拆成多个任务');
  const ranges=[];for(let start=startIndex;start<=endIndex;start+=batchSize)ranges.push({startIndex:start,endIndex:Math.min(endIndex,start+batchSize-1)});
  return ranges;
}
export function batchRecords(history,operationId){
  const entries=(history??[]).filter(item=>item.operationId===operationId||item.operationId?.startsWith(`${operationId}/child-`));
  return Object.fromEntries(MEMORY_CATEGORIES.map(category=>[category,entries.flatMap(item=>item.categories?.[category]??[])]));
}
export function editedMemoryFields(category,record,text){
  if(typeof text!=='string'||!text.trim()||text.length>12000)throw new Error('记忆内容需要 1–12000 字');
  const body=text.trim();
  if(category==='entityFactChanges')return {to:body,value:body,newValue:body};
  if(category==='awarenessChanges')return {knowledge:body,fact:body,content:body};
  return {description:body,content:body,text:body,summary:body};
}
