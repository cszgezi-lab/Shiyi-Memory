import {esc,field} from '../src/product-settings-ui.js';
import {CATEGORY_LABELS,recordDescription} from '../src/product-memory.js';
import {AWARENESS_STATUSES,AWARENESS_VIA} from '../src/contracts.js';

export const qualityPanelHTML=()=>`<details class="sy-card" data-quality-panel><summary>内容校对 <small data-quality-count></small></summary><p class="sy-help">逐条查看原文、修改和确认不调用模型。AI 校对只处理待核对内容，先预览请求计划。</p><div class="sy-actions"><button type="button" data-action="review-memory">预览 AI 校对计划</button><button type="button" data-action="undo-quality">撤销自动校对</button><button type="button" data-action="stop">停止</button></div><div data-quality-plan></div><p data-quality-status role="status"></p><div data-quality-items></div><button type="button" data-quality-more hidden>显示更多问题</button></details>`;
const choices=(key,label,values,value)=>field(label,`<select data-q-field="${key}">${values.map(([id,text])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(text)}</option>`).join('')}</select>`);
const statusLabels={known:'知道',heard:'听说',suspected:'怀疑',mistaken:'误解',explicitly_unaware:'明确不知道'};
const viaLabels={witnessed:'亲眼见到',heard_in_scene:'当场听见',read:'阅读得知',told:'他人转告',background:'既有背景',user_confirmed:'用户确认',special_ability:'特殊能力',unknown:'无法确定'};
export function mountQualityView({panel,app,run}){
  const $=s=>panel.querySelector(s),container=$('[data-quality-items]');let limit=10,last=null,scope=null,planStamp='';
  function editorHTML(r){
    const bodyKey=r.category==='awarenessChanges'?'knowledge':r.category==='entityFactChanges'?'to':r.description!==undefined?'description':r.text!==undefined?'text':'content';
    const value=r[bodyKey]??recordDescription(r),json=typeof value!=='string';
    let html=field(r.category==='awarenessChanges'?'具体知道／不知道什么':'完整内容',`<textarea rows="5" data-q-field="${bodyKey}" ${json?'data-q-json':''}>${esc(json?JSON.stringify(value,null,2):value)}</textarea>`);
    if(r.category==='awarenessChanges')html+=field('获知人物',`<input data-q-field="person" value="${esc(r.person??r.actorId??'')}">`)+choices('status','知情状态',AWARENESS_STATUSES.map(id=>[id,statusLabels[id]]),r.status)+choices('via','获知渠道',AWARENESS_VIA.map(id=>[id,viaLabels[id]]),r.via)+field('获知时间',`<input data-q-field="learnedAt" value="${esc(typeof r.learnedAt==='string'?r.learnedAt:'')}">`);
    if(r.category==='commitmentChanges')html+=choices('state','约定状态',[['unknown','请选择'],['proposed','提出'],['attempted','尝试'],['accepted','接受'],['completed','完成'],['declined','拒绝'],['canceled','取消']],r.state);
    if(r.category==='events')html+=field('发生时间',`<input data-q-time value="${esc(typeof r.temporal?.occurredAt==='string'?r.temporal.occurredAt:typeof r.temporal==='string'?r.temporal:'')}">`);
    return `${html}<details><summary>其他字段（JSON，可选）</summary><p class="sy-help">可修改标签、地点、人物属性、关键台词或心迹；编号和来源不能修改。</p><textarea rows="4" data-q-extra>{}</textarea></details><button type="button" data-q-save>保存并确认</button><p class="sy-help">确认代表你已核对本条内容；之后 AI 不会覆盖你的修改。</p>`;
  }
  async function inspect(row,item){
    let slot=row.querySelector('[data-q-editor]');slot.hidden=false;slot.textContent='正在读取原文…';
    const data=await app.inspectQualityRecord(item.id);
    if(!slot.isConnected)return;
    slot.innerHTML=`<details open><summary>对应原文 · ${data.sources.length} 楼</summary>${data.sources.map(s=>`<details><summary>第 ${s.index} 楼</summary><div class="sy-quality-source">${esc(s.text)}</div></details>`).join('')}</details>${editorHTML(data.record)}`;
    slot.querySelector('[data-q-save]').addEventListener('click',()=>run(async()=>{
      const fields=JSON.parse(slot.querySelector('[data-q-extra]').value);if(!fields||Array.isArray(fields)||typeof fields!=='object')throw new Error('其他字段需要填写 JSON 对象');
      for(const input of slot.querySelectorAll('[data-q-field]')){
        const key=input.dataset.qField,value=input.hasAttribute('data-q-json')?JSON.parse(input.value):input.value;
        if(key==='learnedAt'&&!value.trim())continue;
        if(JSON.stringify(value)!==JSON.stringify(data.record[key]))fields[key]=value;
      }
      const time=slot.querySelector('[data-q-time]');if(time&&time.value.trim()&&(data.record.temporal?.occurredAt??data.record.temporal)!==time.value.trim())fields.temporal={...(typeof data.record.temporal==='object'?data.record.temporal:{}),occurredAt:time.value.trim()};
      await app.saveQualityRecord(item.id,{fields,expected:data.expected});slot.textContent='已保存人工校对';
    }));
  }
  function paint(s){
    last=s;const nextScope=JSON.stringify(s.core?.scope);if(nextScope!==scope){scope=nextScope;container.replaceChildren();limit=10;planStamp='';}
    const q=s.quality??{},items=q.items??[];
    $('[data-quality-count]').textContent=s.chatReady?`待核对 ${items.length} 条`:'';
    $('[data-quality-status]').textContent=s.qualityProgress||`${items.length} 条待核对；${q.failed??0} 组请求未完成。已保存的总结保留。`;
    const stamp=JSON.stringify(s.qualityPlan??null);
    if(stamp!==planStamp){planStamp=stamp;const p=s.qualityPlan;$('[data-quality-plan]').innerHTML=p?`<div class="sy-quality-plan"><p>预计 ${p.requests} 次模型请求 · ${p.records} 条记忆 · ${p.sources} 楼原文</p>${p.blocked?.map(b=>`<p class="sy-help">${esc(b.reason)}</p>`).join('')??''}${p.requests?'<button type="button" data-quality-start>开始 AI 校对</button>':'<p>没有可执行的模型请求。</p>'}</div>`:'';$('[data-quality-start]')?.addEventListener('click',()=>run(()=>app.reviewMemory({planId:p.id})));}
    const visible=items.slice(0,limit),ids=new Set(visible.map(i=>i.id));
    for(const child of [...container.children])if(!ids.has(child.dataset.qualityRecord))child.remove();
    for(const item of visible){
      let row=[...container.children].find(n=>n.dataset.qualityRecord===item.id);
      if(!row){row=container.ownerDocument.createElement('article');row.className='sy-quality-item';row.dataset.qualityRecord=item.id;row.innerHTML='<h4></h4><div data-q-reasons></div><button type="button" data-q-inspect>查看原文／人工校对</button><div data-q-editor hidden></div>';container.append(row);row.querySelector('[data-q-inspect]').addEventListener('click',()=>run(()=>inspect(row,item)));}
      const content=JSON.stringify(item);if(row.dataset.stamp!==content){row.dataset.stamp=content;row.querySelector('h4').textContent=`${CATEGORY_LABELS[item.category]??'记忆'} · ${item.title}`;row.querySelector('[data-q-reasons]').innerHTML=item.descriptions.map(t=>`<p class="sy-help">${esc(t)}</p>`).join('');}
    }
    $('[data-quality-more]').hidden=items.length<=limit;
    $('[data-quality-start]')?.toggleAttribute('disabled',Boolean(s.busy));
    $('[data-action="review-memory"]')?.toggleAttribute('disabled',Boolean(s.busy));
  }
  $('[data-quality-more]').addEventListener('click',()=>{limit+=10;if(last)paint(last);});
  return {paint};
}
