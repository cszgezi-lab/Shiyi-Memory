// Absolute host floors, not turns or batchNumber * the current batch size.
export function autoSummaryPlan(batches=[],{startFloor=1,batchSize=10,keepRecent=2,lastIndex=null}={}){
  if(!Number.isSafeInteger(startFloor)||startFloor<0||!Number.isSafeInteger(batchSize)||batchSize<1||!Number.isSafeInteger(keepRecent)||keepRecent<0)throw new Error('自动总结的起点、每批楼数和保留楼数无效');
  const ranges=batches.filter(b=>b.status!=='deleted'&&(b.status==='saved'||b.savedOperationId)&&Number.isSafeInteger(b.startIndex)&&Number.isSafeInteger(b.endIndex)).sort((a,b)=>a.startIndex-b.startIndex);
  let next=startFloor;
  for(const b of ranges){if(b.startIndex>next)break;if(b.endIndex>=next)next=b.endIndex+1;}
  const following=ranges.find(b=>b.startIndex>next),end=Math.min(next+batchSize-1,following?following.startIndex-1:Infinity),known=Number.isSafeInteger(lastIndex),eligibleEnd=known?lastIndex-keepRecent:null;
  const coverage=summaryCoverage(batches,{startFloor,lastIndex,keepRecent,batchSize});
  return {startFloor,coveredThrough:next-1,nextStart:next,nextEnd:end,batchSize,keepRecent,lastIndex:known?lastIndex:null,
    completedBatches:ranges.filter(b=>b.endIndex>=startFloor&&b.endIndex<next).length,
    eligibleEnd,ready:known&&end<=eligibleEnd,pendingBatches:known?coverage.missingRanges.reduce((n,r)=>n+Math.floor((r.endIndex-r.startIndex+1)/batchSize),0):null,coverage};
}
/** Interval subtraction, not a per-floor scan: later saved batches do not hide gaps. */
export function summaryCoverage(batches=[],{startFloor=1,lastIndex=null,keepRecent=2,batchSize=10}={}){
  if(!Number.isSafeInteger(startFloor)||startFloor<0||!Number.isSafeInteger(keepRecent)||keepRecent<0||!Number.isSafeInteger(batchSize)||batchSize<1)throw new Error('补采楼层设置无效');
  const eligibleEnd=Number.isSafeInteger(lastIndex)?lastIndex-keepRecent:null,coveredRanges=[],missingRanges=[];
  if(eligibleEnd!==null&&eligibleEnd>=startFloor){
    const sorted=batches.filter(b=>b.status!=='deleted'&&(b.status==='saved'||b.savedOperationId)&&Number.isSafeInteger(b.startIndex)&&Number.isSafeInteger(b.endIndex)&&b.endIndex>=b.startIndex).map(b=>({startIndex:Math.max(startFloor,b.startIndex),endIndex:Math.min(eligibleEnd,b.endIndex)})).filter(b=>b.startIndex<=b.endIndex).sort((a,b)=>a.startIndex-b.startIndex);
    for(const r of sorted){const last=coveredRanges.at(-1);if(last&&r.startIndex<=last.endIndex+1)last.endIndex=Math.max(last.endIndex,r.endIndex);else coveredRanges.push({...r});}
    let cursor=startFloor;for(const r of coveredRanges){if(cursor<r.startIndex)missingRanges.push({startIndex:cursor,endIndex:r.startIndex-1});cursor=r.endIndex+1;}if(cursor<=eligibleEnd)missingRanges.push({startIndex:cursor,endIndex:eligibleEnd});
  }
  const floors=rs=>rs.reduce((n,r)=>n+r.endIndex-r.startIndex+1,0);
  return {eligibleEnd,coveredRanges,missingRanges,coveredFloors:floors(coveredRanges),missingFloors:floors(missingRanges),catchUpBatches:missingRanges.reduce((n,r)=>n+Math.ceil((r.endIndex-r.startIndex+1)/batchSize),0)};
}
export function missingSummaryRanges(coverage,batchSize){
  if(!Number.isSafeInteger(batchSize)||batchSize<1)throw new Error('每批楼数无效');
  return coverage.missingRanges.flatMap(r=>Array.from({length:Math.ceil((r.endIndex-r.startIndex+1)/batchSize)},(_,i)=>({startIndex:r.startIndex+i*batchSize,endIndex:Math.min(r.endIndex,r.startIndex+(i+1)*batchSize-1)})));
}
export function summaryCoverageText(plan){
  if(plan.lastIndex===null)return '尚未读取最新楼层。检查进度不调用模型；补采会按已保存的自动设置处理缺口。';
  const c=plan.coverage,format=rows=>rows.slice(0,12).map(r=>r.startIndex===r.endIndex?'#'+r.startIndex:'#'+r.startIndex+'–'+r.endIndex).join('、')+(rows.length>12?' 等 '+rows.length+' 段':'');
  return `已记录 ${c.coveredFloors} 楼：${format(c.coveredRanges)||'暂无'}\n未记录 ${c.missingFloors} 楼：${format(c.missingRanges)||'无缺口'}\n最新 #${plan.lastIndex}；保留最近 ${plan.keepRecent} 楼。本次补采 ${c.catchUpBatches} 批，每批最多 ${plan.batchSize} 楼，末批可不足一批。`;
}
export function autoSummaryText(plan){
  return [`起算楼层：#${plan.startFloor}`,plan.coveredThrough>=plan.startFloor?`连续已总结：#${plan.startFloor}–${plan.coveredThrough} · ${plan.completedBatches} 批`:'起点之后尚无连续完成的总结',`下一批：#${plan.nextStart}–${plan.nextEnd}`,`最近 ${plan.keepRecent} 楼暂不总结`,plan.lastIndex===null?'点击检查进度，读取当前聊天楼数。':`聊天最新：#${plan.lastIndex} · 满足条件的待总结批次：${plan.pendingBatches}`].join('\n');
}
