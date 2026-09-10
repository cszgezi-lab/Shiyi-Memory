import { esc,button,field,setting } from '../src/product-settings-ui.js';
import { CATEGORY_LABELS,recordDescription,readable } from '../src/product-memory.js';
import { MEMORY_CATEGORIES } from '../src/product-batches.js';


import { mountBatchList,batchRecordDescription } from './product-batch-list.js';

export const categoryOptions=()=>MEMORY_CATEGORIES.map(key=>`<option value="${key}">${CATEGORY_LABELS[key]}</option>`).join('');
export function memoryEditorHTML(){return `<div data-memory-categories class="sy-category-grid"></div><p data-category-help class="sy-help" hidden></p>
  <details class="sy-card" data-add-memory><summary>新增记忆</summary>${field('记忆区块',`<select data-note-category>${categoryOptions()}</select>`)}
  <p data-note-help class="sy-help" hidden></p>${field('扩展字段','<select data-note-module-field></select>')}
  ${field('人物 / 主体','<input data-note-subject>')}${field('关系对象（关系 / 人设）','<input data-note-target>')}${field('属性 / 变化方面','<input data-note-field value="补充信息">')}
  ${field('关联事件（知情记录必选）','<select data-note-event><option value="">请选择事件</option></select>')}
  ${field('记忆内容','<textarea rows="4" data-note></textarea>')}${field('谁知道（事件；未知留空）','<input data-people>')}${button('remember','保存记忆',true)}${button('note-mvu-refresh','读取 MVU 变量')}</details>
  <div data-edit-memory class="sy-card" hidden><h4>修改记忆</h4>${field('标题','<input data-edit-title maxlength="160">')}${field('完整纪要','<textarea rows="8" data-edit-text aria-label="修改记忆内容"></textarea>')}${field('召回速览（修改正文后可留空）','<textarea rows="3" data-edit-brief maxlength="2000"></textarea>')}${field('检索标签','<input data-edit-tags placeholder="用逗号分隔，例如借书归还、转校手续">')}<div class="sy-actions">${button('save-memory-edit','保存修改',true)}${button('cancel-memory-edit','取消')}</div></div>`;}
export { batchManagementHTML } from './product-batch-list.js';
export function mountMemoryManagement({panel,app,run,host}){
  const $=selector=>panel.querySelector?.(selector);if(!$('[data-memory-categories]'))return {paint(){},edit(){}};let editingId=null,lastOptions='';
  const batchList=mountBatchList({panel,app,run,host});
  const currentCategory=$('[data-category]');
  const selectCategory=key=>{currentCategory.value=key;$('[data-note-category]').value=key;currentCategory.dispatchEvent(new panel.ownerDocument.defaultView.Event('change'));syncFields();};
  const conflictHelp='来源有矛盾或尚不能确定的内容，不参与自动召回。核实后在相应区块保存正确记忆，再删除这条疑点。';
  function selectedModule(){const key=$('[data-note-category]').value;return key.startsWith('module:')?app.state.modules?.find(m=>m.id===key.slice(7)&&!m.archived):null;}
  function syncFields(){
    const key=$('[data-note-category]').value,m=selectedModule(),readonly=m?.mode==='mvu';
    for(const [attr,show]of [['data-note-subject',Boolean(m)&&!readonly||['entityFactChanges','relationshipChanges','personaChanges','commitmentChanges','awarenessChanges'].includes(key)],['data-note-target',['relationshipChanges','personaChanges'].includes(key)],['data-note-field',!m&&['entityFactChanges','personaChanges'].includes(key)],['data-note-event',key==='awarenessChanges'],['data-people',key==='events'],['data-note-module-field',Boolean(m)],['data-note',!readonly]])$(`[${attr}]`).closest('label').hidden=!show;
    const fields=$('[data-note-module-field]'),value=fields.value;fields.innerHTML=(m?.fields??[]).map(f=>`<option value="${esc(f.id)}">${esc(f.label)} · ${({text:'文字',number:'数值',boolean:'开关'})[f.type]}</option>`).join('');if(m?.fields.some(f=>f.id===value))fields.value=value;
    const help=$('[data-note-help]');help.hidden=!m&&key!=='conflicts';help.textContent=m?(readonly?'此区块绑定 MVU，不能手填数值。点击读取后，在扩展模块中查看。':`${m.name}：填写所选字段，开关使用 true / false。`):conflictHelp;
    $('[data-action="remember"]').hidden=Boolean(readonly);$('[data-action="note-mvu-refresh"]').hidden=!readonly;
    $('[data-category-help]').hidden=currentCategory.value!=='conflicts';$('[data-category-help]').textContent=conflictHelp;
  }
  $('[data-note-category]').addEventListener('change',syncFields);currentCategory?.addEventListener('change',syncFields);syncFields();
  $('[data-action="note-mvu-refresh"]').addEventListener('click',()=>run(async()=>{const result=await app.syncModules();if(result.status!=='ready')throw new Error('尚未读取到 MVU，请确认当前聊天的变量框架已初始化');},{name:'custom-read-mvu'}));
  $('[data-action="save-memory-edit"]').addEventListener('click',()=>run(async()=>{await app.editRecord(editingId,$('[data-edit-text]').value,{title:$('[data-edit-title]').value,recallSummary:$('[data-edit-brief]').value,tags:$('[data-edit-tags]').value.split(/[,，]/)});$('[data-edit-memory]').hidden=true;}));
  $('[data-edit-text]').addEventListener('input',()=>{$('[data-edit-brief]').value='';});
  $('[data-action="cancel-memory-edit"]').addEventListener('click',()=>{$('[data-edit-memory]').hidden=true;editingId=null;});
  function edit(id){const card=app.state.cards.find(c=>c.id===id);if(!card)return;editingId=id;$('[data-edit-text]').value=card.category==='entityFactChanges'?readable(card.to??card.value??card.newValue):recordDescription(card);$('[data-edit-title]').value=card.title??'';$('[data-edit-brief]').value=card.recallSummary??'';$('[data-edit-tags]').value=(card.tags??[]).join('，');$('[data-edit-memory]').hidden=false;$('[data-edit-memory]').scrollIntoView({block:'nearest'});}
  panel.addEventListener('shiyi-edit-memory',e=>edit(e.detail));
  function paint(state){
    const grid=$('[data-memory-categories]');grid.innerHTML=MEMORY_CATEGORIES.map(key=>`<button type="button" data-memory-category="${key}" ${currentCategory.value===key?'class="active"':''}><strong>${CATEGORY_LABELS[key]}</strong><small>${state.cards.filter(c=>!c.customModuleId&&c.category===key).length} 条</small></button>`).join('');
    for(const b of grid.querySelectorAll('button'))b.addEventListener('click',()=>selectCategory(b.dataset.memoryCategory));
    const options=JSON.stringify(state.modules??[]);if(options!==lastOptions){lastOptions=options;const select=$('[data-note-category]'),value=select.value;select.innerHTML=`<optgroup label="基础区块">${categoryOptions()}</optgroup>`+(state.modules?.some(m=>!m.archived)?`<optgroup label="扩展模块">${state.modules.filter(m=>!m.archived).map(m=>`<option value="module:${esc(m.id)}">${esc(m.name)}${m.mode==='mvu'?'（MVU 只读）':''}</option>`).join('')}</optgroup>`:'');if([...select.options].some(o=>o.value===value))select.value=value;syncFields();}
    const select=$('[data-note-event]'),value=select.value;select.innerHTML='<option value="">请选择事件</option>'+state.cards.filter(c=>c.category==='events').map(c=>`<option value="${esc(c.id)}">${esc(recordDescription(c).slice(0,60))}</option>`).join('');select.value=value;
    batchList.paint(state);
    $('[data-recycle]').innerHTML=(state.deletedRecords??[]).map(r=>`<div class="sy-document"><span>${esc(batchRecordDescription(r,state.modules))}</span><button type="button" data-restore-record="${esc(r.id)}">恢复</button></div>`).join('')||'<p class="sy-help">没有单独删除的记忆。批次回收站可从上方按钮打开。</p>';
    for(const b of panel.querySelectorAll('[data-restore-record]'))b.addEventListener('click',()=>run(()=>app.restoreRecord(b.dataset.restoreRecord)));
  }
  async function remember(){
    const m=selectedModule(),text=$('[data-note]').value;
    if(m){if(m.mode==='mvu')throw new Error('MVU 区块只读，请使用读取变量');const f=m.fields.find(f=>f.id===$('[data-note-module-field]').value);let value=text;if(f?.type==='number'){if(!text.trim())throw new Error('数值不能为空');value=Number(text);}if(f?.type==='boolean'){if(!['true','false'].includes(text.trim()))throw new Error('开关填写 true 或 false');value=text.trim()==='true';}await app.rememberModule(m.id,f?.id,value,$('[data-note-subject]').value);}
    else await app.remember(text,$('[data-people]').value,{category:$('[data-note-category]').value,subject:$('[data-note-subject]').value,target:$('[data-note-target]').value,field:$('[data-note-field]').value,eventRef:$('[data-note-event]').value});
    $('[data-note]').value='';
  }
  return {paint,edit,remember};
}

export function dictionaryHTML(){return `<div class="sy-card"><h4>自动字典与标签</h4><p class="sy-help">来自当前聊天的总结与已启用的知识库。别称用于找回同一对象，标签用于查找相关事情。</p>${field('查找词条','<input data-dictionary-search placeholder="姓名、别称、地点">')}<label class="sy-toggle"><span>显示已删除词条</span><input type="checkbox" data-dictionary-deleted></label><p data-dictionary-count class="sy-help"></p><div data-dictionary-list></div><div class="sy-actions"><button type="button" data-dictionary-prev>上一页</button><button type="button" data-dictionary-next>下一页</button></div><details><summary>已生成的检索标签</summary><div data-dictionary-tags></div></details><details data-dictionary-editor><summary>添加 / 校正词条</summary>${field('正式名称','<input data-dictionary-name maxlength="80">')}${field('别称','<input data-dictionary-aliases placeholder="用逗号分隔">')}${field('关联检索词（不是别名）','<input data-dictionary-related placeholder="例如校刊、转校手续；用逗号分隔">')}<p class="sy-help">手动校正作为全局设置保存；校正别称不会改变人物事实。</p><div class="sy-actions"><button type="button" data-dictionary-save>保存词条</button><button type="button" data-dictionary-clear>新增另一条</button></div></details></div>`;}
export function mountDictionary({panel,app,run,save=input=>app.saveDictionaryEntry(input)}){
  const $=s=>panel.querySelector(s);if(!$('[data-dictionary-list]'))return {paint(){}};
  let page=1,snapshot=null,signature='';
  function paint(s){snapshot=s;const q=$('[data-dictionary-search]').value.trim().toLocaleLowerCase(),entries=(s.dictionary?.entries??[]).filter(e=>!e.deleted||$('[data-dictionary-deleted]').checked).filter(e=>`${e.name} ${e.aliases.join(' ')}`.toLocaleLowerCase().includes(q));
    const pages=Math.max(1,Math.ceil(entries.length/20));page=Math.min(pages,page);const stamp=JSON.stringify([entries,s.dictionary?.tags,page]);if(signature===stamp)return;signature=stamp;
    $('[data-dictionary-count]').textContent=`${entries.length} 个词条 · ${page} / ${pages} 页`;
    $('[data-dictionary-prev]').disabled=page===1;$('[data-dictionary-next]').disabled=page===pages;
    $('[data-dictionary-list]').innerHTML=entries.slice((page-1)*20,page*20).map(e=>`<article class="sy-dictionary-row"><strong>${esc(e.name)}</strong><span class="sy-tag">${esc(e.kind)}${e.deleted?' · 已删除':e.disabled?' · 已停用':e.manual?' · 已校正':' · 自动'}</span><p>别称：${esc(e.aliases.join('、')||'暂无')}</p>${e.indexWords?.length?`<p>关联检索：${esc(e.indexWords.join('、'))}</p>`:''}${e.ambiguous.length?`<p class="sy-help">同名待区分：${esc(e.ambiguous.join('、'))}</p>`:''}<p class="sy-help">${esc(e.sources.slice(0,3).map(s=>s.title).join('；')||'用户添加')}</p><div class="sy-actions"><button type="button" data-word-delete="${esc(e.name)}">${e.deleted?'恢复词条':'删除'}</button><button type="button" data-word-edit="${esc(e.name)}">校正</button><button type="button" data-word-disable="${esc(e.name)}">${e.disabled?'启用':'停用'}</button>${e.manual?`<button type="button" data-word-reset="${esc(e.name)}">撤销手动校正</button>`:''}</div></article>`).join('')||'<p class="sy-empty">还没有词条。完成新总结或知识库分析后自动生成，也可以手动添加。</p>';
    $('[data-dictionary-tags]').textContent=(s.dictionary?.tags??[]).map(t=>`${t.name} · ${t.count} 条`).join('　')||'暂无标签；可在记忆的修改界面维护。';
    for(const b of panel.querySelectorAll('[data-word-edit]'))b.addEventListener('click',()=>{const entry=entries.find(e=>e.name===b.dataset.wordEdit);$('[data-dictionary-name]').value=entry.name;$('[data-dictionary-aliases]').value=entry.aliases.join('，');$('[data-dictionary-related]').value=(entry.indexWords??[]).join('，');$('[data-dictionary-editor]').open=true;$('[data-dictionary-editor]').scrollIntoView({block:'nearest'});});
    for(const b of panel.querySelectorAll('[data-word-disable]'))b.addEventListener('click',()=>run(()=>{const e=entries.find(e=>e.name===b.dataset.wordDisable);return save({name:e.name,aliases:e.aliases,indexWords:e.indexWords,disabled:!e.disabled});},{name:'save-dictionary'}));
    for(const b of panel.querySelectorAll('[data-word-reset]'))b.addEventListener('click',()=>run(()=>save({name:b.dataset.wordReset,remove:true}),{name:'save-dictionary'}));
  }
  $('[data-dictionary-search]').addEventListener('input',()=>{page=1;paint(snapshot??app.state);});
  $('[data-dictionary-deleted]').addEventListener('change',()=>{page=1;paint(snapshot??app.state);});
  $('[data-dictionary-list]').addEventListener('click',e=>{const b=e.target.closest('[data-word-delete]');if(!b)return;const entry=app.state.dictionary.entries.find(t=>t.name===b.dataset.wordDelete);if(entry)void run(()=>save({...entry,deleted:!entry.deleted,disabled:false}),{name:'save-dictionary'});});
  $('[data-dictionary-prev]').addEventListener('click',()=>{page--;paint(snapshot);});$('[data-dictionary-next]').addEventListener('click',()=>{page++;paint(snapshot);});
  $('[data-dictionary-save]').addEventListener('click',()=>run(()=>save({name:$('[data-dictionary-name]').value,aliases:$('[data-dictionary-aliases]').value,indexWords:$('[data-dictionary-related]').value}),{name:'save-dictionary'}));
  $('[data-dictionary-clear]').addEventListener('click',()=>{$('[data-dictionary-name]').value='';$('[data-dictionary-aliases]').value='';$('[data-dictionary-related]').value='';});
  return {paint};
}
