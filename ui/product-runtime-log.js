import { LOG_TASKS, LOG_PHASES } from '../src/product-runtime-log.js';
import { esc } from '../src/product-settings-ui.js';
import { failureText } from '../src/product-feedback.js';
import { safeValidationIssues, validationIssueText } from '../src/validation-diagnostics.js';

export function runtimeLogHTML(){return `<h3>运行日志</h3><p class="sy-help">本机最近 200 条。仅记录运行状态与数值，不记录 Key、聊天正文、附件或模型原始回复。</p><div class="sy-actions"><button type="button" data-log-export>导出日志</button><button type="button" data-log-clear>清空日志</button></div><label class="sy-field"><span>显示</span><select data-log-filter><option value="all">全部记录</option><option value="issues">失败与警告</option><option value="summary">总结</option><option value="api">API 与助手</option></select></label><p data-log-storage class="sy-help" role="status"></p><div data-log-list></div><div class="sy-batch-pagination"><button type="button" data-log-prev>上一页</button><span data-log-page></span><button type="button" data-log-next>下一页</button></div>`;}
const fields={batchNumber:'总结批次',childIndex:'内部子批（从 0 计）',sourceCount:'读取消息数',inputLimit:'输入预算',inputUnits:'实际输入估算',elapsedMs:'耗时（毫秒）',status:'HTTP 状态',expected:'应有逐楼摘要',received:'收到摘要条数',covered:'完整对应楼数',invalidRows:'来源无效或多楼合并',duplicateCount:'重复摘要条数',promptTokens:'服务报告输入 Token',completionTokens:'服务报告输出 Token',totalTokens:'服务报告总 Token',reasoningTokens:'其中推理 Token',responseChars:'回复文本字符数',savedBatches:'保存批数'};
function detailsHTML(entry){
  const d=entry.details,lines=[];
  if(d.startIndex!==undefined)lines.push(['楼层范围',`#${d.startIndex}–${d.endIndex??d.startIndex}`]);
  if(d.expected!==undefined)lines.push(['逐楼摘要',`完整对应 ${d.covered??0}/${d.expected} 楼；收到 ${d.received??0} 条`]);
  for(const [key,label] of [['missingFloors','缺失楼层'],['duplicateFloors','重复楼层'],['emptyFloors','正文为空的楼层']])if(d[key]?.length)lines.push([label,d[key].map(n=>'#'+n).join('、')]);
  if(d.maxTokens!==undefined)lines.push(['实际发送回复上限',d.maxTokens===0?'沿用服务端默认（未发送 max_tokens）':`${d.maxTokens} Token`]);
  if(d.finishReason!==undefined)lines.push(['服务结束原因',d.finishReason==='unknown'?'服务未提供 / 未识别':d.finishReason]);
  if(d.truncated!==undefined)lines.push(['截断标记',d.truncated?'服务明确报告截断':'未收到截断标记']);
  for(const [key,label] of Object.entries(fields))if(d[key]!==undefined&&!['expected','received','covered','childIndex'].includes(key)&&!(d[key]===0&&['invalidRows','duplicateCount'].includes(key)))lines.push([label,d[key]]);
  if(d.childIndex>0)lines.push(['拆分序号',d.childIndex+1]);
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
    const selected=[...data.entries].reverse().filter(e=>filter==='all'||filter==='issues'&&['error','warning'].includes(e.level)||filter==='summary'&&e.task==='summary'||filter==='api'&&['connection','models','assistant'].includes(e.task));
    const pages=Math.max(1,Math.ceil(selected.length/10));page=Math.min(page,pages);
    const items=selected.slice((page-1)*10,page*10),nextSignature=JSON.stringify([items,page,filter,data.persistence]);
    if(signature===nextSignature)return;signature=nextSignature;
    $('[data-log-storage]').textContent={not_loaded:'打开日志后读取。',ready:'日志已读取。',saved:'日志已保存在本机。',unavailable:'日志存储读取失败；本次仅在内存保留，可立即导出。',failed:'日志保存失败；本次仅在内存保留，可立即导出。'}[data.persistence]??'';
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
