import { stableStringify } from './utils.js';
import { fieldLabel, sourceFloors } from './product-narrative.js';
import { dictionaryQuery } from './product-dictionary.js';

export const factValue = record => Object.hasOwn(record,'to')?record.to:Object.hasOwn(record,'value')?record.value:record.newValue;
export const factSubject = record => record.entity??record.entityId;
export const factKey = record => record.fieldKey??record.field??record.key;

// Older accepted records may name a person with a string, an explicit list or
// an {id,name} reference. Do not let an internal ID hide a supplied name.
export function explicitSubjectNames(value){
  if(Array.isArray(value))return value.flatMap(explicitSubjectNames);
  if(value&&typeof value==='object')return explicitSubjectNames(value.name??value.id);
  return typeof value==='string'&&value.trim()?[value.trim()]:[];
}
export function awarenessSubjects(record){
  return [...new Set([record.person,record.audience,record.actorId,record.personId].flatMap(explicitSubjectNames))];
}
export function awarenessSubjectLabel(record){
  const named=[record.person,record.audience].flatMap(explicitSubjectNames);
  return [...new Set(named.length?named:awarenessSubjects(record))].join('、');
}

// Owners are explicit record fields, never the names found in recalled events.
// Mentioning a person selects their reference dossier, not proof of presence.
export function characterRecordSubjects(card) {
  let names=[];
  if(card.category==='entityFactChanges')names=[factSubject(card)];
  else if(card.category==='personaChanges')names=[card.subject??card.person??card.entity];
  else if(card.category==='relationshipChanges')names=[card.from??card.subject,card.to??card.object];
  else if(card.category==='awarenessChanges')names=awarenessSubjects(card);
  else if(card.category==='performanceHints')names=[card.subject??card.person??card.entity,...(card.entities??[]).filter(e=>typeof e==='object'&&e.kind==='人物').map(e=>e.name)];
  // Explicitly stored subjects need not fit the search dictionary's 80-char
  // vocabulary rule. A configured “主角” is valid; bare pronouns aren't IDs.
  return [...new Set(names.flatMap(explicitSubjectNames).filter(n=>!/^(我|你|他|她|它|我们|你们|他们|她们|i|you|he|she|they)$/i.test(n)))];
}

/** Read-only projection. No per-person count/length limit, model call or schema
 * migration. Disabled/retracted cards must be removed by selectRecallCards.
 * Aliases select records but never merge the identities of their owners.
 */
export function fullCharacterGroups(cards,query,dictionary) {
  // Only an explicit non-person classification can remove a fact owner from
  // full-person injection. Untyped old/DIY owners keep the existing fallback;
  // a real person classification or person-specific record wins a conflict.
  // Objects remain ordinary retrievable facts, not discarded memories.
  const lower=s=>s.toLocaleLowerCase(),nonPeople=new Set(),people=new Set();
  for(const term of [...cards.flatMap(c=>c.entities??[]),...(dictionary.entries??[])]){
    if(typeof term?.name!=='string')continue;
    if(['地点','组织','物品'].includes(term.kind))nonPeople.add(lower(term.name));
    if(term.kind==='人物')people.add(lower(term.name));
  }
  for(const card of cards)if(card.category!=='entityFactChanges')for(const name of characterRecordSubjects(card))people.add(lower(name));
  const rows=cards.map(card=>({card,subjects:characterRecordSubjects(card).filter(name=>!nonPeople.has(lower(name))||people.has(lower(name)))})).filter(r=>r.subjects.length);
  const names=[...new Set(rows.flatMap(r=>r.subjects))];
  const entries=[...(dictionary.entries??[])];
  for(const name of names)if(!entries.some(e=>[e.name,...e.aliases].some(n=>lower(n)===lower(name))))entries.push({name,aliases:[],indexWords:[],kind:'人物',ambiguous:[]});
  // The retrieval query's expansion cap must not truncate a scene's roster.
  const matched=dictionaryQuery(query,{...dictionary,entries},{entityLimit:Infinity});
  const matchedNames=new Set(matched.entities.map(lower));
  const active=names.filter(name=>{
    const exact=entries.find(e=>lower(e.name)===lower(name));
    if(exact)return !exact.disabled&&matchedNames.has(lower(name));
    const owners=entries.filter(e=>!e.disabled&&e.aliases.some(a=>lower(a)===lower(name))&&!e.ambiguous.some(a=>lower(a)===lower(name)));
    return owners.length===1&&matchedNames.has(lower(owners[0].name));
  });
  const groups=active.map(subject=>({subject,records:[]})),byName=new Map(groups.map(g=>[g.subject,g]));
  for(const row of rows){const owner=row.subjects.find(n=>byName.has(n));if(owner)byName.get(owner).records.push(row.card);}
  return {groups:groups.filter(g=>g.records.length),people:active,matched};
}

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
  const signature=r=>stableStringify({entity:factSubject(r),field:factKey(r),fieldId:r.fieldId??null,value:factValue(r),
    temporal:r.temporal??null,validFrom:r.validFrom??null,validUntil:r.validUntil??null,
    epistemicStatus:r.epistemicStatus??null,context:r.context??null,scope:r.scope??null,
    from:r.from??r.oldValue??null,confirmed:r.confirmed??null,changeKind:r.changeKind??null,correctionOf:r.correctionOf??null,
    awareness:(r.awareness??[]).map(({id,sourceRefs,...row})=>row),eventRef:r.eventRef??null,eventRefs:r.eventRefs??[],
    customModuleId:r.customModuleId??null,viewpoints:r.viewpoints??[],keyDialogues:r.keyDialogues??[],followUps:r.followUps??[]});
  return signature(a)===signature(b);
}
