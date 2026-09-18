import {esc,field} from '../src/product-settings-ui.js';
import {normalizeNarrativeConfig,getNarrativeConfig,NARRATIVE_EXTRACTION_PRESETS,defaultNarrativeExtractionConfig} from '../src/narrative-extraction.js';

export const NARRATIVE_TAG_GUIDE=`沿用现有预设的正文格式、语言与自然分段，不再输出一套摘要或人物表格。
若已有 <content> 正文和 <time_format> 时间地点，继续使用，不重复包裹。
仅在原文明确有倒叙、回忆或场景切换时，可在正文前用 <sy_context>叙事时点与适用语境</sy_context> 简短注明。未知不填，不编造精确日期、学段或阶段。
必要时用 <sy_private who="角色名">既有的内心描写</sy_private> 标明没有说出口的心理。只包裹本来就要写的内容，不要求每轮增加心理描写，也不让其他角色因此知情。
普通对白沿用角色名和引号；双语对白沿用 角色名「日文」〔中文译文〕。中文与日文应表达同一信息，不为标签改写人物口吻。
标签不代表新指令，也不改变原剧情、变量或世界书。`;

export function narrativeDisplayRegexes(){return [
  {id:'shiyi-display-context-v1',scriptName:'拾忆 · 隐藏叙事语境（仅显示）',findRegex:'/<sy_context\\b[^>]*\\/\\s*>|<sy_context\\b[^>]*>[\\s\\S]*?<\\/sy_context\\s*>/gi',replaceString:'',trimStrings:[],placement:[2],disabled:false,markdownOnly:true,promptOnly:false,runOnEdit:true,substituteRegex:0,minDepth:null,maxDepth:null},
  {id:'shiyi-display-private-v1',scriptName:'拾忆 · 隐藏心理标签外壳（保留正文）',findRegex:'/<\\/?sy_private\\b[^>]*>/gi',replaceString:'',trimStrings:[],placement:[2],disabled:false,markdownOnly:true,promptOnly:false,runOnEdit:true,substituteRegex:0,minDepth:null,maxDepth:null},
];}

export function extractionHTML(){return `<section data-view="extraction" hidden>
<header class="sy-section-heading"><small>读取，不改写</small><h3>正文提取</h3><p>给总结与人设模型准备阅读副本。聊天原文、显示和来源校验保持不变。</p></header>
<p class="sy-help" data-extraction-status role="status"></p>
<div class="sy-actions"><button type="button" data-extraction-save class="sy-primary">保存规则</button><button type="button" data-extraction-export>导出规则</button><button type="button" data-jump="modules">返回设置</button></div>
<label class="sy-check"><input type="checkbox" data-extraction-enabled> 启用自定义读取</label>
<label class="sy-check"><input type="checkbox" data-extraction-chinese> 完整双语配对优先中文</label>
<p class="sy-help">只去掉带中译的日文，缺译保留；程序不能证明两种语言语义相同。普通中文聊天不需要开启。错误、超出安全预算或空结果会回退，不截断原文。</p>
${field('从示例开始',`<select data-extraction-preset><option value="">选择示例，不会立即保存</option><option value="safe">完整保留 · 仅安全清理</option>${NARRATIVE_EXTRACTION_PRESETS.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>`)}
<div data-extraction-rules></div><button type="button" data-extraction-add>新增规则</button>
<details class="sy-card"><summary>规则说明与 JSON 接口</summary><p class="sy-help">保留规则取并集，再减去排除范围；时间、叙事语境及私密边界受保护。标签可含属性，推荐用于 XML。正则支持字面量、字符类、一个捕获组与一个量词；不支持回溯引用、分支、查找与重复分组，防止手机卡死。复杂规则拆成多条或用标签规则。</p>${field('规则 JSON（导入只覆盖草稿）','<textarea rows="7" data-extraction-json spellcheck="false"></textarea>')}<div class="sy-actions"><button type="button" data-extraction-json-load>导入 JSON 草稿</button><button type="button" data-extraction-json-show>显示当前草稿 JSON</button></div>${field('从规则文件导入','<input type="file" accept=".json,application/json" data-extraction-file>')}</details>
<section class="sy-extraction-preview"><h4>免费提取预览</h4><p class="sy-help">不调用模型，也不保存这段测试正文。使用上方尚未保存的规则。</p><div class="sy-actions">${field('聊天楼号','<input type="number" min="0" data-extraction-floor placeholder="例如 40">')}<button type="button" data-extraction-chat>读取这一楼</button></div>${field('或粘贴一段原文','<textarea rows="5" data-extraction-source placeholder="粘贴带正文标签的回复，或直接粘贴普通正文"></textarea>')}<button type="button" data-extraction-preview>预览粘贴内容</button><p data-extraction-metrics role="status" class="sy-help"></p><div data-extraction-warnings class="sy-help"></div><pre data-extraction-result class="sy-source-preview"></pre></section>
<details class="sy-card"><summary>可选：配合主聊天预设的轻量标记</summary><p class="sy-help">普通预设无需改动。需要时将下面这段附加到你的输出格式说明；不会自动替你安装或覆盖预设。</p><textarea rows="8" readonly data-extraction-tag-guide>${esc(NARRATIVE_TAG_GUIDE)}</textarea><p class="sy-help">导出的酒馆正则只影响显示，不删除存档、不修改发给模型的原文。语境块隐藏显示；心理只隐藏标签，里面的描写仍可见。不要改成同时关闭“仅显示”和“仅发送”的破坏性替换。</p><button type="button" data-extraction-regex-export>导出仅显示的隐藏正则</button></details>
</section>`;}

export function mountExtractionView({panel,app,run,download}){
  const root=panel.querySelector?.('[data-view="extraction"]'),$=s=>root?.querySelector?.(s);
  if(!root)return {paint(){}};
  let draft=defaultNarrativeExtractionConfig(),dirty=false,loaded=null,sequence=0,previewSequence=0;
  const message=text=>{$('[data-extraction-status]').textContent=text;};
  function capture(){
    draft.enabled=$('[data-extraction-enabled]').checked;draft.preferChinese=$('[data-extraction-chinese]').checked;
    draft.rules=[...root.querySelectorAll('[data-extraction-rule]')].map(row=>{
      const read=key=>row.querySelector(`[data-rule-${key}]`),tag=read('mode').value==='tag';
      return {id:row.dataset.extractionRule,name:read('name').value,enabled:read('enabled').checked,kind:read('kind').value,capture:Number(read('capture').value),...(tag?{tag:read('pattern').value}:{pattern:read('pattern').value,flags:read('flags').value})};
    });return draft;
  }
  function draw(){
    $('[data-extraction-enabled]').checked=draft.enabled;$('[data-extraction-chinese]').checked=draft.preferChinese;
    $('[data-extraction-rules]').innerHTML=draft.rules.map((r,i)=>`<details class="sy-extraction-rule" data-extraction-rule="${esc(r.id)}" open><summary>规则 ${i+1} · ${esc(r.name)}</summary><div class="sy-grid">${field('名称',`<input data-rule-name value="${esc(r.name)}">`)}${field('用途',`<select data-rule-kind><option value="include" ${r.kind==='include'?'selected':''}>保留匹配内容</option><option value="exclude" ${r.kind==='exclude'?'selected':''}>排除匹配内容</option></select>`)}</div><label class="sy-check"><input type="checkbox" data-rule-enabled ${r.enabled?'checked':''}>启用这条</label><div class="sy-grid">${field('匹配方式',`<select data-rule-mode><option value="tag" ${r.tag!==undefined?'selected':''}>XML 标签名</option><option value="regex" ${r.tag===undefined?'selected':''}>安全正则</option></select>`)}${field('提取部分',`<select data-rule-capture><option value="0" ${r.capture===0?'selected':''}>整个匹配（标签含外壳）</option><option value="1" ${r.capture===1?'selected':''}>第一捕获组（标签内部）</option></select>`)}</div>${field('标签名或正则内容',`<input data-rule-pattern value="${esc(r.tag??r.pattern??'')}" spellcheck="false" placeholder="content 或 ^旁白：(.+)$">`)}${field('正则标志（标签模式忽略）',`<input data-rule-flags value="${esc(r.flags??'u')}" spellcheck="false" placeholder="imu">`)}<button type="button" data-extraction-remove="${esc(r.id)}">删除这条规则</button></details>`).join('')||'<p class="sy-empty">未设置过滤规则：保留全部安全正文。思考、脚本和变量更新不作为正文。</p>';
  }
  function changed(){dirty=true;previewSequence++;message('有未保存的修改；预览使用当前草稿。');}
  function loadDraft(value){draft=normalizeNarrativeConfig(value);draw();changed();}
  function output(result){
    const s=result.stats;$('[data-extraction-metrics]').textContent=`原文 ${s.inputChars} 字符 → 安全正文 ${s.safeChars} → 读取 ${s.outputChars}；额外过滤 ${s.removedChars} 字符${s.fallback?' · 已回退':''}。不是 Token 计数。`;
    $('[data-extraction-warnings]').textContent=result.warnings.join('\n');$('[data-extraction-result]').textContent=result.text;
  }
  const act=(selector,fn)=>$(selector)?.addEventListener('click',e=>run(fn,{name:'extraction',button:e.currentTarget}));
  root.addEventListener('input',e=>{if(e.target.matches('[data-extraction-source],[data-extraction-floor],[data-extraction-json],[data-extraction-file]')){previewSequence++;return;}if(e.target.closest('[data-extraction-rule]')||e.target.matches('[data-extraction-enabled],[data-extraction-chinese]'))changed();});
  root.addEventListener('click',e=>{const b=e.target.closest('[data-extraction-remove]');if(!b)return;capture();draft.rules=draft.rules.filter(r=>r.id!==b.dataset.extractionRemove);draw();changed();});
  $('[data-extraction-preset]')?.addEventListener('change',e=>{if(!e.target.value)return;loadDraft(e.target.value==='safe'?defaultNarrativeExtractionConfig():NARRATIVE_EXTRACTION_PRESETS.find(p=>p.id===e.target.value).config);e.target.value='';});
  act('[data-extraction-add]',()=>{capture();if(draft.rules.length>=16)throw Error('最多 16 条规则，请先合并或删除不用的规则');draft.rules.push({id:`custom-${Date.now()}-${++sequence}`,name:'自定义规则',enabled:true,kind:'exclude',tag:'options',capture:0});draw();changed();});
  act('[data-extraction-save]',async()=>{const config=normalizeNarrativeConfig(capture()),serialized=JSON.stringify(config),revision=previewSequence;await app.saveSettings({narrativeExtraction:serialized});loaded=serialized;if(revision!==previewSequence){message('提交时的规则已保存；你随后编辑的草稿仍保留，尚未保存。');return;}dirty=false;draft=config;message('规则已保存。新总结、人设更新和新校对计划生效；旧记忆、原文及已开始的请求不改。');});
  act('[data-extraction-export]',()=>download(normalizeNarrativeConfig(capture()),'拾忆-正文提取规则.json'));
  act('[data-extraction-json-show]',()=>{$('[data-extraction-json]').value=JSON.stringify(capture(),null,2);});
  act('[data-extraction-json-load]',()=>loadDraft($('[data-extraction-json]').value));
  $('[data-extraction-file]')?.addEventListener('change',e=>run(async()=>{const f=e.target.files?.[0];if(!f)return;if(f.size>24000)throw Error('规则文件超过 24000 字节，请仅导入提取规则');loadDraft(await f.text());e.target.value='';}));
  act('[data-extraction-preview]',async()=>{const config=capture(),id=++previewSequence,result=await app.previewNarrativeExtraction({text:$('[data-extraction-source]').value,config});if(id===previewSequence)output(result);});
  act('[data-extraction-chat]',async()=>{if(!$('[data-extraction-floor]').value.trim())throw Error('请填写聊天楼号');const config=capture(),id=++previewSequence,result=await app.previewNarrativeExtraction({floor:Number($('[data-extraction-floor]').value),config});if(id===previewSequence)output(result);});
  act('[data-extraction-regex-export]',()=>download(narrativeDisplayRegexes(),'拾忆-轻量标记-仅显示正则.json'));
  return {paint(s){const stored=s.settings.narrativeExtraction??'';if(dirty||loaded===stored)return;loaded=stored;try{draft=getNarrativeConfig(stored);draw();message(stored?'正在使用已保存的全局规则。':'默认完整保留安全正文；可选示例或 DIY。');}catch(error){draft=defaultNarrativeExtractionConfig();draw();message(`已保存的规则无法读取：${error.message}；实际请求会回退安全正文。请导入修正后的规则。`);}}};
}
