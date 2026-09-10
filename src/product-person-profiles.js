import { stableStringify } from './utils.js';
import { fieldLabel, sourceFloors } from './product-narrative.js';

export const factValue = record => Object.hasOwn(record,'to')?record.to:Object.hasOwn(record,'value')?record.value:record.newValue;
export const factSubject = record => record.entity??record.entityId;
export const factKey = record => record.field??record.key;

// A read-only presentation, not a new persistent schema. Arbitrary user/model
// attributes remain first-class. Search aliases are not identity authority.
export function characterProfiles(cards=[]) {
  const profiles=new Map();
  for(const card of cards){
    const subject=factSubject(card),key=factKey(card);
    if(card.category!=='entityFactChanges'||card.customModuleId||typeof subject!=='string'||!subject.trim()||typeof key!=='string')continue;
    if(!profiles.has(subject))profiles.set(subject,{id:`profile:${subject}`,subject,fields:[],records:[]});
    const profile=profiles.get(subject);profile.records.push(card);
    let field=profile.fields.find(f=>f.key===key);
    if(!field){field={key,label:card.fieldLabel??fieldLabel(key),versions:[]};profile.fields.push(field);}
    // Identical values share one visible paragraph, with every evidence row
    // available underneath. A -> B -> A and knowledge differences aren't lost.
    const value=factValue(card),signature=stableStringify(value);
    let version=field.versions.find(v=>v.signature===signature);
    if(!version){version={value,signature,records:[]};field.versions.push(version);}
    version.records.push(card);
  }
  for(const profile of profiles.values())for(const field of profile.fields){
    const latest=version=>Math.max(-1,...version.records.flatMap(sourceFloors));
    field.versions.sort((a,b)=>latest(b)-latest(a));
  }
  return [...profiles.values()];
}

// Only identical fact payload AND guards may be omitted from a recall packet.
// Different dates, belief holders, values or scoped custom modules stay distinct.
export function sameFactForRecall(a,b){
  if(a.category!=='entityFactChanges'||b.category!=='entityFactChanges'||!factSubject(a)||!factKey(a))return false;
  const signature=r=>stableStringify({entity:factSubject(r),field:factKey(r),value:factValue(r),
    temporal:r.temporal??null,validFrom:r.validFrom??null,validUntil:r.validUntil??null,
    epistemicStatus:r.epistemicStatus??null,context:r.context??null,scope:r.scope??null,
    from:r.from??r.oldValue??null,confirmed:r.confirmed??null,changeKind:r.changeKind??null,correctionOf:r.correctionOf??null,
    awareness:(r.awareness??[]).map(({id,sourceRefs,...row})=>row),eventRef:r.eventRef??null,eventRefs:r.eventRefs??[],
    customModuleId:r.customModuleId??null,viewpoints:r.viewpoints??[],keyDialogues:r.keyDialogues??[],followUps:r.followUps??[]});
  return signature(a)===signature(b);
}
