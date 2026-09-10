import { LOG_TASKS, LOG_PHASES } from '../src/product-runtime-log.js';
import { esc } from '../src/product-settings-ui.js';
import { failureText } from '../src/product-feedback.js';
import { safeValidationIssues, validationIssueText } from '../src/validation-diagnostics.js';
import {DIAGNOSTIC_REASONS,DIAGNOSTIC_PURPOSES,DIAGNOSTIC_STAGES,DIAGNOSTIC_ACTIONS,UPSTREAM_CODES} from '../src/diagnostics.js';

export function runtimeLogHTML(){return `<h3>运行日志</h3><p class="sy-help">保留最近 2000 条，最多 2 MB。记录请求、解析、校验与保存过程；不包含 Key、聊天正文或模型原文。导出包含全部保留记录，不受筛选和分页影响。</p><div class="sy-actions"><button type="button" data-log-export>导出日志</button><button type="button" data-log-clear>清空日志</button></div><label class="sy-field"><span>显示</span><select data-log-filter><option value="all">全部记录</option><option value="issues">失败与警告</option><option value="vectors">向量索引</option><option value="summary">总结</option><option value="merge">事件合并</option><option value="api">API 与助手</option></select></label><p data-log-storage class="sy-help" role="status"></p><div data-log-list></div><div class="sy-batch-pagination"><button type="button" data-log-prev>上一页</button><span data-log-page></span><button type="button" data-log-next>下一页</button></div>`;}
const fields={requestNumber:'向量请求序号',requestItems:'输入片段数',receivedVectors:'返回向量数',inputChars:'本次输入字符数',longestInputChars:'最长片段字符数',vectorDimensions:'向量维度',indexedItems:'已保存索引条数',pendingItems:'未完成索引条数',failedItems:'失败索引条数',batchNumber:'总结批次',childIndex:'内部子批（从 0 计）',sourceCount:'读取消息数',inputLimit:'输入预算',inputUnits:'实际输入估算',elapsedMs:'耗时（毫秒）',status:'HTTP 状态',expected:'应有逐楼摘要',received:'收到摘要条数',covered:'完整对应楼数',invalidRows:'来源无效或多楼合并',duplicateCount:'重复摘要条数',promptTokens:'服务报告输入 Token',completionTokens:'服务报告输出 Token',totalTokens:'服务报告总 Token',reasoningTokens:'其中推理 Token',responseChars:'回复文本字符数',savedBatches:'保存批数'};
function detailsHTML(entry){
  const d=entry.details,lines=[];
  fields.requestNumber='本任务请求序号';
  lines.push(['执行版本',entry.pluginVersion??'旧日志未记录']);
  if(d.action)lines.push(['执行操作',DIAGNOSTIC_ACTIONS[d.action]]);
  if(d.purpose)lines.push(['请求用途',DIAGNOSTIC_PURPOSES[d.purpose]]);
  if(d.requestId)lines.push(['请求编号',d.requestId]);
  if(d.stage)lines.push(['具体阶段',DIAGNOSTIC_STAGES[d.stage]]);
  if(d.reason)lines.push(['具体原因',DIAGNOSTIC_REASONS[d.reason]]);
  if(d.upstreamCode)lines.push(['服务错误分类',UPSTREAM_CODES[d.upstreamCode]]);
  if(d.modelRole)lines.push(['模型用途',({summary:'总结模型',assistant:'配置助手',embedding:'向量模型',rerank:'重排模型'})[d.modelRole]]);
  if(d.errorType)lines.push(['错误类型',d.errorType]);
  for(const [key,label]of [['bodyChars','接口正文字符数'],['jsonPosition','JSON 出错字符位置'],['jsonLine','JSON 出错行'],['jsonColumn','JSON 出错列'],['choicesCount','回复候选数量'],['toolCallsCount','工具调用数量'],['timeoutMs','请求等待上限（毫秒）']])if(d[key]!==undefined)lines.push([label,d[key]]);
  if(d.contentType)lines.push(['返回结构',({object:'对象',array:'数组',string:'文字',null:'空值',undefined:'缺失',number:'数值',boolean:'是/否'})[d.contentType]]);
  if(d.responseType)lines.push(['接口正文类型',({json:'JSON',html:'HTML 网页',text:'纯文本',other:'其它',unknown:'接口未提供'})[d.responseType]]);
  if(d.statusKnown===false)lines.push(['HTTP 状态来源','适配器未提供；状态值使用兼容默认值']);
  if(d.repairCategories?.length)lines.push(['补全区块',d.repairCategories.map(k=>({events:'事件',awarenessChanges:'知情',entityFactChanges:'人物与事实',relationshipChanges:'关系',personaChanges:'人设变化',commitmentChanges:'约定',performanceHints:'演绎参考',summaryView:'楼层摘要',conflicts:'冲突与疑点'})[k]).join('、')]);
  if(d.stackFrames?.length)lines.push(['插件代码位置',d.stackFrames.join(' → ')]);
  for(const cause of d.causes??[])lines.push(['上层错误的原因',[cause.errorType,DIAGNOSTIC_REASONS[cause.reason],DIAGNOSTIC_STAGES[cause.stage]].filter(Boolean).join(' · ')]);
  if(d.transport)lines.push(['请求通道',d.transport==='tt_native'?'TT 原生模型通道':'WebView 直接请求；无法区分网络 / TLS / 跨域拦截']);
  if(d.storageStage)lines.push(['本机存储阶段',({write:'写入存档',read:'读取存档',readback:'写入后的读回',compare:'读回内容比对',decode:'存档完整性校验',unknown:'旧存储接口未报告阶段'})[d.storageStage]??'未识别']);
  if(d.storageArtifact)lines.push(['存档类型',({vector_jobs:'向量续传检查点',vector_index:'已完成向量索引',vector_staging:'重建中的暂存索引',runtime_log:'运行日志',workspace:'插件资料',memory:'故事记忆',checkpoint:'任务进度',credentials:'密钥存储',settings:'设置'})[d.storageArtifact]??'未识别']);
  if(d.startIndex!==undefined)lines.push(['楼层范围',`#${d.startIndex}–${d.endIndex??d.startIndex}`]);
  if(d.expected!==undefined)lines.push(['逐楼摘要',`完整对应 ${d.covered??0}/${d.expected} 楼；收到 ${d.received??0} 条`]);
  for(const [key,label] of [['missingFloors','缺失楼层'],['duplicateFloors','重复楼层'],['emptyFloors','正文为空的楼层']])if(d[key]?.length)lines.push([label,d[key].map(n=>'#'+n).join('、')]);
  if(d.maxTokens!==undefined)lines.push(['实际发送回复上限',d.maxTokens===0?'沿用服务端默认（未发送 max_tokens）':`${d.maxTokens} Token`]);
  if(d.finishReason!==undefined)lines.push(['服务结束原因',d.finishReason==='unknown'?'服务未提供 / 未识别':d.finishReason]);
  if(d.truncated!==undefined)lines.push(['截断标记',d.truncated?'服务明确报告截断':'未收到截断标记']);
  for(const [key,label] of Object.entries(fields))if(d[key]!==undefined&&!['expected','received','covered','childIndex'].includes(key)&&!(d[key]===0&&['invalidRows','duplicateCount'].includes(key)))lines.push([label,d[key]]);
  if(d.childIndex>0)lines.push(['拆分序号',d.childIndex+1]);
  if(d.normalizedFields!==undefined)lines.push(['本地兼容字段',d.normalizedFields]);
  if(d.defaultedValidityFields)lines.push(['未注明有效期的人设变化',`${d.defaultedValidityFields} 条；保留为期限未确认，不推定永久变化`]);
  if(d.repairFields!==undefined)lines.push([d.purpose==='enum_repair'?'自动纠错字段':'待补全或纠错项',d.repairFields]);
  if(d.recoveryCalls!==undefined)lines.push(['本批额外恢复调用',`${d.recoveryCalls} / 2`]);
  if(d.retryDelayMs!==undefined)lines.push(['重试前等待',`${d.retryDelayMs} 毫秒`]);
  if(d.repairAttempted)lines.push(['自动纠错','已尝试一次，未通过校验；没有强行保存']);
  const issues=safeValidationIssues(d.validationIssues);
  if(issues.length){
    lines.push(['校验问题',`${d.validationIssueCount??issues.length} 项${d.validationIssueCount>issues.length?`（显示前 ${issues.length} 项）`:''}；方括号内是从 0 开始的记录位置，不是聊天楼层`]);
    for(const issue of issues)lines.push(['校验字段',validationIssueText(issue)]);
  }
  if(d.code)lines.push(['错误',failureText({code:d.code,details:d})]);
  return lines.map(([label,value])=>`<div class="sy-log-detail${['错误','校验问题','校验字段'].includes(label)?' sy-log-wide':''}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
}
export function mountRuntimeLog({panel,app,run,host,download}){
  const $=s=>panel.querySelector(s);let page=1,state=null,signature='';const opened=new Set();
  function paint(next){
    state=next;const data=state.runtimeLog??{entries:[],persistence:'not_loaded'};
    const filter=$('[data-log-filter]').value;
    const selected=[...data.entries].reverse().filter(e=>filter==='all'||filter==='issues'&&['error','warning'].includes(e.level)||filter==='vectors'&&['vectors','knowledge-vectors'].includes(e.task)||filter==='summary'&&e.task==='summary'||filter==='merge'&&e.task==='merge'||filter==='api'&&['transport','connection','models','assistant'].includes(e.task));
    const pages=Math.max(1,Math.ceil(selected.length/10));page=Math.min(page,pages);
    const items=selected.slice((page-1)*10,page*10),nextSignature=JSON.stringify([items,page,filter,data.persistence,data.droppedEntries,data.partialRuns,data.legacyRetentionUnknown,data.storageFailure]);
    if(signature===nextSignature)return;signature=nextSignature;
    $('[data-log-storage]').textContent={not_loaded:'打开日志后读取。',ready:'日志已读取。',saved:'日志已保存在本机。',unavailable:'日志存储读取失败；本次仅在内存保留，可立即导出。',failed:'日志保存失败；本次仅在内存保留，可立即导出。'}[data.persistence]??'';
    if(data.droppedEntries)$('[data-log-storage]').textContent+=` 已清理 ${data.droppedEntries} 条旧记录。`;
    if(data.partialRuns?.length)$('[data-log-storage]').textContent+=` 任务 ${data.partialRuns.join('、')} 的早期记录已清理。`;
    if(data.legacyRetentionUnknown)$('[data-log-storage]').textContent+=' 旧版本是否已丢弃日志无法确认。';
    if(data.storageFailure)$('[data-log-storage]').textContent+=` 日志存储原因：${DIAGNOSTIC_REASONS[data.storageFailure.reason]??'未提供可识别原因'}。`;
    $('[data-log-list]').innerHTML=items.map(e=>`<details class="sy-card sy-log-row" data-log-id="${e.id}" data-level="${e.level}" ${opened.has(e.id)?'open':''}><summary>任务 ${e.run} · ${LOG_TASKS[e.task]} · ${LOG_PHASES[e.phase]}<small>${esc(new Date(e.at).toLocaleString())} · ${{info:'信息',success:'成功',warning:'提醒',error:'失败'}[e.level]}</small></summary>${detailsHTML(e)}</details>`).join('')||'<p class="sy-empty">没有符合条件的日志。更新前的请求无法补录。</p>';
    for(const el of panel.querySelectorAll('[data-log-id]'))el.addEventListener('toggle',()=>{const id=Number(el.dataset.logId);if(el.open)opened.add(id);else opened.delete(id);});
    $('[data-log-page]').textContent=`${page} / ${pages} · ${selected.length} 条`;$('[data-log-prev]').disabled=page===1;$('[data-log-next]').disabled=page===pages;
  }
  $('[data-log-filter]').addEventListener('change',()=>{page=1;paint(state??app.state);});
  for(const [sel,delta]of [['[data-log-prev]',-1],['[data-log-next]',1]])$(sel).addEventListener('click',()=>{page+=delta;paint(state??app.state);});
  $('[data-log-export]').addEventListener('click',()=>run(async()=>download(await app.exportRuntimeLog(),'拾忆-运行日志.json')));
  $('[data-log-clear]').addEventListener('click',()=>run(async()=>{if(host.confirm?.('清空运行日志？记忆、总结批次、设置和助手对话不会删除。')){await app.clearRuntimeLog();opened.clear();page=1;signature='';paint(app.state);}}));
  return {paint};
}
