export const PERSONA_CHANGE_CHECK_RULE='每份人物附changeCheck:{status:"changed|unchanged|uncertain",evidence:[{floor,quote}],conflictRefs:["B1"],expressionChanged:boolean}。先判断本批是否改变其后续选择、边界、目标、自我认知或对特定对象的表达，而不是只复述事件。人物权重只决定补充材料份额和检查顺序，低权重的重大变化不能漏。首次建档或补充基础概况本身不是人物转折：没有转折时用unchanged与expressionChanged:false，仍可建立有据概况，不为填字段编造成长。changed须在development落下有据转折；原书冲突逐个列conflictRefs并用updates局部改写，仅改变对应对象/情境的过时规则，保留稳定细节；expressionChanged且有可归属台词时放入examples。变化说明与同一对象的真实台词可以分处本批不同楼，分别填写各自实际楼号，不能为了同楼改写引用。无冲突用空列表，不编造冲突或台词。unchanged不新增或改写development；既有弧光由程序保留，约定完成等客观状态可局部更新，不为这些事项编造性格改变。unchanged须有完整本人物原句依据说明本批确已检查，不能以缺字段表示没变化；不确定用uncertain，不强造转折。';
import {hasPersonaSourceSpeech} from './persona-speech-evidence.js';

// Last fully reviewed prefix, not a semantic correctness certificate. A new
// pending candidate does not revoke the earlier applied review. Never infer
// a prefix from an old pending dossier without this persisted boundary.
export function personaReviewedThrough(profile){
  if(!profile||!Number.isInteger(profile.through)||profile.through<0)return undefined;
  const status=profile.composition?.changeCheck?.status;
  if(['changed','unchanged'].includes(status))return profile.through;
  const saved=profile.composition?.reviewedThrough;
  return Number.isInteger(saved)&&saved>=0&&saved<=profile.through?saved:undefined;
}
export function personaChangeCheck(row,{parts,changes,development,previousDevelopment=[],examples,messages,identity,name}){
  const value=row.changeCheck,issues=[];
  if(!value||!['changed','unchanged','uncertain'].includes(value.status))return {status:'unreviewed',issues:['未返回变化核对'],floors:row.sourceFloors};
  const evidence=Array.isArray(value.evidence)?value.evidence.filter(e=>typeof e?.quote==='string'&&e.quote.length>=4&&e.quote.length<=600&&messages.some(m=>m.index===e.floor&&m.text.includes(e.quote))&&identity.mentions(e.quote).some(p=>p.name===name)):[];
  if(!evidence.length)issues.push('缺少可定位的本人物核对依据');
  const refs=Array.isArray(value.conflictRefs)?value.conflictRefs:null;
  if(!refs||refs.some(ref=>!parts.some(p=>p.ref===ref)))issues.push('冲突片段范围未确认');
  const keys=new Set(changes.map(c=>c.key));
  if(refs?.some(ref=>{const p=parts.find(p=>p.ref===ref);return p&&!keys.has(p.key);}))issues.push('声明的旧设定冲突尚未逐项修改');
  // Explanatory narration and the character's actual utterance often occupy
  // different turns. Both must be accepted current-batch evidence, but they
  // need not share a floor. A cross-floor link needs the same explicit target;
  // old archives, another addressee and invented speech cannot satisfy it.
  const canonical=label=>identity.resolve?.(String(label??''))?.key??String(label??'').trim();
  const currentArcs=development.filter(d=>typeof d.evidence==='string'&&messages.some(m=>m.index===d.floor&&m.text.includes(d.evidence)));
  const checkedArcs=currentArcs.filter(d=>evidence.some(e=>{
    const people=identity.mentions(e.quote);
    // A whole-person review sentence need not repeat every addressee. The arc
    // still has independent, exact, same-actor evidence in this batch. A review
    // naming another target cannot certify this one by that fallback.
    return e.floor===d.floor||d.target&&people.some(p=>p.key===canonical(d.target))||
      people.length>0&&people.every(p=>p.key===canonical(name));
  }));
  if(value.status==='changed'&&!checkedArcs.length)issues.push('有变化声明但缺少已接受的转折记录');
  // "No character change" may update an appointment, but cannot silently
  // replace the accepted character arc with a new interpretation of chores.
  // Unchanged carried-forward arcs are allowed; evidence refresh alone is not
  // a semantic change. The normal pending path retains the applied revision.
  if(value.status==='unchanged'&&development.some(d=>{
    const old=previousDevelopment.find(p=>p.key===d.key);
    return !old||['topic','target','scope','after','cause'].some(k=>(d[k]??'')!==(old[k]??''));
  }))issues.push('无变化声明却新增或改写人物弧光');
  const freshSpeech=examples.filter(q=>q.kind==='source_quote'&&messages.some(m=>m.index===q.floor&&typeof q.text==='string'&&q.text.trim()&&m.text.includes(q.text)));
  const expressionCovered=freshSpeech.some(q=>evidence.some(e=>e.floor===q.floor)||q.to&&(checkedArcs.some(d=>d.target&&canonical(d.target)===canonical(q.to))||value.status==='unchanged'&&evidence.some(e=>identity.mentions(e.quote).some(p=>p.key===canonical(q.to)))));
  const expressionChanged=value.expressionChanged===true,warnings=[];
  let expressionCoverage;
  if(expressionChanged){
    if(expressionCovered)expressionCoverage={status:'covered'};
    else {
      const available=messages.some(m=>hasPersonaSourceSpeech(m.text,name,identity));
      // Only absence is optional here. A supplied but unaccepted quotation
      // must not obtain the fallback for an empty examples list. Existing
      // speaker, range, source, arc and baseline-edit guards remain intact.
      const offered=row.examples!=null&&(!Array.isArray(row.examples)||row.examples.length>0);
      if(!available&&!offered){
        expressionCoverage={status:'unavailable',reason:'no_verified_source_speech'};
        warnings.push('本批未检测到可核验的本人原话；未编造语料，有据变化按独立校验处理');
      }else {
        expressionCoverage={status:'missing',reason:available?'available_speech_not_covered':'offered_examples_not_accepted'};
        issues.push('表达变化缺少本批已接受语料');
      }
    }
  }
  // A fulfilled appointment can update a chat-authored state without a new
  // personality/relationship arc. This does not excuse a declared conflict or
  // a source-book characterization change; exact B-edit evidence still applies.
  if(value.status==='unchanged'&&(refs?.length||changes.some(c=>parts.find(p=>p.key===c.key)?.source!=='chat')))issues.push('无变化声明与修改冲突');
  return {status:issues.length||value.status==='uncertain'?'pending':value.status,evidence,issues,floors:row.sourceFloors,...(expressionChanged?{expressionChanged:true,expressionCoverage,...(warnings.length?{warnings}:{})}:{})};
}
