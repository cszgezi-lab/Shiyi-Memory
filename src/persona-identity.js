import {foldName,nameMentionAt} from './name-fold.js';
import {explicitAliases,manualDictionary,validTerm} from './product-dictionary.js';
import {sha256} from './utils.js';

// Match copies only. Never normalize MVU paths, worldbook text or user prose.
export {foldName};
const personName=value=>validTerm(value)&&!/[\n，。！？；：:<>%=|]/.test(value)&&value.length>=1&&value.length<=32;
const aliasName=value=>personName(value)||validTerm(value)&&/^[\p{Script=Han}]$/u.test(value);
const genericTitle=/^(?:人物|角色|人设|人設|基本|基础|基礎|背景|外貌|性格|兴趣爱好|興趣愛好|爱好|愛好|阶段|階段|资料|資料|设定|設定|档案|檔案|关系|關係|行为|行為|描写|描寫|.*规则|.*規則)$/;
export function personaTitleNames(title){
  return String(title??'').split(/[\s·|｜:：\[\]【】（）()/_—-]+/u).map(s=>s.replace(/(?:的)?(?:人物设定|人物設定|基础资料|基礎資料|人设|人設|档案|檔案|性格|阶段|階段)$/u,'')).filter(s=>personName(s)&&!genericTitle.test(s));
}
function shortNames(name){
  if(!/^[\p{Script=Han}]{3,8}$/u.test(name))return [];
  const words=[];
  for(let i=1;i<name.length-1;i++)words.push(name.slice(i));
  for(let i=1;i<Math.min(4,name.length);i++)for(const suffix of ['同学','先生','小姐','老师','同學','老師','さん','ちゃん'])words.push(name.slice(0,i)+suffix);
  return words;
}

/** A local projection, not a mutation/merge of stored facts or dictionary. */
export function personaIdentity({spans=[],previous=[],dictionary={entries:[]},aliases='',source=''}={}){
  const people=new Map(),overrides=manualDictionary(aliases),terms=dictionary.entries??[];
  const add=(name,extra={})=>{
    if(!personName(name)||genericTitle.test(name))return null;
    const key=foldName(name).trim();let p=people.get(key);
    if(!p){p={key,name:name.trim(),characterId:extra.characterId??sha256(['persona-character',key]).slice(0,24),aliases:new Set(),titleNames:new Set(),profiles:[]};people.set(key,p);}
    if(extra.profile)p.profiles.push(extra.profile);
    for(const word of extra.aliases??[])if(aliasName(word))p.aliases.add(word.trim());
    if(name!==p.name)p.aliases.add(name.trim());return p;
  };
  // Stored canonical identity wins over a model's spelling in this batch.
  for(const p of previous)if(!p.deleted)add(p.name,{characterId:p.characterId,aliases:p.aliases,profile:p});
  for(const t of [...terms,...overrides])if(!t.disabled&&(t.kind==='人物'||t.manual||people.has(foldName(t.name))))add(t.name,{aliases:t.aliases});
  const titleNames=spans.flatMap(s=>personaTitleNames(s.name).slice(0,1));
  for(const name of titleNames.sort((a,b)=>b.length-a.length)){
    const known=[...people.values()].filter(p=>p.key===foldName(name)||[...p.aliases,...shortNames(p.name)].some(a=>foldName(a)===foldName(name)));
    if(known.length===1){known[0].titleNames.add(name);if(!known[0].profiles.some(row=>row.aliasPolicy==='manual'))known[0].aliases.add(name);continue;}
    add(name)?.titleNames.add(name);
  }
  for(const p of people.values()){
    const override=overrides.find(t=>foldName(t.name)===p.key)??terms.find(t=>t.manual&&foldName(t.name)===p.key);
    if(override){p.aliases=new Set(override.disabled?[]:override.aliases.filter(aliasName));p.aliasPolicy=override.disabled?'disabled':'manual';}
    else if(!p.profiles.some(row=>row.aliasPolicy==='manual')) {
      // Explicitly attributed naming statements only; not arbitrary model guesses.
      for(const word of explicitAliases(foldName(p.name),foldName(source)))if(aliasName(word))p.aliases.add(word);
    }
    p.visibleAliases=new Set([...p.aliases].filter(word=>word!==p.name));
    // Keep candidate shortenings internal until the source actually uses one.
    if(!override&&!p.profiles.some(row=>row.aliasPolicy==='manual'))for(const word of shortNames(p.name))p.aliases.add(word);
  }
  const owners=new Map();
  for(const p of people.values())for(const word of [p.name,...p.aliases]){const k=foldName(word);if(!owners.has(k))owners.set(k,new Set());owners.get(k).add(p);}
  const resolve=name=>{const matches=owners.get(foldName(name).trim());return matches?.size===1?[...matches][0]:null;};
  const mentions=text=>{
    text=foldName(text);const hits=[];
    for(const [word,ps] of owners){let at=text.indexOf(word);while(at>=0){
      const after=text.slice(at+word.length);
      if(nameMentionAt(text,word,at)&&!/^(?:的)?(?:母亲|父亲|妈妈|爸爸|姐姐|妹妹|哥哥|弟弟|家族)/.test(after))hits.push({at,end:at+word.length,ps,word});
      at=text.indexOf(word,at+Math.max(1,word.length));
    }}
    hits.sort((a,b)=>(b.end-b.at)-(a.end-a.at));const accepted=[];
    for(const h of hits)if(!accepted.some(x=>h.at>=x.at&&h.end<=x.end))accepted.push(h);
    for(const h of accepted)if(h.ps.size===1){const p=[...h.ps][0];if(h.word!==p.key)p.visibleAliases.add(h.word);}
    return [...new Set(accepted.filter(h=>h.ps.size===1).flatMap(h=>[...h.ps]))];
  };
  // Worldbook ownership is distinct from aliases a user enables for dialogue.
  const forTitle=title=>{const found=new Set();for(const token of personaTitleNames(title)){const direct=resolve(token);if(direct)found.add(direct);for(const p of people.values())if([...p.titleNames].some(n=>foldName(n)===foldName(token)))found.add(p);}return found.size===1?[...found][0]:null;};
  return {people:[...people.values()],resolve,mentions,forTitle};
}
export function personaAliases(value){
  const words=Array.isArray(value)?value:String(value??'').split(/[,，\n]/);
  if(words.length>32||words.some(w=>typeof w!=='string'||w.trim()&&!aliasName(w.trim())))throw new Error('别称最多32个，请填写实际姓名或称呼，不使用“他、她、老师”等泛称');
  return [...new Set(words.map(w=>w.trim()).filter(Boolean))];
}
