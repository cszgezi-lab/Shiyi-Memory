import {esc,field,setting} from '../src/product-settings-ui.js';
import {personaRefinementMarkdown} from '../src/persona-refinement-plan.js';

export function personaRefinementHTML(){return `<details class="sy-card" data-persona-refinement-settings><summary>手动人设精修（可选）</summary>
<p class="sy-help">选择一位人物和原文范围，逐批核对当前态、旧设定冲突与原话。正常自动人设不依赖精修；这里不会按周期额外调用。</p>
${field('人物档案','<select data-review-profile></select>')}
<div class="sy-grid">${field('从哪一楼','<input type="number" min="0" value="1" data-review-start>')}${field('到哪一楼','<input type="number" min="0" data-review-end>')}${field('每批多少楼','<input type="number" min="1" max="200" value="10" data-review-size>')}</div>
<div class="sy-actions"><button type="button" data-review-preview>预览精修</button><button type="button" data-review-start-run disabled>开始精修</button></div>
<p data-review-preview-text role="status">预览不调用模型；辅助精修 API 在设置中配置。</p>
<p data-persona-refinement-status role="status"></p>
<details data-review-batches><summary>精修批次管理 · Markdown</summary><div class="sy-actions"><button type="button" data-review-pause>暂停</button><button type="button" data-review-resume>继续未完成</button><button type="button" data-review-apply>应用候选</button><button type="button" data-review-discard>删除整组候选</button></div><div data-review-items></div><details><summary>查看 Markdown 记录</summary><pre class="sy-packet" data-review-markdown></pre></details></details>
<details><summary>精修请求预算</summary>${setting('personaReviewInputUnits')}${setting('personaReviewOutputTokens')}${setting('personaReviewDeadlineMs')}<button type="button" data-persona-refinement-save>保存精修预算</button></details></details>`;}

export function mountPersonaRefinement({panel,app,run,host=globalThis}){
  const $=s=>panel.querySelector(s);if(!$('[data-review-profile]'))return {paint(){}};
  let scope='',profilesStamp='',preview=null,dirty=false,itemsStamp='';
  const options=()=>({profileId:$('[data-review-profile]').value,startIndex:Number($('[data-review-start]').value),endIndex:Number($('[data-review-end]').value),batchSize:Number($('[data-review-size]').value)});
  const invalidate=()=>{preview=null;$('[data-review-start-run]').disabled=true;$('[data-review-preview-text]').textContent='请选择人物与范围，然后预览。';};
  const bind=(selector,fn)=>$(selector)?.addEventListener('click',e=>run(fn,{name:'dynamic-persona',button:e.currentTarget}));
  for(const name of ['profile','start','end','size'])$('[data-review-'+name+']').addEventListener('input',()=>{dirty=true;invalidate();});
  bind('[data-review-preview]',async()=>{
    if(['start','end','size'].some(k=>$('[data-review-'+k+']').value===''))throw new Error('请填写起止楼层与每批楼数');
    const selected=options(),result=await app.previewDynamicPersonaReview(selected);if(JSON.stringify(selected)!==JSON.stringify(options()))return;
    preview={...result,options:selected};$('[data-review-preview-text]').textContent=`${result.name} · #${result.startIndex}–${result.endIndex} · ${result.plannedRequests} 批，正常 ${result.plannedRequests} 次独立精修请求。正式档案先保留，候选完成后手动应用。${result.historicalOnly?`所选范围早于档案最新依据 #${result.through}：仅生成历史核对候选，不能覆盖当前态。`:''}`;$('[data-review-start-run]').disabled=false;
  });
  bind('[data-review-start-run]',async()=>{if(!preview||JSON.stringify(preview.options)!==JSON.stringify(options()))throw new Error('请先预览当前人物与范围');await app.startDynamicPersonaReview({...options(),previewHash:preview.previewHash});invalidate();$('[data-review-batches]').open=true;});
  bind('[data-review-pause]',()=>app.manageDynamicPersonaReview('pause'));
  bind('[data-review-resume]',()=>app.manageDynamicPersonaReview('resume'));
  bind('[data-review-apply]',async()=>{if(await host.confirm?.('应用已保存的精修候选？正式档案会保存旧版；已删除批次不参与。历史整理建议仍需在人物页确认。'))await app.applyDynamicPersonaReview();});
  bind('[data-review-discard]',async()=>{const applied=app.state.dynamicPersona?.refinement?.manualPlan?.status==='applied';if(await host.confirm?.(applied?'撤回这组已应用精修，恢复精修前档案？后续已有新版本时会拒绝覆盖。':'删除整组精修候选？保留归档，正式档案和主总结不变。'))await app.manageDynamicPersonaReview('discard');});
  bind('[data-persona-refinement-save]',async()=>{const patch={};for(const key of ['personaReviewInputUnits','personaReviewOutputTokens','personaReviewDeadlineMs'])patch[key]=Number($('[data-setting="'+key+'"]').value);await app.saveSettings(patch);invalidate();});
  $('[data-review-items]').addEventListener('click',e=>{const button=e.target.closest?.('[data-review-action]');if(!button)return;run(async()=>{const action=button.dataset.reviewAction;if(action==='delete'&&!await host.confirm?.('删除这一批精修候选？其他候选保留，正式档案不变。'))return;await app.manageDynamicPersonaReview(action,button.dataset.reviewId);},{name:'dynamic-persona',button});});
  return {paint(s){
    const d=s.dynamicPersona??{},nextScope=JSON.stringify(s.core?.scope);
    if(scope!==nextScope){scope=nextScope;profilesStamp=itemsStamp='';dirty=false;invalidate();$('[data-review-start]').value=1;$('[data-review-size]').value=10;}
    const profiles=(d.profiles??[]).filter(p=>!p.deleted),next=JSON.stringify(profiles.map(p=>[p.id,p.name,p.locked]));
    if(next!==profilesStamp){const selected=$('[data-review-profile]').value;profilesStamp=next;$('[data-review-profile]').innerHTML='<option value="">请选择人物</option>'+profiles.map(p=>`<option value="${esc(p.id)}" ${p.locked?'disabled':''}>${esc(p.name)}${p.locked?'（已锁定）':''}</option>`).join('');$('[data-review-profile]').value=profiles.some(p=>p.id===selected)?selected:'';invalidate();}
    if(!dirty&&d.lastIndex!==null&&d.lastIndex!==undefined)$('[data-review-end]').value=d.lastIndex;
    const state=d.refinement??{},plan=state.manualPlan,active=plan&&!['applied','discarded','withdrawn'].includes(plan.status);
    $('[data-review-pause]').disabled=plan?.status!=='running';$('[data-review-resume]').disabled=!active||plan.status==='ready';$('[data-review-apply]').disabled=plan?.status!=='ready'||plan.historicalOnly;$('[data-review-discard]').disabled=!active&&plan?.status!=='applied';$('[data-review-discard]').textContent=plan?.status==='applied'?'撤回已应用精修':'删除整组候选';
    const snapshot=JSON.stringify([plan?.id,plan?.status,state.revision,plan?.items.map(i=>[i.id,i.status]),state.queue?.map(t=>[t.id,t.status,t.attempts])]);if(snapshot===itemsStamp)return;itemsStamp=snapshot;
    $('[data-review-markdown]').textContent=personaRefinementMarkdown(state);
    const labels={pending:'等待处理',failed:'失败',saved:'候选已保存',deleted:'已删除'};
    $('[data-review-items]').innerHTML=(plan?.items??[]).map(item=>{const q=state.queue?.find(t=>t.id===item.id),status=q?.status??item.status;return `<div class="sy-card"><p>#${item.startIndex}–${item.endIndex} · ${esc(labels[status]??status)}</p><div class="sy-actions">${q?.status==='failed'&&active?`<button type="button" data-review-action="retry" data-review-id="${esc(item.id)}">重试本批</button>`:''}${active&&item.status!=='deleted'?`<button type="button" data-review-action="delete" data-review-id="${esc(item.id)}">删除候选</button>`:''}</div></div>`;}).join('')||'<p>还没有手动精修批次。</p>';
  }};
}
