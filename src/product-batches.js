import { DRAFT_CATEGORIES } from './contracts.js';

export const MEMORY_CATEGORIES=Object.freeze(DRAFT_CATEGORIES.filter(k=>k!=='coverage'));
export function pageSummaryBatches(batches,{query='',status='all',page=1,pageSize=10}={}) {
  const size=[10,20,50].includes(Number(pageSize))?Number(pageSize):10;
  const term=String(query).trim(),range=/^#?(\d+)\s*[-–~至]\s*#?(\d+)$/.exec(term),floor=/^#(\d+)$/.exec(term),number=/^第?\s*(\d+)\s*批$/.exec(term);
  const selected=[...batches].reverse().filter(b=>{
    if(status==='failed'&&!['failed','interrupted'].includes(b.status))return false;
    if(status==='pending'&&!['running','queued'].includes(b.status))return false;
    if(['saved','deleted'].includes(status)&&b.status!==status)return false;
    if(!term)return true;
    if(number)return b.number===Number(number[1]);
    if(floor)return Number.isInteger(b.startIndex)&&b.startIndex<=Number(floor[1])&&b.endIndex>=Number(floor[1]);
    if(range)return Number.isInteger(b.startIndex)&&b.startIndex<=Number(range[2])&&b.endIndex>=Number(range[1]);
    return `${b.number} ${b.focus??''} ${b.error??''}`.toLowerCase().includes(term.toLowerCase());
  });
  const pages=Math.max(1,Math.ceil(selected.length/size)),current=Math.min(pages,Math.max(1,Number.isInteger(Number(page))?Number(page):1));
  return {items:selected.slice((current-1)*size,current*size),page:current,pages,pageSize:size,total:selected.length,allTotal:batches.length};
}
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
