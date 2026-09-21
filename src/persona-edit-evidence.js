import {clone,sha256} from './utils.js';
import {foldName} from './persona-identity.js';

const unsafe=/\[\[SHIYI_PERSONA:|<%|%>|<\/?script\b|\{\{|@@/i;
export const PERSONA_EDIT_RULE=`局部更新合同：原人物只做有据的最小演进，不重写人格。original.parts中editable=false的是原书引语/口吻范例，不是本聊天已说过的话，不改写或拼接成新台词；新实说只放examples。其它updates每项附before（该ref当前完整文字）、evidence:{floor,quote}（本人物本批连续原文依据），保留对象、否定、条件和未变细节。只提供楼号不是修改依据。
previous.noteParts按previous.text的空行段落顺序给出ref与paragraph（1起算），只读一次正文，不重复发送。已有补充时返回noteUpdates:[{ref:"N1",before:"该段当前原文",text:"仅修改必要部分后的完整段落",evidence:{floor,quote}}]；未列出的段落由程序保留。确有新的、此前没有的信息时ref="new"、before=""；不要逐批加事件日记，也不要重复现有段落。无变更返回noteUpdates:[]。不允许空文字删除段落；过时态度应在对应段落改为明确的当前适用范围。已有noteParts时text不再用于重写整份补充，可返回空字符串；首次建档仍用text提供可靠概况。evidence须包含本人物的明确归属，语料不得编写、改字或移花接木。语义不确定的修改会留作候选，不会因为请求成功就自动作为当前人设；不要为了通过核对捏造弧光。`;

export function personaNoteParts(profile){
  // A legacy source-free dossier is already supplied as editable chat B-parts.
  if(profile&&!profile.composition&&!profile.bindings?.length)return [];
  let text=String(profile?.composition?.notes??(!profile?.composition?profile?.text:'')??'');
  const baseline=(profile?.composition?.parts??[]).filter(p=>p.source==='chat');
  const carried=baseline.length?baseline:profile?.composition?.sourceBaseline??[];
  if(carried.length){
    const exact=new Set(carried.flatMap(p=>[p.original,p.text]).filter(t=>typeof t==='string'&&t.trim().length>=4).map(t=>t.trim()));
    text=text.split(/\n\s*\n/u).map(block=>block.split(/(?<=[。！？])|\n/u).filter(t=>!exact.has(t.trim())).join('')).filter(t=>t.trim()).join('\n\n');
  }
  // Paragraph boundaries are atomic: don't split conditions or quoted speech.
  return text.split(/\n\s*\n/u).filter(s=>s.trim()).map((text,i)=>({ref:`N${i+1}`,text,key:sha256(text).slice(0,24)}));
}

export function personaEditEvidence(value,{messages,identity,name,speech}){
  if(!value||!Number.isSafeInteger(value.floor)||typeof value.quote!=='string'||!value.quote.trim()||value.quote.length>2400||unsafe.test(value.quote))return null;
  const m=messages.find(m=>m.index===value.floor);
  if(!m||!m.text.includes(value.quote))return null;
  if(!identity.mentions(value.quote).some(p=>p.key===foldName(name))&&!speech?.(m.text,value.quote,name,identity))return null;
  return {floor:value.floor,quote:value.quote};
}

export function mergePersonaNotes(row,previous,context){
  const parts=personaNoteParts(previous),old=parts.map(p=>p.text).join('\n\n'),pending=[];
  if(row.noteUpdates===undefined){
    const text=String(row.text??'').trim();
    if(text===old||!previous)return {notes:text,changes:[],pending};
    // Keeping old paragraphs does not justify silently appending a conflicting
    // state. Changed snapshots use the same evidence-bearing delta contract.
    return {notes:old,changes:[],pending:[{kind:'notes',reason:'missing_note_updates',text,sourceFloors:clone(row.sourceFloors??[])}]};
  }
  if(!Array.isArray(row.noteUpdates)||row.noteUpdates.length>24)return {notes:old||(!previous?String(row.text??'').trim():''),changes:[],pending:[{kind:'notes',reason:'invalid_note_updates'}]};
  const next=parts.map(p=>({...p})),changes=[],seen=new Set(),duplicates=new Set();
  for(const edit of row.noteUpdates)if(edit?.ref!=='new'){if(seen.has(edit?.ref))duplicates.add(edit?.ref);seen.add(edit?.ref);}
  for(const edit of row.noteUpdates){
    const part=parts.find(p=>p.ref===edit?.ref),fresh=edit?.ref==='new';
    const evidence=personaEditEvidence(edit?.evidence,context);
    const reason=(!fresh&&!part)?'unknown_note_ref':duplicates.has(edit?.ref)?'duplicate_note_ref':typeof edit?.text!=='string'||!edit.text.trim()||unsafe.test(edit.text)?'invalid_note_text':edit.before!==(fresh?'':part.text)?'note_before_mismatch':!evidence?'missing_note_evidence':null;
    if(reason){pending.push({kind:'notes',reason,...(typeof edit?.ref==='string'?{ref:edit.ref}:{}),...(typeof edit?.text==='string'&&!unsafe.test(edit.text)?{text:edit.text}:{}),...(evidence?{evidence}:{})});continue;}
    const text=edit.text.trim();
    if(fresh){if(!next.some(p=>p.text.trim()===text))next.push({text});}
    else next.find(p=>p.ref===part.ref).text=text;
    changes.push({ref:edit.ref,before:part?.text??'',after:text,evidence});
  }
  return {notes:next.length?next.map(p=>p.text).join('\n\n'):old||(!previous?String(row.text??'').trim():''),changes,pending};
}

// Mark every piece of one source quotation as protected without renumbering
// legacy B-refs/keys. Source strings and saved revisions remain byte-preserved.
export function markPersonaQuoteParts(parts){
  const groups=new Map();
  for(const part of parts){const key=JSON.stringify([part.book,part.uid,part.spanId]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(part);}
  const protectedKeys=new Set();
  for(const group of groups.values()){
    const text=group.map(p=>p.original??p.text??'').join(''),ranges=[];
    const pairs=new Map([['“','”'],['「','」'],['『','』'],['"','"']]);let start=-1,stack=[];
    for(let i=0;i<text.length;i++){
      const c=text[i];if(stack.length&&c===stack.at(-1)){stack.pop();if(!stack.length){ranges.push([start,i+1]);start=-1;}}
      else if(pairs.has(c)){if(!stack.length)start=i;stack.push(pairs.get(c));}
    }
    if(start>=0)ranges.push([start,text.length]);
    let at=0;for(const p of group){const end=at+String(p.original??p.text??'').length;if(ranges.some(([a,b])=>at<b&&end>a))protectedKeys.add(p);at=end;}
  }
  return parts.map(p=>({...p,sourceQuote:protectedKeys.has(p)}));
}
