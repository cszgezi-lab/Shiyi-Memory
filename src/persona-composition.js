import {sha256,clone} from './utils.js';
import {foldName} from './persona-identity.js';
import {characterKeepsakes,markDiaryHistory} from './character-journal.js';
import {sourceFloors} from './product-narrative.js';

export const PERSONA_COMPOSITION_RULE=`当前使用原文保留模式。original.parts列出程序保留的原设定片段及当前有效文字，ref仅定位本人物片段。不要重写整篇传记。
每份人物输出{name,text,sourceFloors,updates:[{ref,text,sourceFloors}],examples:[{text,floor,to,context}]}。text只写原设定之外的当前关系、心态和新增自由属性，必须写明对象与情境，不重复抄外貌背景。previous.text中未改变的新增属性和关系也必须保留，不能每批只剩最新变化。updates只放本批确有依据改变的片段，使用本人物提供的ref；不变化返回[]，不删除其他细节。每个修改都提供本批依据楼号。片段中的其他未变信息保留原措辞。不允许空text删除片段。若旧片段仍断言已被剧情改变的关系或当前穿着，必须修改该片段，不能只在text追加矛盾说法。
外貌、语言风格、价值观和稳定属性锚定原设定，不因临时心情漂移；剪发、染发、受伤等明确发生或用户确认时才更新。原卡服饰风格是习惯，某次穿着不是永久外貌；本场景衣着连续，明确换装才更新当前描述，跨日不强制一直同一套，也不每轮随机换装。新增属性不限预设字段。
examples选用少量能表现当前人物表达方式的真实原话，每条附floor、对谁说和当时context；可保留previous.examples中仍合适的原话（原文和楼号不变），或选择本批明确说出的新原话。只引用实际出现的完整原话，不编示范，不把私密心声当公开台词。旧阶段语料仅供历史，不覆盖当前关系；重要旧原话仍在记忆与档案历史中。materials是已有记忆参考，private为私人心迹，inferred为推测而非事实，用户编写不冒充已验证原话；不赋予其他角色知情。reviewFocus是程序从完整正文摘出的变化线索，不是已确认结论；在完整语境中逐条确认，尤其明确换装、身体变化、关系确认和新增能力，不要因其只占一句就遗漏。记录当前服装时写明是当时场景，不永久固定。只在有实质变化时返回人物，无变化profiles:[]。`;

// A small exact-source index, not another summary or extra model request.
// Full source remains available; truncating this optional index loses no input.
export function personaReviewFocus(messages,identity){
  const change=/换上|換上|换成|換成|脱下|脫下|剪短|染成|受伤|受傷|新增|学会|學會|不再|成为|成為|确认|確認|告白|分手|承诺|承諾|搬家|改行|决定|決定|约定|約定/;
  const perPerson=new Map();
  for(const m of messages)for(const sentence of m.text.match(/[^。！？\n]+[。！？]?/gu)??[]){
    if(!change.test(sentence)||sentence.length>600)continue;
    const people=identity.mentions(sentence);for(const person of people){const list=perPerson.get(person.key)??[];list.push({floor:m.index,name:person.name,excerpt:sentence});if(list.length>8)list.shift();perPerson.set(person.key,list);}
  }
  return [...perPerson.values()].flat();
}

// Carry an exact, dated scene reference even when the model omits a brief
// wardrobe/body change. It is NOT promoted into an everlasting character fact.
// Only uniquely named subjects qualify; pronouns and multi-person sentences
// are left to the model instead of guessed by this local fallback.
export function personaSceneEvidence(messages,identity,name,previous=[]){
  const evidence=new Map(previous.map(e=>[e.kind,e]));
  const change=/换上|換上|换成|換成|脱下|脫下|穿着|穿著|剪短|染成|受伤|受傷|伤愈|傷癒/;
  for(const m of messages)for(const sentence of m.text.match(/[^。！？\n]+[。！？]?/gu)??[]){
    if(!change.test(sentence)||sentence.length>600||/<%|%>|<\/?script\b|\{\{|@@|\[\[SHIYI_PERSONA:/i.test(sentence))continue;
    const people=identity.mentions(sentence);if(people.length!==1||people[0].key!==foldName(name))continue;
    const lead=foldName(sentence.trim()).split(change)[0],person=people[0];
    const alias=[person.name,...person.aliases].map(foldName).sort((a,b)=>b.length-a.length).find(n=>lead.startsWith(n));
    if(!alias||/^(与|和|同|跟|向|对)/.test(lead.slice(alias.length))||/希望|想要|想|打算|计划|讨论|谈论|回忆|假设|如果|是否|没有|还没|未曾/.test(lead))continue;
    const kind=/换上|換上|换成|換成|脱下|脫下|穿着|穿著/.test(sentence)?'wardrobe':'appearance';
    if(!evidence.has(kind)||evidence.get(kind).floor<=m.index)evidence.set(kind,{kind,floor:m.index,text:sentence});
  }
  return [...evidence.values()];
}

export function personaParts(spans,previous){
  const old=new Map((previous?.composition?.parts??[]).map(p=>[p.key,p]));let sequence=0;
  return spans.flatMap(s=>{
    // Preserve every byte, including spacing. Sentence-size changes avoid
    // asking the model to regenerate unrelated paragraphs of a long profile.
    const chunks=s.text.match(/[^\n。！？]+(?:[。！？]+[”’」』]?|\n|$)|\n/gu)??[s.text];
    const pieces=chunks.join('')===s.text?chunks:[s.text];
    return pieces.map((original,i)=>{const key=sha256([s.book,s.uid,s.id,i,original]).slice(0,24),prior=old.get(key);
      return {key,ref:`B${++sequence}`,book:s.book,uid:s.uid,title:s.originalName??s.name,spanId:s.id,original,text:prior?.text??original,sourceFloors:prior?.sourceFloors??[]};
    });
  });
}

export function personaMaterials(records,identity,mentioned,endFloor){
  const rows=Array.isArray(records)?records:Object.values(records??{}).flat();
  const eligible=rows.filter(r=>r&&!['retracted','superseded'].includes(r.lifecycleState)&&sourceFloors(r).length&&sourceFloors(r).every(f=>f<=endFloor)&&!(r.awareness??[]).some(a=>a.pending));
  const keepsakes=characterKeepsakes(markDiaryHistory(eligible).filter(r=>!r.innerLifeHistorical),{withExpected:false}),latest=new Map();
  for(const r of [...keepsakes.diaries,...keepsakes.dialogues]){
    const p=identity.resolve(r.subject);if(!p||!mentioned.has(p.key)||r.data.disabled||r.data.status==='historical')continue;
    const key=JSON.stringify([p.key,r.kind,r.target,r.data.stage??r.data.context??r.record.id]);
    const value={name:p.name,kind:r.kind,to:r.target,text:r.data.text,context:r.data.context??r.data.stage,basis:r.data.basis,provenance:r.data.provenance,private:r.kind==='diary',floors:sourceFloors(r.record)};
    const old=latest.get(key);if(!old||Math.max(...old.floors)<=Math.max(...value.floors))latest.set(key,value);
  }
  return [...latest.values()];
}

export function composePersona(row,{spans,previous,messages,identity,name,fail}){
  const parts=personaParts(spans,previous),byRef=new Map(parts.map(p=>[p.ref,p])),touched=new Set(),changes=[];
  const validFloors=floors=>Array.isArray(floors)&&floors.length&&floors.every(f=>messages.some(m=>m.index===f));
  if(row.updates!==undefined&&!Array.isArray(row.updates))throw fail('text','局部修改应为列表');
  for(const edit of row.updates??[]){
    const part=byRef.get(String(edit?.ref??''));
    if(!part||touched.has(part.key)||typeof edit.text!=='string'||!edit.text.trim()||!validFloors(edit.sourceFloors)||/<%|%>|<\/?script\b|\{\{|@@|\[\[SHIYI_PERSONA:/i.test(edit.text))throw fail('text','局部修改没有唯一对应本人物原文或本批依据，原档案保留');
    touched.add(part.key);const before=part.text;part.text=edit.text+(/\n$/.test(part.original)&&!edit.text.endsWith('\n')?'\n':'');part.sourceFloors=[...new Set(edit.sourceFloors)];
    if(before!==part.text)changes.push({title:part.title,before,after:part.text,sourceFloors:part.sourceFloors});
  }
  const examples=[];let rejectedExamples=0;
  const candidates=row.examples===undefined?(previous?.composition?.examples??[]):Array.isArray(row.examples)?row.examples:[];
  for(const q of candidates){
    const prior=(previous?.composition?.examples??[]).find(p=>p.kind==='source_quote'&&p.text===q?.text&&p.floor===q?.floor);
    if(prior){if(!examples.some(p=>p.text===prior.text&&p.floor===prior.floor))examples.push(clone(prior));continue;}
    const m=messages.find(m=>m.index===q?.floor),text=typeof q?.text==='string'?q.text.trim():'';
    const at=text?m?.text.indexOf(text)??-1:-1;
    // The quote and its attributed speaker must exist together, not merely
    // somewhere in a long floor. Unknown attribution is not fabricated.
    const context=at<0?'':m.text.slice(Math.max(0,at-100),at);
    const lead=context.split(/[。！？\n”」]/u).at(-1),speaker=identity.mentions(lead);
    if(!text||at<0||speaker.length!==1||speaker[0].key!==foldName(name)||!/[“「"：:]/u.test(lead.slice(-40))||/心想|暗想|心里想|内心独白/.test(lead)||/<%|%>|<\/?script\b|\{\{|@@|\[\[SHIYI_PERSONA:/i.test([text,q.to,q.context].join('\n'))){rejectedExamples++;continue;}
    if(!examples.some(e=>e.text===text&&e.floor===q.floor))examples.push({text,floor:q.floor,to:typeof q.to==='string'?q.to:'',context:typeof q.context==='string'?q.context:'',kind:'source_quote'});
  }
  const sceneEvidence=personaSceneEvidence(messages,identity,name,previous?.composition?.sceneEvidence);
  const notes=row.text.trim(),composition={version:1,parts,notes,examples,sceneEvidence,changes,rejectedExamples};
  const blocks=[];let last;
  for(const part of parts){const key=JSON.stringify([part.book,part.uid,part.spanId]);if(last?.key!==key){last={key,title:part.title,text:''};blocks.push(last);}last.text+=part.text;}
  const exampleText=examples.map(q=>`第${q.floor}楼${q.to?' 对'+q.to:''}：${q.text}${q.context?'〔'+q.context+'〕':''}`).join('\n');
  const text=[...blocks.map(b=>`【有效设定 · ${b.title}】\n${b.text}`),notes?`【当前剧情变化】\n${notes}`:'',sceneEvidence.length?`【最近外观情境 · 逐字原文，按当时场景理解，不是永久外貌或当前穿着指令】\n${sceneEvidence.map(e=>`第${e.floor}楼：${e.text}`).join('\n')}`:'',examples.length?`【本阶段表达语料 · 原话仅供模仿表达，不要求复读】\n${exampleText}`:'',parts.length?'【适用边界】稳定外貌与习惯以保留设定为底稿；服装描述服从当前场景与最新明确换装，不把旧场景穿着当永久外貌。当前关系以已发生剧情为准，私密心迹不赋予他人知情。':''].filter(Boolean).join('\n\n');
  return {text,composition:clone(composition)};
}
