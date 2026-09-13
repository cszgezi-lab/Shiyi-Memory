import { createProductApplication } from '../src/product-application.js';
import { frameScheduler, readViewState, reconcileMemoryList } from '../src/product-view-scheduling.js';
import { memoryListHTML } from './product-management.js';
import { autoSummaryText } from '../src/product-auto-summary.js';
import { mountPersonEditor } from './product-profile-editor.js';
import { knowledgeImportHTML,mountKnowledgeView } from './product-knowledge-view.js';
import { PRODUCT_SETTING_REGISTRY, PRODUCT_API_SETTING_KEYS } from '../src/product-settings.js';
import { CATEGORY_LABELS, recordDescription, renderMemoryCard } from '../src/product-memory.js';
import { exportProductJson } from '../src/product-host-ui.js';
import { PRODUCT_VERSION, PRODUCT_REPOSITORY } from '../src/product-release.js';
import { mountFloatingProduct } from '../src/product-floating.js';
import { esc, button, field, settingsSection, apiSettingsHTML, missingRecommendations, API_INFO } from '../src/product-settings-ui.js';
import { mergeManagementHTML, mountMergeManagement } from './product-merge-view.js';
import { categoryOptions,memoryEditorHTML,batchManagementHTML,mountMemoryManagement,dictionaryHTML,mountDictionary } from './product-management.js';
import { recordTitle, sourceLabel, recallExplanation, narrativeText } from '../src/product-narrative.js';
import { failureText } from '../src/product-feedback.js';
import { summarySelection } from '../src/product-batches.js';
import { runtimeLogHTML, mountRuntimeLog } from './product-runtime-log.js';
import { summaryPresetsHTML, mountSummaryPresets } from './product-summary-presets.js';

import { recallSectionsHTML, mountRecallView, RECALL_PAGES } from './product-recall-view.js';
import { ASSISTANT_SKILL_VERSION, ASSISTANT_SKILLS, RECOMMENDED_MEMORY_SETTINGS } from '../src/product-assistant-skills.js';
import { customModulesHTML,mountCustomModules,moduleProposalHTML } from './product-custom-modules.js';

const ID='shiyi-product-shell';
const NAV=['memory','recording','recall','assistant','api','modules'];

export function initProductShell({documentRef=globalThis.document,host=globalThis,application=null,controller=null,controllerOptions={}}={}){
 if(!documentRef||documentRef.getElementById?.(ID))return null;
 const panel=documentRef.createElement('section');panel.id=ID;panel.className='sy-root';
 panel.innerHTML=`<div class="sy-shell"><div class="sy-brand"><span class="sy-mark">拾</span><span>拾忆<small>让故事有迹可循</small></span><span class="sy-version">${PRODUCT_VERSION}</span></div><div class="sy-body">
 <div class="sy-top"><span data-scope>尚未打开聊天</span><div class="sy-actions">${button('open','启用插件',true)}${button('disable','暂停插件')}</div></div><p role="status" aria-live="polite" class="sy-status" data-status>连接一个模型，就可以开始整理故事。</p>
 <nav class="sy-nav" aria-label="拾忆导航">${['记忆','记录','召回','助手','API','设置'].map((v,i)=>`<button type="button" data-page="${NAV[i]}" ${i===0?'class="active"':''}>${v}</button>`).join('')}</nav>
 <section data-view="memory"><div class="sy-top"><h3>故事记忆</h3>${button('refresh','刷新')}</div>
 <p class="sy-help">查看已保存的故事细节，或直接补充一件事。</p>
 <details class="sy-card" data-quality-panel><summary>内容校对 <small data-quality-count></small></summary><p class="sy-help">只核对缺项与矛盾，不重做总结；人工确认保留。</p><div class="sy-actions">${button('review-memory','校对／重试未完成',true)}${button('undo-quality','撤销自动校对')}${button('stop','停止')}</div><div data-quality-status role="status"></div></details>
 ${memoryEditorHTML()}
 ${customModulesHTML()}
 <div class="sy-filters"><input data-search aria-label="搜索记忆" placeholder="搜索人物、事件、地点…"><select data-category aria-label="记忆类别"><option value="all">全部类别</option>${categoryOptions()}</select></div><div data-cards><p class="sy-empty">这里还没有记忆。整理一段聊天，或记一件事。</p></div>
 </section>
 <section data-view="recording" hidden><h3>记录聊天</h3><div class="sy-record-tabs"><button type="button" data-record-tab="compose" class="active">手动总结</button><button type="button" data-record-tab="automatic">自动总结</button><button type="button" data-record-tab="presets">总结预设</button><button type="button" data-record-tab="batches">批次管理</button><button type="button" data-record-tab="merges">事件合并</button><button type="button" data-record-tab="logs">运行日志</button></div><div data-record-panel="compose"><div class="sy-card"><h4>手动总结</h4>${field('总结范围','<select data-range-mode><option value="recent">最近 N 楼</option><option value="range">指定起止楼层</option></select>')}<div data-range-fields="recent">${field('最近多少楼','<input type="number" min="1" max="100000" value="8" data-count>')}<p class="sy-help">最后一楼为 20、填 10，即整理 11–20。</p></div><div data-range-fields="range" hidden><div class="sy-grid">${field('从哪一楼','<input type="number" min="0" data-start placeholder="与聊天 # 编号相同" disabled>')}${field('到哪一楼','<input type="number" min="0" data-end placeholder="包含结束楼" disabled>')}</div></div>${field('每多少楼记录一次','<input type="number" min="1" max="200" value="5" data-batch-size>')}<p class="sy-help" data-summary-selection role="status"></p>${field('本次想记得更细的内容','<textarea rows="3" data-focus placeholder="留空时沿用长期记录偏好"></textarea>')}<div class="sy-actions">${button('focus-summary','开始总结',true)}${button('stop','停止')}</div></div>${settingsSection('recording')}${button('save-settings','保存记录设置',true)}</div><div data-record-panel="automatic" hidden>${settingsSection('automatic')}</div><div data-record-panel="presets" hidden>${summaryPresetsHTML()}</div><div data-record-panel="batches" hidden>${batchManagementHTML()}</div><div data-record-panel="merges" hidden>${mergeManagementHTML()}</div><div data-record-panel="logs" hidden>${runtimeLogHTML()}</div></section>
 <section data-view="current" hidden><h3>本轮记忆</h3><p class="sy-help">本地预览不发送模型请求。向量与重排仅在启用且实际使用时调用。</p>${field('当前剧情查询','<textarea rows="3" data-query></textarea>')}${button('preview','预览本地召回',true)}${button('preview-online','按已启用接口试召回')}<div data-preview></div><h3>最近一次请求准备</h3><div data-actual><p class="sy-empty">尚未向宿主请求加入记忆。</p></div></section>
 <section data-view="assistant" hidden><div class="sy-top"><h3>配置助手</h3><span data-model></span></div><div class="sy-actions"><button type="button" data-jump="api">模型设置</button><button type="button" data-jump="world">添加 TXT / MD / JSON</button></div><div class="sy-actions"><select data-conversation aria-label="历史对话"><option value="main">配置对话</option></select>${button('new-conversation','新对话')}${button('delete-conversation','删除本次对话')}</div><details class="sy-card" data-builtin-skills><summary>内置配置规则 v${ASSISTANT_SKILL_VERSION} · ${ASSISTANT_SKILLS.length} 组</summary>${ASSISTANT_SKILLS.map(skill=>`<details><summary>${esc(skill.title)}</summary><p class="sy-help">${esc(skill.text)}</p></details>`).join('')}</details><div data-history><p class="sy-empty">说说想怎样记忆，也可以一次说完全部要求。</p></div><div data-proposal></div>${field('你的要求','<textarea rows="4" data-input placeholder="描述你的卡、想保留的细节、希望避免的问题，或让我按导入的规则配置。"></textarea>')}<div class="sy-actions">${button('assistant','发送',true)}${button('builtin-beginner','按内置新手规则配置')}${button('beginner','按导入的规则配置')}${button('assistant-stop','停止')}</div><p class="sy-help">Key 不会发送给助手；设置方案应用后才生效。</p></section>
 <section data-view="api" hidden><h3>API 与模型</h3><p class="sy-help">所有聊天共用，无需打开聊天即可配置、拉取模型和测试连接。</p>${apiSettingsHTML()}${button('save-settings','保存 API 设置',true)}</section>
 ${recallSectionsHTML()}
 <section data-view="modules" hidden><h3>模块</h3><div class="sy-module-grid">${[['injection','注入','调整发给 AI 的记忆'],['retrieval','检索','关键词、向量与重排'],['world','世界与知识库','原作、规则文件与别名'],['settings','设置与备份','配置、数据与版本']].map(([key,title,help])=>`<button type="button" data-page="${key}"><strong>${title}</strong><small>${help}</small></button>`).join('')}</div></section>
 <section data-view="injection" hidden><h3>注入</h3>${settingsSection('injection')}${button('save-settings','保存注入设置',true)}<button type="button" data-page="current">查看本轮记忆与召回预览</button></section>
 <section data-view="retrieval" hidden><h3>检索</h3>${field('筛选档位','<select data-recall-level><option value="24">通用均衡 · 24 条候选</option><option value="48">更细筛选 · 48 条候选</option></select>')}${button('save-recall-preset','应用分类策略')}<p class="sy-help">字典扩展别称与主题 → BM25 精确词匹配、向量找语义近似 → 分类候选合并 → 重排比较相关性 → 去重并按注入预算选取。重排不负责事件合并。扩大候选不增加最终注入上限，但可能增加接口耗时。通用策略是本项目九类记忆的初始配置，并非复制 ANIMA 的特定角色参数，也不是实测最优值；不改变 API、注入上限或向量开关。</p>${settingsSection('retrieval')}<div class="sy-actions">${button('save-settings','保存检索设置',true)}</div></section>
 <section data-view="world" hidden><h3>世界与知识库</h3>${settingsSection('world')}${button('save-settings','保存世界设置',true)}<button type="button" data-page="dictionary">查看自动字典与标签</button>${knowledgeImportHTML()}</section>
 <section data-view="settings" hidden><h3>设置与备份</h3>${button('recommended-memory','应用推荐记忆参数')}<p class="sy-help">5 楼一批、总结回复上限 8192，字典/标签/分类候选开启。保留你的 API、记录偏好与自动运行开关。</p><p class="sy-help">插件设置、资料库和助手对话为全局；故事记忆按聊天隔离。</p><details class="sy-card" open><summary>数据与备份</summary><div class="sy-actions">${button('export-config','导出纯配置')}${button('export-global','导出全局资料与助手备份')}${button('export-backup','导出当前聊天备份')}${button('restore-hidden','恢复不再召回的记录')}${button('undo','撤销上次助手配置')}</div><p class="sy-help">纯配置不含记忆、附件、历史或 Key；完整备份包含当前聊天私人内容，请自行保管。</p></details></section><p data-progress class="sy-help"></p></div></div>`;
 const $=s=>panel.querySelector?.(s),$$=s=>[...(panel.querySelectorAll?.(s)??[])];let app=application,snapshot=null,currentPage='memory';
 const modelRequests=new Map(),dirtyApi=new Set();let autoStartDirty=false,autoScope=null,personEditor=null,knowledgeView=null;let management=null,customManagement=null,logView=null,dictionaryView=null,recallView=null,mergeView=null;let presetView=null;let floating=null,lastFeedbackId=null,noticeText='打开聊天后自动加载对应记忆和总结批次。',noticeLevel='info';
 function feedback(text,level='info',toast=false){noticeText=text;noticeLevel=level;floating?.setNotice(text,level);if(toast)host.toastr?.[['success','error','warning','info'].includes(level)?level:'info']?.(text,'拾忆',{escapeHtml:true});}
 function resetModels(kind){const pending=modelRequests.get(kind);pending?.abort();modelRequests.delete(kind);if(pending)feedback('模型列表请求已取消，请按当前配置重新拉取。');const list=$(`[data-model-list="${kind}"]`);if(list){list.innerHTML='<option value="">先拉取模型列表，也可以在下方直接输入</option>';list.disabled=true;}const b=$(`[data-action="models-${kind}"]`);if(b){b.disabled=false;b.textContent='拉取模型列表';}if($(`[data-model-status="${kind}"]`))$(`[data-model-status="${kind}"]`).textContent='';floating?.setBusy(Boolean(app?.state.busy)||modelRequests.size>0);}
 function resetAllModels(){for(const kind of Object.keys(API_INFO))resetModels(kind);}
 function syncInherited(){for(const kind of ['assistant','supplement']){const follow=$(`[data-setting="${kind}FollowSummary"]`)?.checked;if($(`[data-api-fields="${kind}"]`))$(`[data-api-fields="${kind}"]`).hidden=kind==='assistant'&&follow;if(kind==='supplement'){const connection=$('[data-api-connection="supplement"]');if(connection)connection.hidden=follow;const advanced=$('[data-api-card="supplement"] .sy-advanced');if(advanced)advanced.hidden=follow;}const notice=$(`[data-inherited="${kind}"]`);if(notice){const model=$('[data-setting="providerModel"]')?.value||'请先设置总结模型';notice.textContent=follow?(kind==='supplement'?'共用总结地址和 Key；模型以下方选择为准。':`正在沿用：${model}`):'';}}}
 let cardStamp='';
 function paintCards(){
    if(!snapshot||!$('[data-cards]'))return;
    if(floating?.window.hidden||currentPage!=='memory')return;
    const stamp=JSON.stringify([snapshot.cardRevision??snapshot.cards,snapshot.settings,$('[data-search]')?.value,$('[data-category]')?.value]);
    if(stamp===cardStamp)return;cardStamp=stamp;
   const q=($('[data-search]')?.value??'').trim(),category=$('[data-category]')?.value??'all',opened=new Set($$('[data-memory-detail][open]').map(n=>n.dataset.memoryDetail));
   const updated=reconcileMemoryList($('[data-cards]'),memoryListHTML(snapshot.cards,{settings:snapshot.settings,q,category,opened}));
   const changedButtons=selector=>updated.flatMap(el=>[...el.querySelectorAll(selector)]);
   for(const b of changedButtons('[data-hide]'))b.addEventListener('click',()=>run(()=>app.hideRecord(b.dataset.hide)));
   for(const b of changedButtons('[data-edit]'))b.addEventListener('click',()=>management?.edit(b.dataset.edit));
   for(const b of changedButtons('[data-edit-profile]'))b.addEventListener('click',()=>personEditor?.open(b.dataset.editProfile));personEditor?.reattach();
   for(const b of changedButtons('[data-delete]'))b.addEventListener('click',()=>run(async()=>{if(host.confirm?.('删除这条记忆？可从回收站恢复，不影响聊天原文。'))await app.deleteRecord(b.dataset.delete);}));
   for(const b of changedButtons('[data-delete-profile]'))b.addEventListener('click',()=>run(async()=>{
     const ids=snapshot.cards.filter(c=>!c.customModuleId&&c.category==='entityFactChanges'&&(c.entity??c.entityId)===b.dataset.deleteProfile).map(c=>c.id);
     if(host.confirm?.(`删除“${b.dataset.deleteProfile}”档案中的 ${ids.length} 条属性记录？可在回收站恢复，不删除聊天原文及其他模块。`))await app.deleteRecords(ids);
   }));
 }
 function paint(s){snapshot=s;for(const [sel,value]of [['[data-status]',s.message],['[data-scope]',s.chatReady?`当前聊天 · 已连接${s.enabled?'':' · 自动任务未启用'}`:s.status==='loading'?'正在加载当前聊天…':s.status==='no_chat'?'尚未打开聊天':s.stale?'正在重新核对聊天来源…':'等待当前聊天就绪'],['[data-progress]',s.progress]])if($(sel)&&$(sel).textContent!==value)$(sel).textContent=value;
   if(s.feedback&&s.feedback.id!==lastFeedbackId){lastFeedbackId=s.feedback.id;feedback(s.feedback.text,s.feedback.level,['success','error'].includes(s.feedback.level));}
   // Background diagnostic persistence must not erase a visible operation error.
   if(noticeLevel==='error'&&$('[data-status]'))$('[data-status]').textContent=noticeText;
    floating?.setBusy(s.busy||modelRequests.size>0);
    if(floating?.window.hidden)return;
    const memory=currentPage==='memory',recording=currentPage==='recording',recordTab=$('[data-record-tab].active')?.dataset.recordTab;
    if(memory){paintCards();customManagement?.paint(s);}
    if(memory||recording&&recordTab==='batches')management?.paint(s,{memory,batches:recording&&recordTab==='batches'});
    if(recording&&recordTab==='logs')logView?.paint(s);
    if(recording&&recordTab==='merges')mergeView?.paint(s);
    if(currentPage==='dictionary')dictionaryView?.paint(s);
    if(RECALL_PAGES.includes(currentPage))recallView?.paint(s);
    if(memory){
   if($('[data-quality-count]'))$('[data-quality-count]').textContent=s.chatReady?`已核对 ${s.quality?.reviewed??0}/${s.quality?.groups??0} 组`:'';
   if($('[data-quality-status]')){const q=s.quality??{},items=[...new Set([...(q.issues??[]),...(q.unresolved??[])].map(i=>i.description))];$('[data-quality-status]').innerHTML=`<p class="sy-help">${esc(s.qualityProgress||`${q.failed??0} 组未完成。规则候选不代表已确认错误，核对完成也不保证没有遗漏。`)}</p>${items.length?`<details><summary>${items.length} 条核对线索</summary>${items.map(t=>`<p class="sy-help">${esc(t)}</p>`).join('')}</details>`:''}`;}
    }
    if(recording&&recordTab==='automatic'&&$('[data-auto-progress]')&&s.automatic){$('[data-auto-progress]').textContent=autoSummaryText(s.automatic);const scope=JSON.stringify(s.core?.scope);if(autoScope!==scope){autoScope=scope;autoStartDirty=false;}if(!autoStartDirty)$('[data-auto-start]').value=s.automatic.startFloor;}
   if($('[data-setting="autoSummaryEnabled"]'))$('[data-setting="autoSummaryEnabled"]').checked=s.settings.autoSummaryEnabled;
    if(currentPage==='api')for(const f of $$('[data-key]')){const kind=f.getAttribute('data-key');f.placeholder=s.credentialPresent?.[kind]?'已保存 / 已填入；输入新 Key 可替换':'无需认证的服务可以留空';const status=$(`[data-key-status="${kind}"]`);if(status)status.textContent=s.credentialErrors?.[kind]??(s.credentialDirty?.[kind]?'新输入的 Key 尚未保存。':s.credentialSaved?.[kind]?(s.credentialPresent?.[kind]?'Key 已保存，重启后自动使用。':'已保存的 Key 属于其他地址；请重新输入本地址的 Key。'):(s.credentialPresent?.[kind]?'Key 尚未保存，点击本模型的保存按钮。':'尚未保存 Key；无需认证的服务可以留空。'));}
    if(currentPage==='assistant'){
    if($('[data-model]'))$('[data-model]').textContent=s.settings.assistantFollowSummary?s.settings.providerModel:s.settings.assistantModel;
   if($('[data-history]'))$('[data-history]').innerHTML=s.history.map(m=>`<article class="sy-message ${m.role==='user'?'is-user':''}"><strong>${m.role==='user'?'你':'配置助手'}</strong><div>${esc(m.content)}</div></article>`).join('')||'<p class="sy-empty">描述你的想法，助手会生成可应用的方案。</p>';
   if($('[data-proposal]')){const p=s.proposal;$('[data-proposal]').innerHTML=p?`<div class="sy-plan"><h4>待应用方案</h4><p>${esc(p.explanation)}</p>${p.kind==='module'?moduleProposalHTML(p):Object.entries(p.patch).map(([k,v])=>`<p><strong>${esc(PRODUCT_SETTING_REGISTRY[k]?.label??k)}</strong><br>${esc(p.before[k])} → ${esc(v)}</p>`).join('')}${button('apply','应用并保存',true)}</div>`:'';$('[data-action="apply"]')?.addEventListener('click',()=>run(async()=>{await app.applyProposal();fill();}));}
    }
    if(recording&&recordTab==='presets')presetView?.paint(s);
    if(currentPage==='world')knowledgeView?.paint(s);
    if(currentPage==='current'){
    if($('[data-preview]'))$('[data-preview]').innerHTML=s.preview?`<p class="sy-help">预览 · ${s.preview.usedUnits} 估算单位 · ${s.preview.cards.length} 条（非精确 TOKEN 数）</p>${s.preview.degraded?'<p role="status">本轮召回已降级：在线接口失败或向量索引不完整，可能遗漏相关记忆。</p>':''}<div class="sy-packet">${esc(s.preview.text||'没有相关记忆')}</div><details><summary>这次如何找到记忆</summary><div class="sy-packet sy-help">${esc(recallExplanation(s.preview.trace))}</div></details>`:'';
   if($('[data-actual]'))$('[data-actual]').innerHTML=s.actual?`<p class="sy-help">已加入待发送请求；不代表服务端已接收。${s.actual.usedUnits} 估算单位</p>${s.actual.degraded?'<p role="status">本轮召回已降级，不能视为完整检索结果。</p>':''}<div class="sy-packet">${esc(s.actual.text)}</div><details><summary>这次如何找到记忆</summary><div class="sy-packet sy-help">${esc(recallExplanation(s.actual.trace))}</div></details>`:'<p class="sy-empty">尚未向宿主请求加入记忆。</p>';
    }
  }
  const painting=frameScheduler(documentRef.defaultView??host,()=>paint(readViewState(app)));
  app??=createProductApplication({host,controller,...controllerOptions,onChange:paint,onInvalidate:()=>painting.request()});
 function fill({apiOnly=false}={}){const s=readViewState(app);for(const f of $$('[data-setting]')){const key=f.getAttribute('data-setting');if(dirtyApi.has(key))continue;if(f.type==='checkbox')f.checked=Boolean(s.settings[key]);else f.value=s.settings[key]??'';}{if($('[data-input]'))$('[data-input]').value=s.draft??'';if($('[data-count]'))$('[data-count]').value=s.settings.messageCount;if($('[data-batch-size]'))$('[data-batch-size]').value=s.settings.summaryBatchSize;const select=$('[data-conversation]');if(select){select.innerHTML=s.conversations.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')||'<option value="main">配置对话</option>';select.value=s.conversationId;}}syncInherited();syncSummaryRange();}
 function collect(root=panel){const patch={};for(const f of root.querySelectorAll('[data-setting]')){const k=f.getAttribute('data-setting'),d=PRODUCT_SETTING_REGISTRY[k];if(['number','integer'].includes(d.type)&&f.value.trim()==='')throw new Error(`${d.label}不能为空`);patch[k]=d.type==='boolean'?f.checked:['number','integer'].includes(d.type)?Number(f.value):f.value;}return patch;}
 function apiPatch(kind,forRequest=false){const patch=collect($(`[data-api-card="${kind}"]`));if(forRequest&&['assistant','supplement'].includes(kind)&&patch[`${kind}FollowSummary`])Object.assign(patch,collect($('[data-api-card="summary"]')));return patch;}
 async function loadModels(kind){
   resetModels(kind);const request=new AbortController();modelRequests.set(kind,request);
   const status=$(`[data-model-status="${kind}"]`),fetchButton=$(`[data-action="models-${kind}"]`),title=API_INFO[kind].title;
   fetchButton.disabled=true;fetchButton.textContent='正在拉取…';status.textContent='正在拉取…';feedback(`${title}：正在拉取模型列表…`,'running');floating?.setBusy(true);
   try{const models=await app.listModels(kind,{patch:apiPatch(kind,true),modelsUrl:$(`[data-models-url="${kind}"]`).value,signal:request.signal});if(modelRequests.get(kind)!==request)return;
     const select=$(`[data-model-list="${kind}"]`),value=$(`[data-setting="${API_INFO[kind].prefix}Model"]`).value;
     select.innerHTML='<option value="">请选择模型</option>'+models.map(id=>`<option value="${esc(id)}">${esc(id)}</option>`).join('');select.disabled=!models.length;select.value=models.includes(value)?value:'';
     status.textContent=models.length?`已获取 ${models.length} 个模型`:'服务返回空列表，可直接输入模型名称。';feedback(`${title}：${status.textContent}`,models.length?'success':'info',models.length>0);
   }catch(error){if(modelRequests.get(kind)===request){status.textContent=`拉取${error.code==='CANCELED'?'已停止':'失败'}：${failureText(error)}`;feedback(`${title}：${status.textContent}`,error.code==='CANCELED'?'info':'error',error.code!=='CANCELED');}}
   finally{if(modelRequests.get(kind)===request){modelRequests.delete(kind);fetchButton.disabled=false;fetchButton.textContent='拉取模型列表';floating?.setBusy(Boolean(readViewState(app).busy)||modelRequests.size>0);}}
 }
 async function run(fn,{name='',button:control}={}){
   const label=name.startsWith('test-')?`${API_INFO[name.slice(5)]?.title??'模型'}连接测试`:name.startsWith('save-')?'保存设置':({'custom-save-module':'保存区块','custom-save-module-value':'保存记录','custom-read-mvu':'读取 MVU','custom-import-modules':'导入区块',open:'启用自动任务',assistant:'配置助手',beginner:'规则配置',summarize:'总结','focus-summary':'总结',analyze:'分析资料',vectors:'建立向量索引',import:'导入文件',remember:'保存记事'})[name];
   const isSummary=['summarize','focus-summary'].includes(name),isModels=name.startsWith('models-'),before=lastFeedbackId;
   const oldLabel=control?.textContent;if(label){feedback(`${label}中…`,'running');if(control){control.disabled=true;control.textContent=`${label}中…`;}}
   try{const result=await fn();painting.request();if(name.startsWith('test-')&&result?.message)feedback(`${API_INFO[name.slice(5)]?.title??'模型'}：${result.message}`,result.level??'info',true);else if(name==='vectors'&&result?.message)feedback(result.message,result.pending?'warning':'success',true);else if(result?.message&&result?.level&&!isSummary)feedback(result.message,result.level,true);else if(label&&!isSummary&&!isModels)feedback(`${label}完成`,'success',true);}
   catch(e){void app.reportError?.(e,{stage:'ui'});const text=`${label??'操作'}未完成：${failureText(e)}`;if($('[data-status]'))$('[data-status]').textContent=text;if(!isSummary||before===lastFeedbackId)feedback(text,['CANCELED','CHAT_CHANGED','SOURCE_INVALIDATED'].includes(e?.code)?'info':'error',!['CANCELED','CHAT_CHANGED','SOURCE_INVALIDATED'].includes(e?.code));}
   finally{if(control&&label){control.disabled=false;control.textContent=oldLabel;}floating?.setBusy(Boolean(readViewState(app).busy)||modelRequests.size>0);}
 }
 function selectedSummary(withFocus=true){return summarySelection({mode:$('[data-range-mode]').value,count:$('[data-count]').value,startIndex:$('[data-start]').value,endIndex:$('[data-end]').value,batchSize:$('[data-batch-size]').value,focus:withFocus?$('[data-focus]').value:''});}
 function syncSummaryRange(){
   const mode=$('[data-range-mode]')?.value??'recent';
   for(const section of $$('[data-range-fields]')){section.hidden=section.dataset.rangeFields!==mode;for(const input of section.querySelectorAll('input'))input.disabled=section.hidden;}
   const preview=$('[data-summary-selection]');if(!preview)return;
   try{const value=selectedSummary(false);preview.textContent=mode==='range'?`本次：#${value.startIndex}–${value.endIndex}，共 ${value.endIndex-value.startIndex+1} 楼，每 ${value.batchSize} 楼一批。`:`本次：最近 ${value.count} 楼，每 ${value.batchSize} 楼一批。`;}catch{preview.textContent=mode==='range'?'请填写起止楼层。':'请填写楼数与每批楼数。';}
 }
 function summarize(withFocus){return app.summarize(selectedSummary(withFocus));}
 async function download(data,name){const result=await exportProductJson(data,name,{host,documentRef});host.toastr?.success?.(result.mode==='mobile-native'?'已保存到手机 Downloads':'已提交导出');return result;}
 const actions={open:async()=>{await app.open();fill();},disable:()=>app.disable(),refresh:()=>app.refresh(),summarize:()=>summarize(false),'focus-summary':()=>summarize(true),stop:()=>app.stop(),'assistant-stop':()=>app.stop(),remember:async()=>{await app.remember($('[data-note]')?.value??'',$('[data-people]')?.value??'',{category:$('[data-note-category]')?.value??'events',subject:$('[data-note-subject]')?.value??'',target:$('[data-note-target]')?.value??'',field:$('[data-note-field]')?.value??'',eventRef:$('[data-note-event]')?.value??''});if($('[data-note]'))$('[data-note]').value='';},preview:()=>app.preview($('[data-query]')?.value??''),'preview-online':()=>app.preview($('[data-query]')?.value??'',{online:true}),'vector-status':()=>app.refreshVectorStatus(),'save-settings':()=>app.saveSettings(collect()),'test-summary':()=>app.testConnection('summary'),'test-assistant':()=>app.testConnection('assistant'),'test-embedding':()=>app.testConnection('embedding'),'test-rerank':()=>app.testConnection('rerank'),import:async()=>{for(const f of Array.from($('[data-files]')?.files??[]))await app.addDocument({name:f.name,text:await f.text(),purpose:$('[data-purpose]')?.value});},analyze:()=>app.analyzeDocuments(),assistant:async()=>{await app.assistant($('[data-input]')?.value??'');if($('[data-input]'))$('[data-input]').value='';},beginner:async()=>{await app.analyzeDocuments();await app.assistant('按我导入的配置规则一次性生成完整设置方案，只有必要信息缺失才询问，不需要逐项问卷。');},'new-conversation':async()=>{await app.newConversation();fill();},'delete-conversation':async()=>{if(host.confirm?.('删除当前助手对话？已应用设置和记忆不会删除。')){await app.deleteConversation();fill();}},'restore-hidden':()=>app.restoreHidden(),vectors:()=>app.buildVectors(),undo:async()=>{await app.undoSettings();fill();},'export-config':()=>download(app.exportSettings(),'拾忆-配置.json'),'export-global':async()=>download(await app.exportGlobalBackup(),'拾忆-全局备份.json'),'export-backup':async()=>download(await app.exportBackup(),'拾忆-聊天备份.json')};
 actions.remember=()=>management?.remember();
 actions['review-memory']=()=>app.reviewMemory();
 actions['undo-quality']=async()=>{if(host.confirm?.('撤销此聊天的自动校对？恢复原总结；校对补入的属性和知情项将撤下，人工修改的原记录保留。'))await app.undoQuality();};
 actions['builtin-beginner']=()=>app.assistant('按内置新手配置规则帮助我配置拾忆。先查看当前设置和相关规则，保留已经填好的模型连接。只有卡类型、变量系统或记录偏好等必要信息缺失时才询问；生成可确认应用的方案。');
 $('[data-auto-start]')?.addEventListener('input',()=>{autoStartDirty=true;});
 const saveAutomatic=async()=>{const floor=Number($('[data-auto-start]').value),scope=readViewState(app).core?.scope,patch=collect($('[data-record-panel="automatic"]'));await app.saveSettings(patch);await app.setAutoStartFloor(floor,scope);autoStartDirty=false;};
 actions['auto-save']=saveAutomatic;actions['auto-inspect']=()=>app.inspectAutomaticProgress();actions['auto-process']=()=>app.processAutomatic();
 actions['auto-start']=async()=>{await saveAutomatic();await app.setAutomatic(true);fill();};actions['auto-pause']=async()=>{await app.setAutomatic(false);fill();};
 actions['per-call-mode']=async()=>{const patch={summaryReviewEnabled:false,summaryStaged:false,autoMergeEnabled:false,autoQualityEnabled:false};await app.saveSettings(patch);for(const key of Object.keys(patch))dirtyApi.delete(key);fill();feedback('已改为一次主总结；不自动追加分工、合并和校对请求。API、楼数、回复上限不变。','success');};
 actions['recommended-memory']=async()=>{if(!host.confirm?.('将总结与召回参数设为推荐值（5楼一批、回复8192）。不改 API、Key、记录偏好和自动运行开关。确认应用？'))return;await app.saveSettings(RECOMMENDED_MEMORY_SETTINGS);for(const k of Object.keys(RECOMMENDED_MEMORY_SETTINGS))dirtyApi.delete(k);fill();};
 actions['save-recall-preset']=async()=>{const count=Number($('[data-recall-level]').value),patch={dictionaryEnabled:true,tagRecallEnabled:true,distributedEnabled:true,distributedStrategy:'broadcast',retrievalCandidateLimit:count,rerankMaxCandidates:count};await app.saveSettings(patch);for(const key of Object.keys(patch))dirtyApi.delete(key);fill();};
 async function savePatch(patch,save=()=>app.saveSettings(patch)){await save();for(const [key,value]of Object.entries(patch)){const f=$(`[data-setting="${key}"]`);if(f&&(f.type==='checkbox'?f.checked===value:f.value===String(value)))dirtyApi.delete(key);}}
 actions['save-settings']=async()=>{if(currentPage==='api'){for(const kind of Object.keys(API_INFO))await saveApiCard(kind);await savePatch(collect($('[data-view="api"]')));}else await savePatch(collect($(`[data-view="${currentPage}"]`)));};
 async function saveApiCard(kind){const input=$(`[data-key="${kind}"]`),value=input.value,patch=apiPatch(kind);if(value)app.setKey(kind,value,patch[`${API_INFO[kind].prefix}Endpoint`]);await savePatch(patch,()=>app.saveApi(kind,patch,{keyValue:value}));if(input.value===value)input.value='';}
 for(const kind of Object.keys(API_INFO)){
   actions[`save-api-${kind}`]=()=>saveApiCard(kind);
   actions[`forget-key-${kind}`]=async()=>{if(host.confirm?.('清除此模型保存的 Key？地址、模型和记忆不会删除。')){await app.forgetKey(kind);$(`[data-key="${kind}"]`).value='';resetModels(kind);}};
   actions[`test-${kind}`]=()=>app.testConnection(kind,apiPatch(kind,true));
   actions[`models-${kind}`]=()=>loadModels(kind);
   actions[`recommend-${kind}`]=()=>{const patch=missingRecommendations(apiPatch(kind),kind);for(const [k,v]of Object.entries(patch)){$(`[data-setting="${k}"]`).value=v;dirtyApi.add(k);}resetModels(kind);$(`[data-model-status="${kind}"]`).textContent=Object.keys(patch).length?'已补齐，点击保存后生效。':'已有配置保持不变。';};
 }
 for(const [name,fn]of Object.entries(actions))for(const b of $$(`[data-action="${name}"]`))b.addEventListener?.('click',()=>run(fn,{name,button:b}));
 for(const selector of ['[data-range-mode]','[data-count]','[data-start]','[data-end]','[data-batch-size]'])$(selector).addEventListener(selector==='[data-range-mode]'?'change':'input',syncSummaryRange);
 function showRecordTab(name){for(const section of $$('[data-record-panel]'))section.hidden=section.dataset.recordPanel!==name;for(const tab of $$('[data-record-tab]'))tab.classList.toggle('active',tab.dataset.recordTab===name);setPage('recording');if(name==='logs')void app.loadRuntimeLog?.().then(()=>paint(readViewState(app)));}
 for(const b of $$('[data-record-tab]'))b.addEventListener('click',()=>showRecordTab(b.dataset.recordTab));
 const logJump=documentRef.createElement('button');logJump.type='button';logJump.textContent='查看运行日志';logJump.dataset.openLogs='';logJump.addEventListener('click',()=>{setPage('recording');showRecordTab('logs');});$('[data-status]')?.after(logJump);
 const pageButtons=$$('[data-page]');
 function setPage(page){if(!$(`[data-view="${page}"]`))return currentPage;currentPage=page;if(['recall','vectors'].includes(page))void app.refreshVectorStatus?.({cached:true});for(const s of $$('[data-view]'))s.hidden=s.getAttribute('data-view')!==page;for(const b of pageButtons)b.classList?.toggle('active',b.getAttribute('data-page')===page||b.getAttribute('data-page')==='recall'&&RECALL_PAGES.includes(page)||b.getAttribute('data-page')==='modules'&&!NAV.includes(page)&&!RECALL_PAGES.includes(page));if($('[data-open-logs]'))$('[data-open-logs]').hidden=!['memory','recording','api','assistant'].includes(page);const chatControls=$('[data-scope]')?.closest?.('.sy-top');if(chatControls)chatControls.hidden=!['memory','recording','current'].includes(page);if($('[data-status]'))$('[data-status]').hidden=!['memory','recording','current'].includes(page);if(page==='recording'&&!$('[data-record-panel="logs"]').hidden){if(chatControls)chatControls.hidden=true;if($('[data-status]'))$('[data-status]').hidden=true;if($('[data-open-logs]'))$('[data-open-logs]').hidden=true;}panel.closest?.('.sy-workbench-content')?.scrollTo?.(0,0);painting.flush();return page;}
 for(const b of pageButtons)b.addEventListener?.('click',()=>setPage(b.getAttribute('data-page')));
 for(const b of $$('[data-jump]'))b.addEventListener?.('click',()=>setPage(b.getAttribute('data-jump')));
 for(const f of $$('[data-key]'))f.addEventListener?.('input',()=>{const kind=f.getAttribute('data-key');app.setKey(kind,f.value,$(`[data-setting="${API_INFO[kind].prefix}Endpoint"]`)?.value);resetModels(kind);if(kind==='summary'){resetModels('assistant');resetModels('supplement');}});
 for(const [kind,{prefix}]of Object.entries(API_INFO)){
   for(const f of $$(`[data-api-card="${kind}"] [data-setting], [data-models-url="${kind}"]`))f.addEventListener('input',()=>{if(f.getAttribute('data-setting')!==`${prefix}Model`)resetModels(kind);if(kind==='summary'){resetModels('assistant');resetModels('supplement');}syncInherited();});
   $(`[data-model-list="${kind}"]`)?.addEventListener('change',e=>{if(e.target.value){$(`[data-setting="${prefix}Model"]`).value=e.target.value;dirtyApi.add(`${prefix}Model`);}syncInherited();});
 }
 for(const f of $$('[data-setting]'))f.addEventListener?.('input',()=>{dirtyApi.add(f.dataset.setting);});
 $('[data-search]')?.addEventListener?.('input',()=>painting.request());$('[data-category]')?.addEventListener?.('change',paintCards);$('[data-conversation]')?.addEventListener?.('change',()=>run(async()=>{await app.selectConversation($('[data-conversation]').value);fill();}));
 let timer;$('[data-input]')?.addEventListener?.('input',()=>{clearTimeout(timer);const value=$('[data-input]').value,context=app.draftContext;timer=setTimeout(()=>run(()=>app.setDraft(value,context)),350);});
 const updates=documentRef.createElement('details');updates.className='sy-card';
 updates.innerHTML=`<summary>版本与更新 · ${PRODUCT_VERSION}</summary><p class="sy-help">从 Git 安装后，在 TT 的扩展管理中检查拾忆更新。更新完成，等待当前任务结束、保存设置后重载页面即可生效，不需要重装 TT。记忆与已保存的 Key 保留。</p><a href="${PRODUCT_REPOSITORY}" target="_blank" rel="noopener noreferrer">安装地址与更新说明</a>`;
 $('[data-view="settings"]')?.appendChild(updates);
 // Populate the real form at mount, before any explicit chat binding or request.
 presetView=mountSummaryPresets({panel,app,run,host,download});mergeView=mountMergeManagement({panel,app,run,host});recallView=mountRecallView({panel,app,run,setPage,host,download});logView=mountRuntimeLog({panel,app,run,host,download});management=mountMemoryManagement({panel,app,run,host});dictionaryView=mountDictionary({panel,app,run,save:async input=>{if(dirtyApi.has('aliases'))throw new Error('手动字典文本尚未保存，请先保存世界设置');await app.saveDictionaryEntry(input);$('[data-setting="aliases"]').value=readViewState(app).settings.aliases;}});customManagement=mountCustomModules({panel,app,run,host,download,onAssistant:async text=>{await app.setDraft(text);fill();setPage('assistant');}});fill();paint(readViewState(app));
 personEditor=mountPersonEditor({panel,app,run});
 knowledgeView=mountKnowledgeView({panel,app,run,host});
 floating=mountFloatingProduct({panel,documentRef,host,version:PRODUCT_VERSION,onOpen:()=>{painting.flush();void app.followCurrentChat?.().catch(e=>feedback(`聊天记忆读取未完成：${failureText(e)}`,'warning'));},onClose:()=>painting.request(),onStop:()=>run(()=>app.stop()),onLogs:()=>{setPage('recording');showRecordTab('logs');}});floating.setNotice(noticeText,noticeLevel);
 let destroyed=false;
 Promise.resolve(app.loadApiSettings?.()).then(()=>{if(!destroyed){fill({apiOnly:true});paint(readViewState(app));return app.startChatTracking?.();}}).catch(e=>{if(!destroyed)feedback(`读取全局配置失败：${failureText(e)}`,'error');});
 return {panel,application:app,controller:controller??app.core,setPage,floating,
   async destroy(){destroyed=true;painting.dispose();clearTimeout(timer);resetAllModels();floating.destroy();await app.dispose?.();}};
}
