import { esc,field } from '../src/product-settings-ui.js';
import { CATEGORY_LABELS,recordDescription,readable } from '../src/product-memory.js';
import { MEMORY_CATEGORIES,pageSummaryBatches } from '../src/product-batches.js';
import { parseModuleField } from '../src/product-custom-modules.js';

export function batchManagementHTML(){return `<h3>总结批次</h3><p class="sy-help">每页 10 批，点击展开详情。删除或重生不会改动聊天原文。</p>
  <div class="sy-batch-filters">${field('查找批次','<input data-batch-search placeholder="#120、100-200、第3批或侧重点">')}${field('状态','<select data-batch-status><option value="all">全部</option><option value="saved">已完成</option><option value="failed">失败 / 中断</option><option value="pending">待处理 / 运行中</option><option value="deleted">已删除</option></select>')}${field('每页','<select data-batch-size-list><option>10</option><option>20</option><option>50</option></select>')}</div>
  <p data-batch-total class="sy-help" role="status"></p><div data-batches></div><div class="sy-batch-pagination"><button type="button" data-batch-prev>上一页</button><span data-batch-page></span><button type="button" data-batch-next>下一页</button></div><label class="sy-field sy-page-jump"><span>跳到第几页</span><input type="number" min="1" data-batch-jump value="1"><button type="button" data-batch-go>跳转</button></label>
  <details class="sy-card"><summary>记忆回收站</summary><div data-recycle></div></details>`;}
const statusNames={queued:'待处理',running:'处理中',saved:'已保存',failed:'失败，可重试',interrupted:'中断，可重试',deleted:'已删除'};
export function batchRecordDescription(r,modules=[]){const tag=parseModuleField(r.field??r.key),m=modules.find(m=>m.id===tag?.moduleId),f=m?.fields.find(f=>f.id===tag?.fieldId);return f?`${m.name} · ${r.entity??m.subject} · ${f.label}：${readable(r.to??r.value??r.newValue)}`:recordDescription(r);}
export function mountBatchList({panel,app,run,host}){
  const $=s=>panel.querySelector(s);let currentPage=1,lastPaint='',lastScope='';
  function move(page){currentPage=page;paint(app.state);$('[data-batch-total]').scrollIntoView({block:'nearest'});}
  $('[data-batch-prev]').addEventListener('click',()=>move(currentPage-1));$('[data-batch-next]').addEventListener('click',()=>move(currentPage+1));$('[data-batch-go]').addEventListener('click',()=>move(Number($('[data-batch-jump]').value)));
  for(const name of ['data-batch-search','data-batch-status','data-batch-size-list'])$(`[${name}]`).addEventListener(name==='data-batch-search'?'input':'change',()=>{currentPage=1;paint(app.state);});
  function fill(node,b,s){
    const body=node.querySelector('[data-batch-body]');body.innerHTML=`${b.error?`<p class="sy-batch-error">${esc(b.error)}</p>`:''}<p class="sy-help">${b.previousOperation&&b.status!=='saved'?'上次成功结果仍保留。':''}${b.requests?`本批 ${b.requests} 次模型请求。`:''}</p><div class="sy-actions"><button type="button" data-regenerate-batch="${esc(b.id)}" ${s.busy||!Number.isInteger(b.startIndex)?'disabled':''}>${b.status==='saved'?'重新生成':'重试 / 生成'}</button>${b.status==='deleted'?`<button type="button" data-restore-batch="${esc(b.id)}">恢复旧结果</button>`:`<button type="button" data-delete-batch="${esc(b.id)}" ${s.busy?'disabled':''}>删除该批记忆</button>`}</div>${MEMORY_CATEGORIES.map(key=>`<details><summary>${CATEGORY_LABELS[key]} · ${b.counts?.[key]??0} 条</summary>${(b.records?.[key]??[]).map(r=>`<p>${Number.isInteger(r.floorIndex)?`#${r.floorIndex} · `:''}${esc(batchRecordDescription(r,s.modules))}</p>`).join('')||'<p class="sy-help">本批未生成此类记录。</p>'}</details>`).join('')}`;
    body.querySelector('[data-regenerate-batch]')?.addEventListener('click',event=>run(()=>app.regenerateBatch(b.id),{name:'focus-summary',button:event.currentTarget}));
    body.querySelector('[data-delete-batch]')?.addEventListener('click',()=>run(async()=>{if(host.confirm?.('删除该批生成的记忆？聊天原文不变，可恢复或重生。'))await app.deleteBatch(b.id);}));
    body.querySelector('[data-restore-batch]')?.addEventListener('click',()=>run(()=>app.restoreBatch(b.id)));
  }
  function paint(s){
    const scope=JSON.stringify(s.core?.scope);if(scope!==lastScope){lastScope=scope;currentPage=1;lastPaint='';$('[data-batch-search]').value='';$('[data-batch-status]').value='all';}
    const p=pageSummaryBatches(s.batches??[],{query:$('[data-batch-search]').value,status:$('[data-batch-status]').value,page:currentPage,pageSize:Number($('[data-batch-size-list]').value)});currentPage=p.page;
    const signature=JSON.stringify([p,s.busy,s.modules]);if(signature===lastPaint)return;lastPaint=signature;
    const opened=new Set([...panel.querySelectorAll('[data-batch-id][open]')].map(n=>n.dataset.batchId));
    $('[data-batch-total]').textContent=`共 ${p.allTotal} 批 · 筛选出 ${p.total} 批`;$('[data-batch-page]').textContent=`${p.page} / ${p.pages} 页`;$('[data-batch-jump]').max=String(p.pages);$('[data-batch-jump]').value=String(p.page);$('[data-batch-prev]').disabled=p.page===1;$('[data-batch-next]').disabled=p.page===p.pages;
    $('[data-batches]').innerHTML=p.items.map(b=>`<details class="sy-card sy-batch-row" data-batch-id="${esc(b.id)}" ${opened.has(b.id)?'open':''}><summary><span class="sy-batch-title">第 ${b.number} 批 · ${Number.isInteger(b.startIndex)?`#${b.startIndex}–${b.endIndex}`:'旧版未保存楼层号'}</span><span class="sy-batch-status" data-state="${esc(b.status)}">${statusNames[b.status]??esc(b.status)}</span></summary><div data-batch-body></div></details>`).join('')||'<p class="sy-empty">没有符合条件的批次。</p>';
    for(const node of panel.querySelectorAll('[data-batch-id]')){const b=p.items.find(b=>b.id===node.dataset.batchId);if(node.open)fill(node,b,s);node.addEventListener('toggle',()=>{if(node.open&&!node.querySelector('[data-batch-body]').hasChildNodes())fill(node,b,app.state);});}
  }
  return {paint};
}
