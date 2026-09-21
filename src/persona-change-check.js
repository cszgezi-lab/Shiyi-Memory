export const PERSONA_CHANGE_CHECK_RULE='每份人物附changeCheck:{status:"changed|unchanged|uncertain",evidence:[{floor,quote}],conflictRefs:["B1"],expressionChanged:boolean}。先判断本批是否改变其后续选择、边界、目标、自我认知或对特定对象的表达，而不是只复述事件。人物权重只决定补充材料份额和检查顺序，低权重的重大变化不能漏。changed须在development落下有据转折；原书冲突逐个列conflictRefs并用updates局部改写，仅改变对应对象/情境的过时规则，保留稳定细节；expressionChanged且有可归属台词时放入examples。无冲突用空列表，不编造冲突或台词。unchanged须有完整本人物原句依据说明本批确已检查，不能以缺字段表示没变化；不确定用uncertain，不强造转折。';
export function personaChangeCheck(row,{parts,changes,development,examples,messages,identity,name}){
  const value=row.changeCheck,issues=[];
  if(!value||!['changed','unchanged','uncertain'].includes(value.status))return {status:'unreviewed',issues:['未返回变化核对'],floors:row.sourceFloors};
  const evidence=Array.isArray(value.evidence)?value.evidence.filter(e=>typeof e?.quote==='string'&&e.quote.length>=4&&e.quote.length<=600&&messages.some(m=>m.index===e.floor&&m.text.includes(e.quote))&&identity.mentions(e.quote).some(p=>p.name===name)):[];
  if(!evidence.length)issues.push('缺少可定位的本人物核对依据');
  const refs=Array.isArray(value.conflictRefs)?value.conflictRefs:null;
  if(!refs||refs.some(ref=>!parts.some(p=>p.ref===ref)))issues.push('冲突片段范围未确认');
  const keys=new Set(changes.map(c=>c.key));
  if(refs?.some(ref=>{const p=parts.find(p=>p.ref===ref);return p&&!keys.has(p.key);}))issues.push('声明的旧设定冲突尚未逐项修改');
  if(value.status==='changed'&&!development.some(d=>evidence.some(e=>e.floor===d.floor)))issues.push('有变化声明但缺少已接受的转折记录');
  if(value.expressionChanged===true&&!examples.some(q=>evidence.some(e=>e.floor===q.floor)))issues.push('表达变化缺少本批已接受语料');
  if(value.status==='unchanged'&&(refs?.length||changes.length))issues.push('无变化声明与修改冲突');
  return {status:issues.length||value.status==='uncertain'?'pending':value.status,evidence,issues,floors:row.sourceFloors};
}
