// Absolute host floors, not turns or batchNumber * the current batch size.
export function autoSummaryPlan(batches=[],{startFloor=1,batchSize=10,keepRecent=2,lastIndex=null}={}){
  if(!Number.isSafeInteger(startFloor)||startFloor<0||!Number.isSafeInteger(batchSize)||batchSize<1||!Number.isSafeInteger(keepRecent)||keepRecent<0)throw new Error('自动总结的起点、每批楼数和保留楼数无效');
  const ranges=batches.filter(b=>b.status!=='deleted'&&(b.status==='saved'||b.savedOperationId)&&Number.isSafeInteger(b.startIndex)&&Number.isSafeInteger(b.endIndex)).sort((a,b)=>a.startIndex-b.startIndex);
  let next=startFloor;
  for(const b of ranges){if(b.startIndex>next)break;if(b.endIndex>=next)next=b.endIndex+1;}
  const end=next+batchSize-1,known=Number.isSafeInteger(lastIndex),eligibleEnd=known?lastIndex-keepRecent:null;
  return {startFloor,coveredThrough:next-1,nextStart:next,nextEnd:end,batchSize,keepRecent,lastIndex:known?lastIndex:null,
    completedBatches:ranges.filter(b=>b.endIndex>=startFloor&&b.endIndex<next).length,
    eligibleEnd,ready:known&&end<=eligibleEnd,pendingBatches:known?Math.max(0,Math.floor((eligibleEnd-next+1)/batchSize)):null};
}
export function autoSummaryText(plan){
  return [`起算楼层：#${plan.startFloor}`,plan.coveredThrough>=plan.startFloor?`连续已总结：#${plan.startFloor}–${plan.coveredThrough} · ${plan.completedBatches} 批`:'起点之后尚无连续完成的总结',`下一批：#${plan.nextStart}–${plan.nextEnd}`,`最近 ${plan.keepRecent} 楼暂不总结`,plan.lastIndex===null?'点击检查进度，读取当前聊天楼数。':`聊天最新：#${plan.lastIndex} · 满足条件的待总结批次：${plan.pendingBatches}`].join('\n');
}
