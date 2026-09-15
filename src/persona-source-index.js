import {personaIdentity} from './persona-identity.js';

const shared=/规则|規則|系统|系統|世界观|世界觀|世界设定|世界設定|变量|變量|初始化|状态栏|狀態欄|提示词|提示詞|多人|全体|全體|all\s*characters/i;
const personal=/人物|角色|人设|人設|档案|檔案|外貌|性格|口吻|语料|語料|衣着|衣著|爱好|愛好|profile|appearance/i;
// Category-only headings do not name a person. In particular, two joined
// categories must not become a competing identity against an explicit key.
const categoryTitle=value=>!String(value??'').replace(/人物|角色|人设|人設|档案|檔案|外貌|性格|口吻|语料|語料|衣着|衣著|爱好|愛好|兴趣|興趣|基础|基礎|基本|资料|資料|设定|設定|背景|关系|關係|行为|行為|描写|描寫|与|與|和|及|\s|[·:：/、_-]|profile|appearance/gi,'');
const declaredNames=text=>[...new Set([...String(text??'').matchAll(/^\s*(?:[-*]\s*)?(?:姓名|角色名|人物姓名|name)\s*[:：]\s*["']?([^\n"'，,。；;<>]{1,32})/gmi)].map(m=>m[1].trim()))];
const entryKey=e=>JSON.stringify([e.book,e.uid]);

// Only explicit metadata establishes ownership. A body merely mentioning a
// person is not permission to remove world rules or another person's prose.
export function personaSourceIndex(world,{previous=[],dictionary,aliases='',source=''}={}){
  const entries=world.entries??[],byEntry=new Map(entries.map(e=>[entryKey(e),e]));
  const named=(world.spans??[]).map(s=>{
    const names=declaredNames(s.text);
    const name=names.length===1&&!shared.test(s.name??'')?names[0]:s.name;
    return {...s,name,originalName:s.originalName??s.name,...(names.length>1?{mixed:true}:{})};
  });
  const seeds=named.filter(s=>!s.mixed&&!shared.test(s.originalName??'')&&!categoryTitle(s.name));
  // A generic profile title with one explicit name key is a supported format.
  for(const entry of entries){const keys=(entry.keys??[]).filter(k=>typeof k==='string'&&/^[\p{Script=Han}·]{2,12}$/u.test(k));
    if(!shared.test(entry.name??'')&&personal.test(entry.name??'')&&keys.length===1)seeds.push({name:keys[0]});
  }
  const identity=personaIdentity({spans:seeds,previous,dictionary,aliases,source});
  const ownership=e=>{
    if(shared.test(e.originalName??e.name??'')||e.mixed)return null;
    const namedOwner=categoryTitle(e.name)?null:identity.forTitle(e.name),keys=(byEntry.get(entryKey(e))?.keys??e.keys??[]),keyOwners=new Set(keys.map(k=>identity.resolve(k)).filter(Boolean));
    if(keyOwners.size>1)return null;
    if(namedOwner&&keyOwners.size===1&&!keyOwners.has(namedOwner))return null;
    return namedOwner??((personal.test(e.originalName??e.name??'')||!(e.name??'').trim())&&keyOwners.size===1?[...keyOwners][0]:null);
  };
  const spans=named.map(s=>{const owner=ownership(s);return {...s,name:owner?.name??s.name,ownerKey:owner?.key??null};});
  const audit=entries.map(e=>{
    const found=spans.filter(s=>entryKey(s)===entryKey(e)),owners=[...new Set(found.map(s=>s.ownerKey).filter(Boolean))];
    const status=e.enabled===false?'disabled':shared.test(e.name??'')?'shared':!found.length?'unsupported':owners.length===1?'owned':'unresolved';
    return {book:e.book,uid:e.uid,title:e.name||'未命名条目',status,owner:owners.length===1?identity.resolve(owners[0])?.name??owners[0]:null};
  });
  return {identity,spans,audit};
}

export const PERSONA_SOURCE_LABELS=Object.freeze({disabled:'原书已停用，未读取',shared:'公共规则，不作为人物替换',unsupported:'模板尚不能安全分离，原条目保留',owned:'已识别人物归属',unresolved:'人物归属未确认，原条目保留'});
