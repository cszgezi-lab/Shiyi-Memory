import {sha256,clone} from './utils.js';
import {foldName} from './persona-identity.js';
import {characterKeepsakes,markDiaryHistory} from './character-journal.js';
import {sourceFloors} from './product-narrative.js';
import {qualitySourceSegments} from './source-evidence.js';
import {withoutPrivateSpeech} from './memory-evidence.js';

export const PERSONA_COMPOSITION_RULE=`当前使用原文保留模式。original.parts列出程序保留的原设定片段及当前有效文字，ref仅定位本人物片段。不要重写整篇传记。
先依据source中的明确时间、日期、学段和倒叙/回忆切换，区分当前叙事时点、原卡默认时点与历史/未来设定。楼号是来源位置，不是故事日期；楼号增加也可能进入更早的倒叙学段，不能直接套用原卡默认的年龄、学校、班级、团体或已成立关系。原文自身有时间冲突时标明来源与待核实处，不把冲突句当定论。只在有明确证据时局部更新；不明确则标注原卡默认时点及适用范围，不把整段旧设定删掉。禁止按学段、日期差或常识自动猜测年龄或学校并替换，未发生的未来关系不可当作当前关系。
每份人物输出{name,text,sourceFloors,updates:[{ref,text,sourceFloors}],examples:[{text,floor,to,context}]}。text只写原设定之外的当前关系、心态和新增自由属性，必须写明对象与情境，不重复抄外貌背景。previous.text中未改变的新增属性和关系也必须保留，不能每批只剩最新变化。updates只放本批确有依据改变的片段，使用本人物提供的ref；不变化返回[]，不删除其他细节。每个修改都提供本批依据楼号。片段中的其他未变信息保留原措辞。不允许空text删除片段。若旧片段仍断言已被剧情改变的关系或当前穿着，必须修改该片段，不能只在text追加矛盾说法。
按不同对象写清当前关系、态度与说话方式，并注明来源楼号及当时情境；区分家人面前、公开场合与两人独处时的表达，不能把对某人的说话方式推广给所有人。好感、动摇、羞涩或否认须保留原文证据与不确定性；单方心动不等于双方已确认交往，不虚造好感数值，也不只追加事件流水账。此前仍有效的对象关系与自由属性继续保留。
外貌、语言风格、价值观和稳定属性锚定原设定，不因临时心情漂移；剪发、染发、受伤等明确发生或用户确认时才更新。原卡服饰风格是习惯，某次穿着不是永久外貌；本场景衣着连续，明确换装才更新当前描述，跨日不强制一直同一套，也不每轮随机换装。新增属性不限预设字段。
examples选用少量能表现当前人物表达方式的真实原话，每条附floor、对谁说和当时context；context中的日期/学段/场合只填来源明确提供的内容，缺失不编造，未知对象不猜。可保留previous.examples中仍合适的原话（原文和楼号不变），或选择本批明确说出的新原话。只引用实际出现的完整原话，GAL日文原话或配对中文译文均须逐字来自同一显式说话人，不自行翻译，不编示范，不把私密心声、旁白或他人台词当本人的公开台词。旧阶段语料仅供历史，不覆盖当前关系；重要旧原话仍在记忆与档案历史中。materials是已有记忆参考，private为私人心迹，inferred为推测而非事实，用户编写不冒充已验证原话；不赋予其他角色知情。reviewFocus是程序从完整正文摘出的变化线索，不是已确认结论；在完整语境中逐条确认，尤其明确换装、身体变化、关系确认和新增能力，不要因其只占一句就遗漏。记录当前服装时写明来源楼号、来源明确的时间和当场衣着，服饰习惯与当场衣着分开，不把旧场景服装当当前穿着，不永久固定。只在有实质变化时返回人物，无变化profiles:[]。`;

const speechPairs=new Map([['“','”'],['「','」'],['『','』'],['"','"'],['〔','〕'],['【','】'],['（','）'],['(',')'],['‘','’']]);
// Read an outer span as a unit: quoted names/speech inside action, thought or
// narrator brackets must never establish a new speaker. Unclosed spans fail shut.
function speechSpanEnd(text,start){
  const stack=[speechPairs.get(text[start])];
  for(let i=start+1;i<text.length;i++){
    if(text[i]===stack.at(-1)){stack.pop();if(!stack.length)return i;}
    else if(speechPairs.has(text[i]))stack.push(speechPairs.get(text[i]));
  }
  return -1;
}

function personaSpeechLead(lead,speaker,identity){
  const folded=foldName(lead).trim();
  if(/心想|暗想|心里|心中|内心|心声|心の声|心の中|モノローグ|ナレーション|默念|默想|想道|思忖|腹诽|独白|旁白|画外音|未说|没说|没有说|并未|没有开口|沉默|如果|假如|假设|也许|可能会|打算|想要|准备|梦中|梦见/.test(folded))return false;
  // A bounded grammar rather than 'some name occurs in the preceding prose'.
  // Addressees are allowed only behind 对/向; shared aliases use identity.resolve.
  const header=/^(.*?)(?:\s*【[^】\r\n]*】)?\s*[：:]?\s*$/u.exec(folded)?.[1]?.trim();
  if(!header)return false;
  const owns=label=>{
    const person=identity?.resolve(label),target=identity?.resolve(speaker);
    if(person)return person.key===(target?.key??foldName(speaker));
    // A new unindexed character may use its exact full name. Never bypass an
    // ambiguous/disabled alias known to the identity index.
    const known=identity?.people.some(p=>[p.name,...p.aliases].some(a=>foldName(a)===label));
    return !known&&label===foldName(speaker).trim();
  };
  if(owns(header))return true;
  const target=identity?.resolve(speaker),labels=[speaker,...(target?[target.name,...target.aliases]:[])].map(foldName);
  const spoken=/^\s*(?:(?:对|向)[\p{L}\p{N}· ]{1,40})?\s*(?:(?:轻声|低声|小声|大声|柔声|笑着|认真地|温和地)\s*)?(?:说道|说|问道|问|回答|答道|回应|喊道|喊|答|道)$/u;
  return labels.some(label=>header.startsWith(label)&&owns(label)&&spoken.test(header.slice(label.length)));
}

/** Local exact utterance attribution, reusable without a model call. Identity
 * folding applies only to speaker labels; source words are never normalized.
 * This checks explicit forms, not semantic truth, chronology or who heard them. */
export function hasPersonaSpeechEvidence(evidence,quote,speaker,identity){
  if(typeof quote!=='string'||!quote.trim()||typeof speaker!=='string'||!speaker.trim()||!String(evidence??'').includes(quote))return false;
  // Reuse the source filter, retaining boundaries across removed planning,
  // variable or script blocks so removal cannot manufacture an attribution.
  const raw=withoutPrivateSpeech(evidence);
  // Keep the explicit content-body boundary used by hasSpeechEvidence, while
  // filtering against original offsets (never concatenate through hidden text).
  const body=/^\s*<content>\s*\r?\n([\s\S]*?)<\/content>/mi.exec(raw);
  const from=body?body.index+body[0].indexOf('>')+1:0,to=body?body.index+body[0].lastIndexOf('</content>'):raw.length;
  let end=from;
  const source=qualitySourceSegments({id:'persona-speech',text:raw}).filter(s=>s.end>from&&s.start<to).map(s=>{
    const a=Math.max(from,s.start),b=Math.min(to,s.end),chunk=(a===end?'':'\n\uFFFC\n')+raw.slice(a,b);end=b;return chunk;
  }).join('');
  let start=0;
  for(let i=0;i<source.length;i++){
    // Only examine top-level lines. A second global line scan would expose
    // unquoted dialogue nested in multiline narrator/inner-thought brackets.
    if(i===0||source[i-1]==='\n'){
      const last=source.indexOf('\n',i),line=source.slice(i,last<0?source.length:last).trim();
      const m=/^([^：:\r\n]+)[：:]\s*([^“”「」『』"〔〕【】（）()‘’]+)$/u.exec(line);
      if(m&&m[2].trim()===quote&&personaSpeechLead(m[1],speaker,identity))return true;
    }
    const c=source[i];
    if(speechPairs.has(c)){
      const close=speechSpanEnd(source,i);if(close<0)break;
      if(/[“「『"]/u.test(c)){
        const attributed=personaSpeechLead(source.slice(start,i),speaker,identity);
        if(attributed&&source.slice(i+1,close).trim()===quote)return true;
        // Keep the Japanese opener's subject through its matching closer and
        // adjacent translation. An intervening narrator/speaker breaks the pair.
        const translated=c==='「'?/^\s*〔/u.exec(source.slice(close+1)):null;
        if(translated){
          const at=close+translated[0].length,last=speechSpanEnd(source,at);
          if(last<0)break;
          if(attributed&&source.slice(at+1,last).trim()===quote)return true;
          i=last;start=i+1;continue;
        }
        start=close+1;
      }else if(c!=='【')start=close+1;
      i=close;
    }else if(/[。！？；，,;!?\r\n]/u.test(c)){
      // GAL often puts an explicit speaker header on one line and the quoted
      // utterance on the very next. Retain only a verified header across this
      // one line break; never bridge narration, blank lines or removed text.
      const breakLength=c==='\r'&&source[i+1]==='\n'?2:1;
      if((c==='\n'||c==='\r')&&personaSpeechLead(source.slice(start,i),speaker,identity)&&/^[ \t]*[“「『"]/.test(source.slice(i+breakLength))){i+=breakLength-1;continue;}
      start=i+1;
    }
  }
  return false;
}

// Model formatting is not the utterance itself. Remove at most one complete
// outer quote/translation pair, never select a substring or one half of a
// bilingual candidate. The caller must still verify the exact source speaker.
function unwrappedPersonaQuote(value){
  const text=typeof value==='string'?value.trim():'';
  if(!['“','「','『','"','‘','〔'].includes(text[0])||speechSpanEnd(text,0)!==text.length-1)return text;
  return text.slice(1,-1).trim();
}

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
    const m=messages.find(m=>m.index===q?.floor),raw=typeof q?.text==='string'?q.text.trim():'';
    const text=m&&hasPersonaSpeechEvidence(m.text,raw,name,identity)?raw:unwrappedPersonaQuote(raw);
    const prior=(previous?.composition?.examples??[]).find(p=>p.kind==='source_quote'&&p.text===text&&p.floor===q?.floor);
    // Previously verified history can be outside this batch. If its floor is
    // supplied again, recheck the actual source instead of trusting an old tag.
    if(prior&&!m){if(!examples.some(p=>p.text===prior.text&&p.floor===prior.floor))examples.push(clone(prior));continue;}
    if(!m||!hasPersonaSpeechEvidence(m.text,text,name,identity)||/<%|%>|<\/?script\b|\{\{|@@|\[\[SHIYI_PERSONA:/i.test([text,q?.to,q?.context].join('\n'))){rejectedExamples++;continue;}
    if(!examples.some(e=>e.text===text&&e.floor===q.floor))examples.push(prior?clone(prior):{text,floor:q.floor,to:typeof q.to==='string'?q.to:'',context:typeof q.context==='string'?q.context:'',kind:'source_quote'});
  }
  const sceneEvidence=personaSceneEvidence(messages,identity,name,previous?.composition?.sceneEvidence);
  const notes=row.text.trim(),composition={version:1,parts,notes,examples,sceneEvidence,changes,rejectedExamples};
  const blocks=[];let last;
  for(const part of parts){const key=JSON.stringify([part.book,part.uid,part.spanId]);if(last?.key!==key){last={key,title:part.title,text:''};blocks.push(last);}last.text+=part.text;}
  const exampleText=examples.map(q=>`第${q.floor}楼${q.to?' 对'+q.to:''}：${q.text}${q.context?'〔'+q.context+'〕':''}`).join('\n');
  const text=[...blocks.map(b=>`【有效设定 · ${b.title}】\n${b.text}`),notes?`【当前剧情变化】\n${notes}`:'',sceneEvidence.length?`【最近外观情境 · 逐字原文，按当时场景理解，不是永久外貌或当前穿着指令】\n${sceneEvidence.map(e=>`第${e.floor}楼：${e.text}`).join('\n')}`:'',examples.length?`【本阶段表达语料 · 原话仅供模仿表达，不要求复读】\n${exampleText}`:'',parts.length?'【适用边界】稳定外貌与习惯以保留设定为底稿；当前叙事时点可能处于倒叙，原卡默认时点的年龄、学段、关系不自动适用于当前场景，无明确依据不猜年龄或学校。来源楼号不是故事日期，原话及衣着按来源当时的时间、对象与场景理解；旧阶段语料不证明当前关系。服装描述服从当前场景与最新明确换装，不把旧场景穿着当永久外貌。当前关系以已发生剧情为准，对某人的表达与好感不推广给所有对象，私密心迹不赋予他人知情。':''].filter(Boolean).join('\n\n');
  return {text,composition:clone(composition)};
}
