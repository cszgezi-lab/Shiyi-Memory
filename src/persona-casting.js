import {foldName} from './persona-identity.js';

export const PERSONA_GENDERS=Object.freeze({unknown:'性别未注明',female:'女',male:'男',nonbinary:'非二元',other:'其他'});
export const PERSONA_ROLES=Object.freeze({unknown:'定位未注明',lead:'主角',core:'重要配角',support:'配角',guest:'客串'});
export const PERSONA_CASTING_RULE='可选casting={gender:unknown/female/male/nonbinary/other,role:unknown/lead/core/support/guest,playerControlled:boolean,evidence:{floor,quote}}。只依据原文明确性别、剧情定位或玩家归属，不凭姓名和恋爱对象猜性别/主角；quote须逐字含正式姓名。缺依据不输出。previous.casting.manual中的人工指定不能覆盖。';
export function personaCasting(value={}){
  return {gender:Object.hasOwn(PERSONA_GENDERS,value.gender)?value.gender:'unknown',role:Object.hasOwn(PERSONA_ROLES,value.role)?value.role:'unknown',playerControlled:value.playerControlled===true,manual:{...value.manual}};
}
export function personaAttentionWeight(value){const c=personaCasting(value);return c.playerControlled?1:({lead:4,core:3,support:2,unknown:2,guest:1}[c.role]);}
// Allocate supplemental memory rows, not story truth. Every represented person
// receives one before weighted extra slots; raw source and baseline are intact.
export function weightedPersonaMaterials(rows,profiles,limit=24){
  const casts=new Map(profiles.map(p=>[foldName(p.name),p.casting])),groups=new Map();
  for(const row of [...rows].sort((a,b)=>Math.max(...b.floors)-Math.max(...a.floors))){const key=foldName(row.name);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  const names=[...groups.keys()].sort((a,b)=>personaAttentionWeight(casts.get(b))-personaAttentionWeight(casts.get(a))),out=[];
  for(const key of names)out.push(groups.get(key).shift());
  const max=Math.max(limit,names.length);
  while(out.length<max&&names.some(key=>groups.get(key).length))for(const key of names)for(let n=0;n<personaAttentionWeight(casts.get(key))&&groups.get(key).length&&out.length<max;n++)out.push(groups.get(key).shift());
  return out;
}
export function editPersonaCasting(prior,patch){
  const next=personaCasting(prior);
  for(const key of ['gender','role','playerControlled'])if(Object.hasOwn(patch??{},key)){
    if(key==='gender'&&!Object.hasOwn(PERSONA_GENDERS,patch[key])||key==='role'&&!Object.hasOwn(PERSONA_ROLES,patch[key])||key==='playerControlled'&&typeof patch[key]!=='boolean')throw new Error('角色性别或定位不正确');
    next[key]=patch[key];next.manual[key]=true;
  }
  return next;
}
// User metadata is independent of a source-history checkpoint. Keep only
// explicit overrides, so rewinding prose does not rewind the user's choices.
export function rememberPersonaCasting(overrides,profile){
  const next={...overrides},casting=personaCasting(profile.casting),key=foldName(profile.name);
  if(Object.values(casting.manual).some(Boolean))next[key]=casting;else delete next[key];
  return next;
}
export function applyPersonaCasting(profile,overrides={}){
  const key=foldName(profile.name);if(!Object.hasOwn(overrides,key))return profile;
  const saved=personaCasting(overrides[key]),casting=personaCasting(profile.casting);
  for(const field of ['gender','role','playerControlled'])if(saved.manual[field]){casting[field]=saved[field];casting.manual[field]=true;}
  return {...profile,casting};
}
export function inferPersonaCasting(prior,spans=[],proposal,messages=[],name=''){
  const next=personaCasting(prior),text=spans.map(s=>s.text).join('\n');
  const sexes=[...text.matchAll(/(?:^|\n)\s*(?:[-*]\s*)?(?:性别|性別|gender|sex)\s*[:：]\s*(女(?:性)?|男(?:性)?|female|male|nonbinary)(?=\s|[。；;，,]|$)/gim)].map(m=>/^(女|female)/i.test(m[1])?'female':/^(男|male)/i.test(m[1])?'male':'nonbinary');
  if(!next.manual.gender&&new Set(sexes).size===1)next.gender=sexes[0];
  // Optional evidence-backed primary-model metadata costs no extra call.
  // Never infer gender/importance from a name, romance or frequency alone.
  const evidence=proposal?.evidence;
  if(evidence&&typeof evidence.quote==='string'&&foldName(evidence.quote).includes(foldName(name))&&messages.some(m=>m.index===evidence.floor&&m.text.includes(evidence.quote))){
    for(const key of ['gender','role','playerControlled'])if(!next.manual[key]){
      if(key==='gender'&&next.gender==='unknown'&&Object.hasOwn(PERSONA_GENDERS,proposal[key]))next[key]=proposal[key];
      if(key==='role'&&Object.hasOwn(PERSONA_ROLES,proposal[key]))next[key]=proposal[key];
      if(key==='playerControlled'&&proposal[key]===true&&/玩家|用户|用戶|player|\{\{user\}\}/i.test(evidence.quote))next[key]=true;
    }
  }
  return next;
}
export function personaCastingLabel(value){const c=personaCasting(value);return [c.role==='lead'&&['male','female'].includes(c.gender)?`${PERSONA_GENDERS[c.gender]}主角`:`${PERSONA_GENDERS[c.gender]} · ${PERSONA_ROLES[c.role]}`,c.playerControlled?'玩家扮演':''].filter(Boolean).join(' · ');}
