import { readViewState } from '../src/product-view-scheduling.js';
import { esc,field } from '../src/product-settings-ui.js';
import { knowledgeImportPlan } from '../src/product-knowledge-import.js';

export function knowledgeImportHTML(){return `<div class="sy-card"><h4>导入资料库</h4><p class="sy-help">原创与同人共用文本资料库。原创区分设定与剧情计划；同人区分原作主线与当前分支。资料不是角色已知的经历。</p>${field('文件用途','<select data-purpose><option value="knowledge">作品 / 世界资料</option><option value="rules">配置规则 MD / SKILL / JSON</option></select>')}<input type="file" accept=".txt,.md,.json" multiple data-files aria-label="选择资料文件"><div data-knowledge-options>${field('每段最多多少字','<input type="number" min="200" max="6000" value="600" data-kb-size>')}${field('分隔符（可留空）','<input data-kb-delimiter maxlength="100" placeholder="例如：###">')}<label class="sy-toggle"><span>关键词索引（本地 BM25）</span><input type="checkbox" data-kb-keyword checked></label><label class="sy-toggle"><span>向量索引（调用向量 API）</span><input type="checkbox" data-kb-vector checked></label><label class="sy-toggle"><span>分析资料并生成字典（调用助手 API）</span><input type="checkbox" data-kb-analysis checked></label></div><p class="sy-help">文件在本机解析为文字；确认导入后，所选的分析 / 向量服务会收到相关文字。世界书 JSON 读取已启用条目，不执行脚本。</p><div class="sy-actions"><button type="button" data-kb-preview>预览切片</button><button type="button" data-kb-import disabled class="sy-primary">确认导入并建立所选索引</button></div><div data-kb-preview-list></div></div><div data-documents></div>`;}

export function mountKnowledgeView({panel,app,run,host}){
  const $=s=>panel.querySelector(s);let drafts=[],stamp='',selectionVersion=0;const previews=new Map();
  function invalidate(){selectionVersion++;drafts=[];$('[data-kb-import]').disabled=true;$('[data-kb-preview-list]').textContent='';}
  for(const el of panel.querySelectorAll('[data-files],[data-purpose],[data-kb-size],[data-kb-delimiter],[data-kb-keyword],[data-kb-vector],[data-kb-analysis],[data-setting="worldMode"]'))el.addEventListener('change',invalidate);
  $('[data-purpose]').addEventListener('change',()=>{$('[data-knowledge-options]').hidden=$('[data-purpose]').value==='rules';});
  $('[data-kb-preview]').addEventListener('click',()=>run(async()=>{
    invalidate();const version=selectionVersion,purpose=$('[data-purpose]').value,files=Array.from($('[data-files]').files??[]);if(!files.length)throw new Error('请先选择文件');if(files.some(f=>f.size>20*1024*1024))throw new Error('单个文件上限 20 MB');
    const options={chunkSize:Number($('[data-kb-size]').value),delimiter:$('[data-kb-delimiter]').value,keywordEnabled:$('[data-kb-keyword]').checked,vectorEligible:$('[data-kb-vector]').checked,autoAnalyze:$('[data-kb-analysis]').checked,worldMode:$('[data-setting="worldMode"]').value};
    const selected=await Promise.all(files.map(async f=>({name:f.name,text:await f.text(),purpose,options})));if(version!==selectionVersion)return;
    const plans=selected.map(knowledgeImportPlan);drafts=selected;
    $('[data-kb-preview-list]').innerHTML=plans.map(p=>`<article><h4>${esc(p.name)}</h4><p>${esc(p.format)} · ${p.chars} 字 · ${p.chunks.length} 段</p>${p.chunks.slice(0,3).map((c,i)=>`<details><summary>第 ${i+1} 段 · ${c.text.length} 字</summary><div class="sy-packet">${esc(c.text)}</div></details>`).join('')}${p.chunks.length>3?'<p class="sy-help">预览前 3 段，导入时保存全部。</p>':''}</article>`).join('');$('[data-kb-import]').disabled=false;
  }));
  $('[data-kb-import]').addEventListener('click',()=>run(async()=>{
    if(!drafts.length)throw new Error('请先预览切片');const pending=drafts;invalidate();const errors=[];
    for(const input of pending){const doc=await app.addDocument(input);
      if(input.purpose==='rules'||input.options.autoAnalyze)try{const result=await app.analyzeDocuments([doc.id]);if(result.partial)errors.push(`${doc.name}：字典待补全`);}catch(e){if(e.code==='CANCELED')throw e;errors.push(`${doc.name}：资料分析未完成`);}
      if(input.purpose==='knowledge'&&input.options.vectorEligible)try{const result=await app.buildKnowledgeVectors([doc.id]);if(result.pending)errors.push(`${doc.name}：部分向量未完成`);}catch(e){if(e.code==='CANCELED')throw e;errors.push(`${doc.name}：向量索引未完成`);}
    }
    $('[data-files]').value='';if(errors.length)throw new Error(`文字资料已保存。${errors.join('；')}。请检查对应 API，再在资料下点击继续；不必重新导入。`);
  },{name:'import'}));
  function paint(s){
    const signature=JSON.stringify([s.documents,[...previews]]);if(stamp===signature)return;stamp=signature;
    $('[data-documents]').innerHTML=(s.documents??[]).map(d=>`<article class="sy-card" data-kb-doc="${esc(d.id)}"><h4>${esc(d.name)}</h4><p class="sy-help">${d.purpose==='rules'?'配置规则':d.importOptions?.worldMode==='fanfiction'?'同人原作':'世界资料'} · ${d.chars} 字 · ${d.chunks} 段${d.importOptions?.enabled===false?' · 已停用':''}</p><p>关键词：${d.purpose==='rules'?'不参与召回':d.importOptions?.keywordEnabled===false?'未启用':'可检索'}<br>资料分析：${d.analyzed??0}/${d.chunks} 段 · 字典${d.dictionaryStatus==='ready'?'已生成':d.dictionaryStatus==='partial'?'待补全':'待分析'}${d.purpose==='knowledge'?`<br>向量：${d.importOptions?.vectorEligible===false?'未启用':d.vectorStatus?`上次建成 ${d.vectorStatus.indexed}/${d.vectorStatus.total} 条`:'待建立'}`:''}</p><div class="sy-actions"><button type="button" data-kb-read="${esc(d.id)}">查看片段</button><button type="button" data-kb-analyze="${esc(d.id)}">继续分析 / 字典</button>${d.purpose==='knowledge'&&d.importOptions?.vectorEligible!==false?`<button type="button" data-kb-build="${esc(d.id)}">继续建索引</button>`:''}<button type="button" data-kb-toggle="${esc(d.id)}">${d.importOptions?.enabled===false?'启用资料':'停用资料'}</button><button type="button" data-remove-doc="${esc(d.id)}">删除资料</button></div>${previews.get(d.id)??''}</article>`).join('')||'<p class="sy-empty">还没有资料库。先选择文件并预览切片。</p>';
  }
  $('[data-documents]').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    run(async()=>{
      if(b.dataset.kbRead){const parts=await app.documentPreview(b.dataset.kbRead);previews.set(b.dataset.kbRead,parts.map((p,i)=>`<details><summary>第 ${i+1} 段</summary><div class="sy-packet">${esc(p?.text)}</div></details>`).join(''));paint(readViewState(app));}
      if(b.dataset.kbAnalyze)return app.analyzeDocuments([b.dataset.kbAnalyze]);
      if(b.dataset.kbBuild)return app.buildKnowledgeVectors([b.dataset.kbBuild]);
      if(b.dataset.kbToggle){const d=readViewState(app).documents.find(d=>d.id===b.dataset.kbToggle);await app.updateDocument(d.id,{enabled:d.importOptions?.enabled===false});}
      if(b.dataset.removeDoc&&host.confirm?.('删除这份资料？无法在插件内撤销，请保留原文件；聊天原文不受影响。'))await app.removeDocument(b.dataset.removeDoc);
    },{name:b.dataset.kbBuild?'vectors':b.dataset.kbAnalyze?'analyze':'',button:b});
  });
  return {paint};
}
