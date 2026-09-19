import {esc,field,setting} from '../src/product-settings-ui.js';
import {DYNAMIC_PERSONA_PROMPT,currentPersonaProfiles} from '../src/dynamic-persona.js';
import {PERSONA_SOURCE_LABELS,PERSONA_SOURCE_REASONS} from '../src/persona-source-index.js';
import {PERSONA_STEPS,DIAGNOSTIC_REASONS} from '../src/diagnostics.js';
export function personaSourceDetails(p,guide,sources){
  const bindings=[...new Map((p.bindings??[]).map(b=>[JSON.stringify([b.book,b.uid]),{book:b.book,title:b.originalName??b.name}])).values()];
  // The panel must explain itself. A bare "0 个条目" left the user unable to tell
  // "the card binds no world book" from "the entry names nobody".
  const reason=sources?.length?null:PERSONA_SOURCE_REASONS[guide?.reason]??PERSONA_SOURCE_REASONS.no_named_entry;
  const hint=sources?.length?'':`<p>${esc(reason)}</p>${guide?.candidates?.length?`<p>已读取到的条目（前 ${guide.candidates.length} 个，未确认归属）：${guide.candidates.map(c=>esc(c)).join('；')}</p>`:''}`;
  const kept=p.composition?.parts?.length||p.composition?.sourceBaseline?.length||0;
  const rewritten=p.composition?.changes?.length??0;
  const summary=p.composition?`<p>保留 ${kept} 个${sources?.length?'原书原文':'聊天档案'}片段；本次改写原设定 ${rewritten} 处。未修改部分沿用${sources?.length?'原文':'已保存底稿'}，不靠模型重写。</p>${rewritten?p.composition.changes.map(c=>`<details><summary>${esc(c.title)} · 第${esc(c.sourceFloors.join('、'))}楼依据</summary><p>修改前</p><div class="sy-packet">${esc(c.before)}</div><p>修改后</p><div class="sy-packet">${esc(c.after)}</div></details>`).join(''):`<p>本次没有改写任何原设定句子；如果剧情已经和原设定冲突，说明模型只追加了新的剧情变化，没有去改动冲突的原句。</p>`}${p.composition.rejectedExamples?`<p>${p.composition.rejectedExamples} 条语料未确认原话或说话人，未纳入示例；其他档案内容保留。</p>`:''}${p.composition.rejectedDevelopment?`<p>${p.composition.rejectedDevelopment} 项成长补充缺少对应正文依据，未纳入成长脉络；原档案及已保存内容保留，不会自动另开校对任务。</p>`:''}`:'<p>此为旧版或手工档案；不会在升级时重写。下次明确更新时建立原文保留版本。</p>';
  return `<details data-persona-sources><summary>原书来源与本次修改 · ${bindings.length} 个条目</summary>${bindings.length?bindings.map(s=>`<p>${esc(s.book)} · ${esc(s.title)}</p>`).join(''):''}${hint}${summary}</details>`;
}
export function dynamicPersonaProgressText(d){
  if(!d.plan)return '独立进度尚未读取';
  const p=d.plan;
  return `${p.coveredThrough>=p.startFloor?`连续已处理 #${p.startFloor}–${p.coveredThrough}`:'起点后尚未处理'} · 下一批 #${p.nextStart}–${p.nextEnd} · 最新 #${d.lastIndex??'未读取'} · 保留 ${p.keepRecent} 楼。${p.pendingBatches===null?'点击检查进度读取待处理数量。':`当前 ${p.pendingBatches} 个完整待处理批次，正常每批 1 次人设请求。`}旧聊天不继承主总结进度；从 1 开始会分批补读原文。修改起算楼层会跳过更早原文，不代表已建立那些楼层的人设。`;
}
export function dynamicPersonaHTML(){return `<section data-view="dynamic-persona" hidden>
<div class="sy-top"><h3>动态人设</h3><button type="button" data-jump="people">人物工作区</button></div>
<p data-persona-status role="status"></p>
<details data-persona-failure hidden><summary>本次失败详情（不依赖日志导出）</summary><p data-persona-failure-text class="sy-help"></p></details>
<details class="sy-card" data-persona-controls open><summary>更新人物 <small>自动更新 / 手动补建</small></summary>
<p class="sy-help">独立读取原文，不等主总结。自动按周期更新；旧聊天可以手动选范围补建。主聊天只使用已完成的档案，锁屏后可能暂停。</p>
<p class="sy-help">正文新角色也能建档；同一人物持续更新，保留有来源的转变缘由、对象与表达语料，不强行给路人编造成长。成长脉络在整份档案中查看和修改，与人物更新共用一次请求。</p>
<div class="sy-actions"><button type="button" data-persona-tab="auto" aria-pressed="true">自动更新</button><button type="button" data-persona-tab="manual" aria-pressed="false">手动补建</button></div>
<div class="sy-card" data-persona-auto>
    <div class="sy-actions"><button type="button" data-persona-enable>启用 / 继续自动</button><button type="button" data-persona-pause>暂停自动</button><button type="button" data-jump="recording">总结页设置人设周期</button></div>
<div class="sy-grid">${setting('dynamicPersonaEvery')}${setting('dynamicPersonaKeepRecent')}</div>
${field('当前聊天自动起算楼层','<input data-persona-start type="number" min="0" value="1">')}
<p class="sy-help" data-persona-progress></p>
<div class="sy-actions"><button type="button" data-persona-save>保存自动周期</button><button type="button" data-persona-check>检查进度</button><button type="button" data-persona-retry>处理 / 重试下一批</button></div>
</div>
<div class="sy-card" data-persona-manual hidden>
<h4>旧聊天 · 手动补建</h4><p class="sy-help">楼号与聊天一致。只处理选中原文，不复用主总结的进度；手动批大小与自动周期独立。每批正常 1 次人设请求，预览不调用模型。</p>
<div class="sy-grid">${field('从哪一楼','<input type="number" min="0" value="1" data-persona-manual-start>')}${field('到哪一楼','<input type="number" min="0" data-persona-manual-end>')}${field('每批多少楼','<input type="number" min="1" max="200" value="20" data-persona-manual-size>')}</div>
<label><input type="checkbox" checked data-persona-manual-handoff> 补完后自动起点接到下一楼（仍需手动启用自动）</label>
<p class="sy-help">例如 #601–700，每批 20 楼，共 5 批。未选的早期原文不会被补读。大批量受“人设设置”中的输入预算约束，超预算会提示，不会暗中拆小批。全部补完才应用新档案，中途暂停不会把当前人设退回过去。</p>
<div class="sy-actions"><button type="button" data-persona-manual-preview>预览补建计划</button><button type="button" data-persona-manual-start-run disabled>开始后台补建</button></div>
<p class="sy-help" role="status" data-persona-manual-preview-text>请先选择范围并预览。</p>
<p role="status" data-persona-manual-status></p>
<div class="sy-actions"><button type="button" data-persona-manual-pause>暂停补建</button><button type="button" data-persona-manual-continue>继续未完成</button><button type="button" data-persona-manual-discard>放弃本次补建</button></div>
<div data-persona-manual-items></div><div class="sy-actions"><button type="button" data-persona-manual-prev>上一页</button><span data-persona-manual-page></span><button type="button" data-persona-manual-next>下一页</button></div>
</div>
</details>
<details class="sy-card" data-persona-settings><summary>人设设置 <small>API · 预设 · 来源识别</small></summary>
<p class="sy-help">更新使用本批正文、已保存的相关心迹与关键台词，以及原书和上一版档案。私人心迹只指导其本人；旧台词保留语境，不覆盖当前关系。设置在自动与手动之间共用，修改后记得保存。</p>
<div class="sy-actions"><button type="button" data-api-jump="dynamicPersona">人设 API</button><button type="button" data-jump="extraction">正文提取规则</button></div>
<p class="sy-help">推荐剧情主导：人物随互动成长，MVU 数值只作参考；无 MVU 同样可用，不改变量或脚本。简繁姓名与可确认的简称共同识别，有歧义可在人物编辑或召回字典里校正。</p>
<details class="sy-card"><summary>共用预设与请求预算 · 可 DIY</summary><p class="sy-help">周期设置（每批多少楼、保留最近多少楼）的输入已放在上方「更新人物 → 自动更新」。本节只放提示词、人物演绎主次与预算。</p>${setting('dynamicPersonaMvuMode')}${setting('dynamicPersonaInputUnits')}${setting('dynamicPersonaOutputTokens')}${setting('dynamicPersonaDeadlineMs')}${field('发给人设模型的指导词',`<textarea rows="12" data-persona-prompt>${esc(DYNAMIC_PERSONA_PROMPT)}</textarea>`)}<div class="sy-actions"><button type="button" data-persona-budget-save>保存预设与预算</button><button type="button" data-persona-default>恢复内置预设</button></div></details>
<div class="sy-actions"><button type="button" data-persona-disable>关闭动态人设</button><button type="button" data-persona-worldbook-check>检查世界书读取</button><button type="button" data-persona-mirror-retry>同步世界书镜像</button></div>
<p class="sy-help" data-persona-worldbook-read></p><p class="sy-help" data-persona-worldbook></p>
<details class="sy-card" data-persona-source-audit><summary>原书条目识别结果（不是已替换清单）</summary><div data-persona-source-audit-list></div></details>
<p class="sy-help">同一人物持续更新整份档案，属性可自由增删，历史版本保留；锁定后 AI 不覆盖。原世界书不永久停用：本轮请求中用动态档案替换可识别的人设文字，不重复注入原人设；EJS 条件与 MVU 变量不改，复杂脚本保留。检查读取、同步镜像不调用模型。</p>
</details>
<details class="sy-card"><summary>本轮动态人设注入</summary><p data-persona-injected-info></p><div class="sy-packet" data-persona-injected-text></div></details>
<div class="sy-actions"><button type="button" data-persona-profile-prev>上一组人物</button><button type="button" data-persona-profile-next>下一组人物</button><span data-persona-profile-page></span></div><div data-persona-profiles></div>
<details class="sy-card"><summary>新增 DIY 人物档案</summary>${field('姓名','<input data-persona-new-name>')}${field('完整人物信息','<textarea rows="6" data-persona-new-text></textarea>')}<button type="button" data-persona-add>新增并锁定</button></details>
<details class="sy-card" data-persona-batches-section><summary>批次管理 <small>动态人设独立批次</small></summary><p class="sy-help">按楼层倒序排列；记录每一批人设请求的开始/结束楼层、状态、已生成的档案数和隔离数。不在「总结批次」里管理，本表也不调用模型。</p><div data-persona-batches-list></div></details></section>`;}
export function mountDynamicPersona({panel,app,run,host=globalThis}){
  const $=s=>panel.querySelector?.(s),root=$('[data-view="dynamic-persona"]'),drafts=new Map();let stamp='',scope='',profilePage=0,startDirty=false,promptDirty=false,manualDirty=false,manualPage=0,manualStamp='',previewStamp='',auditStamp='';
  if(!root)return {paint(){},focus(){},select(){},tab(){},dispose(){}};
  $('[data-persona-source-audit]')?.addEventListener('toggle',()=>paint(app.state));
  const bind=(s,fn)=>$(s)?.addEventListener('click',e=>run(fn,{name:'dynamic-persona',button:e.currentTarget}));
  $('[data-persona-start]')?.addEventListener('input',()=>{startDirty=true;});$('[data-persona-prompt]')?.addEventListener('input',()=>{promptDirty=true;});
  // 周期设置（每批楼数/保留楼数）输入同时存在人设页「自动更新」和总结页底部；
  // 此处保存时一并写回 settings 与起算楼层，确保两处的展示同步。
  const save=async()=>{const patch={dynamicPersonaEvery:Number($('[data-setting="dynamicPersonaEvery"]')?.value),dynamicPersonaKeepRecent:Number($('[data-setting="dynamicPersonaKeepRecent"]')?.value)};await app.saveSettings(patch);await app.setDynamicPersonaStart(Number($('[data-persona-start]').value));startDirty=false;};
  bind('[data-persona-save]',save);bind('[data-persona-enable]',async()=>{await save();await app.setDynamicPersona(true);});bind('[data-persona-pause]',()=>app.pauseDynamicPersona());bind('[data-persona-disable]',()=>app.setDynamicPersona(false));bind('[data-persona-check]',()=>app.inspectDynamicPersona());bind('[data-persona-retry]',()=>app.processDynamicPersona());
  bind('[data-persona-default]',()=>{$('[data-persona-prompt]').value=DYNAMIC_PERSONA_PROMPT;promptDirty=true;});
  bind('[data-persona-budget-save]',async()=>{const patch={dynamicPersonaPrompt:$('[data-persona-prompt]').value,dynamicPersonaMvuMode:$('[data-setting="dynamicPersonaMvuMode"]').value};for(const key of ['dynamicPersonaInputUnits','dynamicPersonaOutputTokens','dynamicPersonaDeadlineMs'])patch[key]=Number($('[data-setting="'+key+'"]').value);await app.saveSettings(patch);promptDirty=false;});
  const manualOptions=()=>({startIndex:Number($('[data-persona-manual-start]').value),endIndex:Number($('[data-persona-manual-end]').value),batchSize:Number($('[data-persona-manual-size]').value),handoff:$('[data-persona-manual-handoff]').checked});
  const clearPreview=()=>{previewStamp='';$('[data-persona-manual-start-run]').disabled=true;$('[data-persona-manual-preview-text]').textContent='范围已改变，请重新预览。';};
  for(const sel of ['start','end','size','handoff'])$('[data-persona-manual-'+sel+']')?.addEventListener('input',()=>{manualDirty=true;clearPreview();});
  for(const tab of root.querySelectorAll('[data-persona-tab]'))tab.addEventListener('click',()=>{
    const manual=tab.dataset.personaTab==='manual';$('[data-persona-auto]').hidden=manual;$('[data-persona-manual]').hidden=!manual;
    for(const button of root.querySelectorAll('[data-persona-tab]'))button.setAttribute('aria-pressed',String(button===tab));
    if(manual)run(()=>app.inspectDynamicPersona(),{name:'dynamic-persona'});
  });
  bind('[data-persona-manual-preview]',async()=>{const options=manualOptions();if(['start','end','size'].some(k=>$('[data-persona-manual-'+k+']').value===''))throw Error('请填写起止楼层与每批楼数');
    const preview=await app.previewDynamicPersonaManual(options);if(JSON.stringify(manualOptions())!==JSON.stringify(options))return;
    previewStamp=JSON.stringify(options);$('[data-persona-manual-preview-text]').textContent=`#${preview.startIndex}–${preview.endIndex} · 每批 ${preview.batchSize} 楼 · 共 ${preview.plannedRequests} 批，正常 ${preview.plannedRequests} 次人设请求。${preview.replaces?'完成后替换 '+preview.replaces+' 个旧人设批次。':''}失败只重试未完成部分；主总结保留。`;$('[data-persona-manual-start-run]').disabled=false;
  });
  bind('[data-persona-manual-start-run]',async()=>{if(!previewStamp||previewStamp!==JSON.stringify(manualOptions()))throw Error('请先预览当前范围');const result=await app.startDynamicPersonaManual(manualOptions());clearPreview();$('[data-persona-manual-preview-text]').textContent='计划已保存，后台进度见下方；无需重复新建。';return result;});
  bind('[data-persona-manual-pause]',()=>app.pauseDynamicPersonaManual());bind('[data-persona-manual-continue]',()=>app.continueDynamicPersonaManual());
  bind('[data-persona-manual-discard]',async()=>{if(await host.confirm?.('放弃本次补建候选？原人物档案、主总结保留；候选会归档。'))await app.discardDynamicPersonaManual();});
  bind('[data-persona-manual-prev]',()=>{manualPage=Math.max(0,manualPage-1);manualStamp='';paint(app.state);});
  bind('[data-persona-manual-next]',()=>{manualPage++;manualStamp='';paint(app.state);});
  bind('[data-persona-worldbook-check]',()=>app.inspectDynamicPersonaWorldbook());bind('[data-persona-mirror-retry]',()=>app.syncDynamicPersonaWorldbook());
  bind('[data-persona-add]',async()=>{await app.addDynamicPersona($('[data-persona-new-name]').value,$('[data-persona-new-text]').value);$('[data-persona-new-text]').value='';});
  bind('[data-persona-profile-prev]',()=>{profilePage=Math.max(0,profilePage-1);stamp='';paint(app.state);});bind('[data-persona-profile-next]',()=>{profilePage++;stamp='';paint(app.state);});
  function paint(s){
    const d=s.dynamicPersona??{profiles:[],batches:[]},nextScope=JSON.stringify(s.core?.scope);
    if(scope!==nextScope){scope=nextScope;stamp=manualStamp=previewStamp='';startDirty=promptDirty=manualDirty=false;profilePage=manualPage=0;drafts.clear();$('[data-persona-profiles]').replaceChildren();$('[data-persona-manual-start]').value=1;$('[data-persona-manual-end]').value='';$('[data-persona-manual-size]').value=20;$('[data-persona-manual-handoff]').checked=true;clearPreview();}
    $('[data-persona-status]').textContent=`${s.settings.dynamicPersonaEnabled?'已启用':'未启用'} · ${d.message??'打开聊天后读取档案'}`;
    $('[data-persona-failure]').hidden=!d.failureDetails;
    if(d.failureDetails){const f=d.failureDetails;$('[data-persona-failure-text]').textContent=[PERSONA_STEPS[f.personaStep],f.code,DIAGNOSTIC_REASONS[f.reason],f.errorType,f.modelRequested===false?'本次尚未请求模型':f.modelRequested?'本次已请求模型':null,...(f.stackFrames??[]),d.failureStorage?'失败进度另未保存；原始错误仍保留':null].filter(Boolean).join(' · ');}
    if(!startDirty)$('[data-persona-start]').value=d.startFloor??1;if(!promptDirty)$('[data-persona-prompt]').value=s.settings.dynamicPersonaPrompt||DYNAMIC_PERSONA_PROMPT;
    $('[data-persona-progress]').textContent=dynamicPersonaProgressText(d);
    if(!manualDirty&&d.lastIndex!==null&&d.lastIndex!==undefined)$('[data-persona-manual-end]').value=d.lastIndex;
    const manual=d.manualPlan,items=manual?.items??[],saved=items.filter(b=>b.status==='saved').length,unfinished=['paused','running','failed'].includes(manual?.status);
    $('[data-persona-manual-status]').textContent=manual?`#${manual.startIndex}–${manual.endIndex} · ${{paused:'已暂停',running:'正在后台补建',failed:'本批未完成，可继续',completed:'已完成并应用',discarded:'已放弃，原档案保留'}[manual.status]??manual.status} · ${saved}/${items.length} 批。${unfinished?'候选进度已保存；全部完成前继续使用原人物档案。':''}${manual.message??''}`:'还没有手动人设计划。';
    $('[data-persona-manual-continue]').disabled=!unfinished||Boolean(d.busy)||(manual?.status==='running'&&!manual.items.some(b=>b.status==='failed'));
    $('[data-persona-manual-pause]').disabled=manual?.status!=='running';
    $('[data-persona-manual-discard]').disabled=!unfinished||Boolean(d.busy);
    const manualPages=Math.max(1,Math.ceil(items.length/10));manualPage=Math.min(manualPage,manualPages-1);
    $('[data-persona-manual-page]').textContent=items.length?`${manualPage+1}/${manualPages} 页`:'';
    $('[data-persona-manual-prev]').disabled=manualPage===0;$('[data-persona-manual-next]').disabled=manualPage>=manualPages-1;
    const nextManualStamp=JSON.stringify([manual?.id,manual?.status,items.slice(manualPage*10,manualPage*10+10),manualPage]);
    if(manualStamp!==nextManualStamp){manualStamp=nextManualStamp;$('[data-persona-manual-items]').innerHTML=items.slice(manualPage*10,manualPage*10+10).map(b=>`<p>#${b.startIndex}–${b.endIndex} · ${b.status==='saved'?(manual.status==='completed'?'已应用':'候选已保存'):b.status==='failed'?'未完成：'+esc(b.message??'可继续重试'):'等待处理'}</p>`).join('');}
    const wb=d.worldbook;$('[data-persona-worldbook-read]').textContent=wb?wb.status==='unavailable'?'当前宿主未提供世界书读取接口；可以保存补充档案，但不能替换原条目。':`已读取 ${wb.books.length} 本世界书、${wb.entries} 个条目，${wb.safeFragments} 个可安全读取的文字片段（不等于全是人物条目）。来源：${wb.books.join('、')||'当前角色未绑定世界书'}`:'可以检查当前角色卡和聊天绑定的世界书。';
    const audit=JSON.stringify(wb?.audit??[]);if($('[data-persona-source-audit]').open&&audit!==auditStamp){auditStamp=audit;$('[data-persona-source-audit-list]').innerHTML=(wb?.audit??[]).map(e=>`<p>${esc(e.book)} · ${esc(e.title)}：${esc(PERSONA_SOURCE_LABELS[e.status]??'未确认')}${e.owner?' · '+esc(e.owner):''}</p>`).join('')||'<p>请点击“检查世界书读取”。</p>';}
    $('[data-persona-worldbook]').textContent=d.mirror?.status==='saved'?`世界书镜像：${d.mirror.name}（存档查看用，不重复绑定注入）。${(d.profiles??[]).some(p=>!p.deleted)?'人物是否生成成功以已应用档案为准。':'目前没有已应用的人物档案；空镜像不代表补建完成。'}`:d.mirror?.status==='failed'?'档案已保存，世界书镜像未同步；可单独重试同步，无需重新补建。':'世界书镜像尚未生成；需要宿主提供酒馆助手世界书接口。';
    $('[data-persona-injected-info]').textContent=d.lastInjection?`替换 ${d.lastInjection.replaced} 份当前人设，补充 ${d.lastInjection.supplemental} 份；只是加入待发请求，不代表模型一定采纳。`:'还没有本轮注入记录。';
    $('[data-persona-injected-text]').textContent=d.lastInjection?.text??'';
    const visible=currentPersonaProfiles((d.profiles??[]).filter(p=>!p.deleted),s.settings.dynamicPersonaMvuMode),pages=Math.max(1,Math.ceil(visible.length/6));profilePage=Math.min(profilePage,pages-1);$('[data-persona-profile-page]').textContent=`${profilePage+1}/${pages} · ${visible.length} 份档案`;
    const nextStamp=JSON.stringify([d.profiles,d.batches,profilePage,s.settings.dynamicPersonaMvuMode]);if(stamp===nextStamp)return;stamp=nextStamp;
    const list=$('[data-persona-profiles]');for(const e of list.querySelectorAll('[data-persona-id]')){if(e.querySelector('[data-persona-editor][open]'))drafts.set(e.dataset.personaId,e);else drafts.delete(e.dataset.personaId);}for(const id of drafts.keys())if(!visible.some(p=>p.id===id))drafts.delete(id);const editing=drafts;
    const cards=[];
    for(const p of visible.slice(profilePage*6,profilePage*6+6)){if(p.deleted)continue;if(editing.has(p.id)){cards.push(editing.get(p.id));continue;}
      const card=panel.ownerDocument.createElement('article');card.className='sy-card';card.dataset.personaId=p.id;
      const targets=visible.filter(other=>other.id!==p.id).sort((a,b)=>b.name.length-a.name.length||a.name.localeCompare(b.name,'zh-CN'));
      const suggested=targets[0]?.id??'';
      const mergeEditor=targets.length?`<details data-persona-merge><summary>合并到其他人物档案</summary><p class="sy-help">适合“濑名紫阳花／紫阳花”这种重复档案。选择要保留正式姓名的目标；本档案的内容、来源、台词和别称会并入目标，当前档案进入可恢复的合并记录，不调用模型。</p><select data-persona-merge-target aria-label="合并目标">${targets.map(other=>`<option value="${esc(other.id)}" ${other.id===suggested?'selected':''}>保留“${esc(other.name)}”${other.bindings?.length?' · 已关联原书':''}</option>`).join('')}</select><button type="button" data-persona-merge-commit>确认合并</button></details>`:'';
      card.innerHTML=`<h4>${esc(p.name)}</h4><p class="sy-help">${p.locked?'已锁定 · ':''}依据至 #${p.through} · ${p.bindings?.length?'已关联原书，实际替换见本轮注入':'尚未接管原书 · 仅补充'}</p><div class="sy-packet">${esc(p.text)}</div><details data-persona-editor><summary>修改整份人物档案</summary><textarea rows="12" data-persona-edit>${esc(p.text)}</textarea><label>别称与简称（逗号分隔）<input data-persona-aliases value="${esc((p.aliases??[]).join('，'))}"></label><p class="sy-help">简繁自动识别；同一别称对应多人时不自动选人。召回字典中的手工校正优先。</p><label><input type="checkbox" data-persona-lock ${p.locked?'checked':''}>锁定，不让 AI 覆盖</label><button type="button" data-persona-commit>保存人物</button></details>${mergeEditor}${personaSourceDetails(p,d.worldbook?.guide,[...new Map((p.bindings??[]).map(b=>[JSON.stringify([b.book,b.uid]),b])).values()])}<div class="sy-actions"><button type="button" data-persona-undo>恢复上一版并锁定</button><button type="button" data-persona-delete>删除档案</button></div>`;
      const action=(sel,fn)=>card.querySelector(sel).addEventListener('click',()=>run(fn,{name:'dynamic-persona'}));
      action('[data-persona-commit]',async()=>{await app.editDynamicPersona(p.id,{text:card.querySelector('[data-persona-edit]').value,aliases:card.querySelector('[data-persona-aliases]').value,locked:card.querySelector('[data-persona-lock]').checked});card.querySelector('details').open=false;stamp='';paint(app.state);});
      action('[data-persona-delete]',()=>app.editDynamicPersona(p.id,{deleted:true,locked:true}));action('[data-persona-undo]',()=>app.undoDynamicPersona(p.id));
      if(targets.length)action('[data-persona-merge-commit]',async()=>{const targetId=card.querySelector('[data-persona-merge-target]').value;const target=targets.find(row=>row.id===targetId);if(!target)throw new Error('请选择合并目标');if(await host.confirm?.(`将“${p.name}”并入“${target.name}”？原档案会保留在可恢复版本中。`)!==true)return;await app.mergeDynamicPersona(p.id,targetId);stamp='';paint(app.state);});
      cards.push(card);
    }
    list.replaceChildren(...cards);
    const batches=[...(d.batches??[])].sort((a,b)=>b.startIndex-a.startIndex);
    $('[data-persona-batches-list]').innerHTML=batches.map(b=>`<details class="sy-card" ${b.status==='failed'?'open':''}><summary>#${b.startIndex}–${b.endIndex} · ${b.status==='saved'?`已保存 · ${b.profileCount} 份更新${b.rejectedProfiles?.length?` · 隔离 ${b.rejectedProfiles.length} 份未确认档案`:''}`:b.status==='failed'?`未完成：${esc(b.message??'可重试')}`:b.status}</summary><p class="sy-help">${b.savedAt||b.createdAt?`时间：${new Date(b.savedAt??b.createdAt).toLocaleString()}`:''}${Number.isInteger(b.requestCount)?` · 调用 ${b.requestCount} 次模型`:''}${b.sourceHash?` · 源 hash 已校验`:''}</p>${b.through?`<p class="sy-help">档案推进至 #${b.through}</p>`:''}</details>`).join('')||'<p class="sy-help">还没有人设更新记录。</p>';
  }
  return {paint,focus(idOrName){
    const s=app.state,visible=currentPersonaProfiles((s.dynamicPersona?.profiles??[]).filter(p=>!p.deleted),s.settings.dynamicPersonaMvuMode);
    const index=visible.findIndex(p=>p.id===idOrName||p.name===idOrName);if(index<0)return;
    profilePage=Math.floor(index/6);stamp='';paint(s);
    const card=[...panel.querySelectorAll('[data-persona-id]')].find(e=>e.dataset.personaId===visible[index].id);card?.scrollIntoView?.({block:'start'});
  }};
}
