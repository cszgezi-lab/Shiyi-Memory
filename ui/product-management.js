import { esc,button,field,setting } from '../src/product-settings-ui.js';
import { CATEGORY_LABELS,recordDescription,readable } from '../src/product-memory.js';
import { MEMORY_CATEGORIES } from '../src/product-batches.js';

export const categoryOptions=()=>MEMORY_CATEGORIES.map(key=>`<option value="${key}">${CATEGORY_LABELS[key]}</option>`).join('');
export function memoryEditorHTML(){return `<div data-memory-categories class="sy-category-grid"></div>
  <details class="sy-card" data-add-memory><summary>新增记忆</summary>${field('记忆区块',`<select data-note-category>${categoryOptions()}</select>`)}
  ${field('人物 / 主体','<input data-note-subject>')}${field('关系对象（关系 / 人设）','<input data-note-target>')}${field('属性 / 变化方面','<input data-note-field value="补充信息">')}
  ${field('关联事件（知情记录必选）','<select data-note-event><option value="">请选择事件</option></select>')}
  ${field('记忆内容','<textarea rows="4" data-note></textarea>')}${field('谁知道（事件；未知留空）','<input data-people>')}${button('remember','保存记忆',true)}</details>
  <div data-edit-memory class="sy-card" hidden><h4>修改记忆</h4><textarea rows="5" data-edit-text aria-label="修改记忆内容"></textarea><div class="sy-actions">${button('save-memory-edit','保存修改',true)}${button('cancel-memory-edit','取消')}</div></div>`;}
export function batchManagementHTML(){return `<h3>总结批次</h3><p class="sy-help">按楼层管理每批摘要与各模块记录。重生成功前保留旧结果。</p><div data-batches></div><button type="button" data-more-batches hidden>显示更多批次</button><details class="sy-card"><summary>记忆回收站</summary><div data-recycle></div></details>`;}
export function mountMemoryManagement({panel,app,run,host}){
  const $=selector=>panel.querySelector?.(selector);if(!$('[data-memory-categories]'))return {paint(){},edit(){}};let editingId=null,limit=50;
  const currentCategory=$('[data-category]');
  const selectCategory=key=>{currentCategory.value=key;$('[data-note-category]').value=key;currentCategory.dispatchEvent(new panel.ownerDocument.defaultView.Event('change'));syncFields();};
  function syncFields(){const key=$('[data-note-category]').value;for(const [attr,show]of [['data-note-subject',['entityFactChanges','relationshipChanges','personaChanges','commitmentChanges','awarenessChanges'].includes(key)],['data-note-target',['relationshipChanges','personaChanges'].includes(key)],['data-note-field',['entityFactChanges','personaChanges'].includes(key)],['data-note-event',key==='awarenessChanges'],['data-people',key==='events']])$(`[${attr}]`).closest('label').hidden=!show;}
  $('[data-note-category]').addEventListener('change',syncFields);syncFields();
  $('[data-action="save-memory-edit"]').addEventListener('click',()=>run(async()=>{await app.editRecord(editingId,$('[data-edit-text]').value);$('[data-edit-memory]').hidden=true;}));
  $('[data-action="cancel-memory-edit"]').addEventListener('click',()=>{$('[data-edit-memory]').hidden=true;editingId=null;});
  $('[data-more-batches]').addEventListener('click',()=>{limit+=50;paint(app.state);});
  function edit(id){const card=app.state.cards.find(c=>c.id===id);if(!card)return;editingId=id;$('[data-edit-text]').value=card.category==='entityFactChanges'?readable(card.to??card.value??card.newValue):recordDescription(card);$('[data-edit-memory]').hidden=false;$('[data-edit-memory]').scrollIntoView({block:'nearest'});}
  function paint(state){
    const grid=$('[data-memory-categories]');grid.innerHTML=MEMORY_CATEGORIES.map(key=>`<button type="button" data-memory-category="${key}" ${currentCategory.value===key?'class="active"':''}><strong>${CATEGORY_LABELS[key]}</strong><small>${state.cards.filter(c=>c.category===key).length} 条</small></button>`).join('');
    for(const b of grid.querySelectorAll('button'))b.addEventListener('click',()=>selectCategory(b.dataset.memoryCategory));
    const select=$('[data-note-event]'),value=select.value;select.innerHTML='<option value="">请选择事件</option>'+state.cards.filter(c=>c.category==='events').map(c=>`<option value="${esc(c.id)}">${esc(recordDescription(c).slice(0,60))}</option>`).join('');select.value=value;
    const statusNames={queued:'待处理',running:'处理中',saved:'已保存',failed:'失败，可重试',interrupted:'中断，可重试',deleted:'已删除'};
    const batches=[...(state.batches??[])].reverse();
    $('[data-batches]').innerHTML=batches.slice(0,limit).map(b=>`<details class="sy-card" data-batch-id="${esc(b.id)}"><summary>第 ${b.number} 批 · ${Number.isInteger(b.startIndex)?`#${b.startIndex}–${b.endIndex}`:'旧版未保存楼层号'} · ${statusNames[b.status]??b.status}</summary><p>${esc(b.error??'')}</p><p class="sy-help">${b.previousOperation&&b.status!=='saved'?'上次成功结果仍保留。':''}${b.requests?`本批 ${b.requests} 次模型请求。`:''}</p><div class="sy-actions"><button type="button" data-regenerate-batch="${esc(b.id)}" ${state.busy||!Number.isInteger(b.startIndex)?'disabled':''}>${b.status==='saved'?'重新生成':'重试 / 生成'}</button>${b.status==='deleted'?`<button type="button" data-restore-batch="${esc(b.id)}">恢复旧结果</button>`:`<button type="button" data-delete-batch="${esc(b.id)}" ${state.busy?'disabled':''}>删除该批记忆</button>`}</div>${MEMORY_CATEGORIES.map(key=>`<details><summary>${CATEGORY_LABELS[key]} · ${b.counts?.[key]??0} 条</summary>${(b.records?.[key]??[]).map(r=>`<p>${Number.isInteger(r.floorIndex)?`#${r.floorIndex} · `:''}${esc(recordDescription(r))}</p>`).join('')||'<p class="sy-help">本批未生成此类记录。</p>'}</details>`).join('')}</details>`).join('')||'<p class="sy-empty">尚无总结批次。选择楼层范围后开始总结。</p>';
    $('[data-more-batches]').hidden=batches.length<=limit;
    for(const b of panel.querySelectorAll('[data-regenerate-batch]'))b.addEventListener('click',()=>run(()=>app.regenerateBatch(b.dataset.regenerateBatch),{name:'focus-summary',button:b}));
    for(const b of panel.querySelectorAll('[data-delete-batch]'))b.addEventListener('click',()=>run(async()=>{if(host.confirm?.('删除该批生成的记忆？聊天原文不变，可恢复或重生。'))await app.deleteBatch(b.dataset.deleteBatch);}));
    for(const b of panel.querySelectorAll('[data-restore-batch]'))b.addEventListener('click',()=>run(()=>app.restoreBatch(b.dataset.restoreBatch)));
    $('[data-recycle]').innerHTML=(state.deletedRecords??[]).map(r=>`<div class="sy-document"><span>${esc(recordDescription(r))}</span><button type="button" data-restore-record="${esc(r.id)}">恢复</button></div>`).join('')||'<p class="sy-help">没有单独删除的记忆。已删除批次可在上方恢复。</p>';
    for(const b of panel.querySelectorAll('[data-restore-record]'))b.addEventListener('click',()=>run(()=>app.restoreRecord(b.dataset.restoreRecord)));
  }
  return {paint,edit};
}
