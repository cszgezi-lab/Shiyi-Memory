import {clone,sha256,makeId,estimateModelInputUnits,yieldLocalWork} from './utils.js';
import {summaryTransportOptions} from './summary-transport.js';
import {RETROSPECTIVE_STORE_KEY,planMemoryRetrospective,retrospectiveScanMessages,validateRetrospectiveScan,retrospectiveRequiredSourceIds,retrospectiveVerificationMessages,validateRetrospectiveReview,projectRetrospectiveRecords,retrospectiveData,retrospectiveRows} from './product-memory-retrospective.js';

const empty=()=>({version:1,runs:[],currentRunId:null});
const latest=s=>s?.runs?.find(r=>r.id===s.currentRunId);
const rows=retrospectiveRows;
const pairKey=d=>sha256([d.oldId,d.newId]);
const stamp=s=>sha256(retrospectiveData({records:rows(s.records),profiles:s.profiles,controls:s.controls,dictionary:s.dictionary,revision:s.revision}));
const canceled=e=>['CANCELED','CHAT_CHANGED','SOURCE_INVALIDATED'].includes(e?.code)||e?.name==='AbortError';
const invalid=message=>Object.assign(new Error(message),{code:'SOURCE_INVALIDATED'});
function assertSources(targets,sources){
  const found=new Map(sources.map(s=>[s.id,s]));
  for(const ref of targets.flatMap(r=>r.sourceRefs??[])){
    const source=found.get(ref.sourceId),current=source?.sourceRef??source;
    if(!source||(ref.version!==undefined&&ref.version!==current?.version)||(ref.hash!==undefined&&ref.hash!==current?.hash))throw invalid('候选来源版本或校验信息已变化，保留原记录');
  }
}
export function retrospectiveEntries(saved){return (saved?.runs??[]).filter(r=>!r.undone).flatMap(r=>r.entries??[]);}
export function retrospectiveState(saved,snapshot){
  const r=latest(saved);if(!r)return {status:'idle',scanned:0,total:0,repaired:0,unresolved:0,message:'',canUndo:false};
  const entries=r.undone?[]:r.entries??[];
  const projected=snapshot?new Map(rows(projectRetrospectiveRecords(snapshot.records,retrospectiveEntries(saved),snapshot.controls,{dictionary:snapshot.dictionary})).map(x=>[x.id,x])):null;
  const links=entries.flatMap(e=>e.links??[]);
  const repairs=projected?links.filter(d=>projected.get(d.oldId)?.stateHistorical&&projected.get(d.newId)?.[d.field]===d.oldId):r.undone?[]:r.repairs??[];
  const suppressed=projected?links.filter(d=>!repairs.includes(d)).map(d=>({kind:'uncertain',recordIds:[d.oldId,d.newId],description:'接续存在分歧或依据已变化，本项未应用；原记录保留'})):r.undone?[]:r.suppressed??[];
  const issues=[...(r.scanRejected??[]).map(x=>({kind:'uncertain',description:x.reason,recordIds:[]})),...suppressed,...entries.flatMap(e=>[...(e.issues??[]).filter(i=>i.kind==='uncertain'),...(e.rejected??[]).map(x=>({kind:'uncertain',description:x.reason,recordIds:[x.oldId,x.newId].filter(Boolean)}))])];
  const repaired=r.undone?0:projected?new Set(repairs.map(d=>d.oldId)).size:r.repaired??0;
  return {status:r.status==='running'?'paused':r.status,scanned:r.scanned??0,total:r.total??0,repaired,unresolved:issues.length,message:r.message??'',canUndo:!r.undone&&entries.some(e=>e.links?.length),repairs,issues,suppressed,coverage:r.coverage};
}

/** Manual, resumable audit of stored information. The only raw-source reader
 * receives a proposed pair after the saved-record scan has completed. */
export async function runMemoryRetrospective({workspace,snapshot,client,settings,readSources,check=()=>{},signal,onChange=()=>{},parseResponse=r=>r}){
  const guard=()=>{if(signal?.aborted)throw Object.assign(new Error('复盘已暂停'),{code:'CANCELED'});check();};
  guard();const initial=await snapshot();guard();
  let saved=await workspace.read(RETROSPECTIVE_STORE_KEY,empty());guard();
  const baseline=stamp(initial),modelStamp=sha256({model:client.profile.model,url:client.profile.url??client.profile.endpoint,settings:{inputBudgetUnits:settings.inputBudgetUnits,outputBudgetUnits:settings.outputBudgetUnits,summaryRequestMode:settings.summaryRequestMode,summaryStreaming:settings.summaryStreaming}});
  let run=latest(saved);
  if(!run||run.undone||run.status==='completed'||run.baseline!==baseline||run.modelStamp!==modelStamp){
    const records=projectRetrospectiveRecords(initial.records,retrospectiveEntries(saved),initial.controls,{dictionary:initial.dictionary});
    const limit=Number(settings.inputBudgetUnits)||60000;
    const plan=planMemoryRetrospective(records,initial.profiles,{maxChars:Math.max(8000,Math.floor(limit-512))});
    run={id:makeId('retrospective'),baseline,modelStamp,plan,total:plan.recordCount+plan.personaCount,scanned:0,status:'running',scans:{},verifications:{},entries:[],scanRejected:[],coverage:plan.coverage,at:Date.now(),message:'正在检查已保存的信息'};
    saved={...saved,runs:[...(saved.runs??[]),run],currentRunId:run.id};
  }else run.status='running';
  const notify=()=>onChange({...retrospectiveState(saved,initial),status:run.status});
  const persist=async()=>{const view=retrospectiveState(saved,initial);run.repaired=view.repaired;run.repairs=view.repairs;run.suppressed=view.suppressed;await workspace.write(RETROSPECTIVE_STORE_KEY,saved);notify();};
  const current=async()=>{guard();const now=await snapshot();guard();if(stamp(now)!==baseline)throw invalid('复盘期间记录、人物或人工设置已变化；已保存结果受来源保护，请重新复盘');return now;};
  await persist();
  async function request(bucket,key,messages){
    const payload={model:client.profile.model,messages,...summaryTransportOptions(settings),...(settings.outputBudgetUnits>0?{max_tokens:settings.outputBudgetUnits}:{})};
    const inputUnits=estimateModelInputUnits(payload),inputLimit=Number(settings.inputBudgetUnits)||60000;
    if(inputUnits>inputLimit)throw Object.assign(new Error('完整复盘材料超过当前输入预算，未发送；请调整输入预算后继续'),{code:'RETROSPECTIVE_BUDGET',details:{reason:'retrospective_input_budget',stage:'prepare',inputUnits,inputLimit,modelRequested:false}});
    const requestHash=sha256(payload);let cached=bucket[key];
    if(cached?.requestHash!==requestHash||cached?.invalid)cached=null;
    if(!cached){
      guard();const response=await client.chatCompletions(payload,{signal,timeoutMs:settings.summaryDeadlineMs??settings.deadlineMs});
      // Save the returned answer before parsing or checking cancellation. A
      // completed paid stage must survive parse/validation failures and resume.
      const attempts=[...(bucket[key]?.attempts??[])];if(bucket[key]?.response)attempts.push({response:bucket[key].response,error:bucket[key].error});
      cached=bucket[key]={requestHash,response:clone(response),attempts,at:Date.now()};await persist();
    }
    guard();try{return parseResponse(cached.response);}catch(e){cached.invalid=e instanceof SyntaxError||['SUMMARY_RESPONSE_ERROR','MODEL_OUTPUT_BLOCKED','MODEL_OUTPUT_TRUNCATED'].includes(e.code);cached.error=e.message;await persist();throw e;}
  }
  try{
    for(const part of run.plan.requests){
      await yieldLocalWork();guard();if(run.scans[part.id]?.result)continue;
      run.message=`检查已保存信息 ${run.scanned}/${run.total}`;notify();
      const result=await request(run.scans,part.id,retrospectiveScanMessages(run.plan,part));
      try{run.scans[part.id].result=validateRetrospectiveScan(run.plan,part,result);}
      catch(e){run.scans[part.id].invalid=true;run.scans[part.id].error=e.message;await persist();throw e;}
      run.scanned=run.plan.requests.filter(p=>run.scans[p.id]?.result).reduce((n,p)=>n+p.refs.length,0);await persist();
    }
    const decisions=new Map();run.scanRejected=[];
    for(const scan of Object.values(run.scans)){
      run.scanRejected.push(...(scan.result?.rejected??[]));
      for(const d of scan.result?.decisions??[]){const key=pairKey(d);if(!decisions.has(key))decisions.set(key,d);}
    }
    await persist();const byId=new Map(rows(initial.records).map(r=>[r.id,r]));
    for(const [key,d]of decisions){
      await yieldLocalWork();guard();if(run.verifications[key]?.done)continue;
      await current();const targets=[d.oldId,d.newId].map(id=>byId.get(id)).filter(Boolean);
      const required=retrospectiveRequiredSourceIds(initial.records,[d]);let sources=[],output;
      run.message='正在核查发现的状态冲突';notify();
      if(['coexist','uncertain'].includes(d.kind))output={decisions:[d]};
      else if(required.unavailable.length)output={decisions:[{...d,kind:'uncertain',reason:required.unavailable[0].reason}]};
      else{
        sources=await readSources(targets);guard();
        const missing=required.sourceIds.some(id=>!sources.some(s=>s.id===id));
        if(missing)throw invalid('候选的引用原文未完整读取，保留原记录');
        assertSources(targets,sources);
        output=await request(run.verifications,key,retrospectiveVerificationMessages(initial.records,[d],sources));
      }
      let entry;try{entry=validateRetrospectiveReview(initial.records,[d],sources,output,{dictionary:initial.dictionary,edits:initial.controls?.edits});}
      catch(e){if(run.verifications[key]){run.verifications[key].invalid=true;run.verifications[key].error=e.message;}await persist();throw e;}
      if(entry.links.length){const fresh=await readSources(targets);guard();assertSources(targets,fresh);if(sha256(fresh)!==sha256(sources))throw invalid('核查期间引用原文变化，结果未应用');}
      await current();run.entries.push(entry);run.verifications[key]={...run.verifications[key],done:true};await persist();
    }
    await current();run.status='completed';run.message=run.coverage.crossChunkCompleteCatalog?'复盘完成；旧记录和人物历史保留':'复盘完成；跨分块按相关目录检查，部分目录超出预算';await persist();return saved;
  }catch(e){
    run.status=canceled(e)?'paused':'failed';run.message=e.message;
    // On a chat switch the old workspace intentionally refuses writes. Never
    // redirect this checkpoint to the newly selected chat.
    try{await persist();}catch{/* Last durable checkpoint remains resumable. */}
    throw e;
  }
}

export async function undoMemoryRetrospective({workspace,check=()=>{}}){
  check();return workspace.update(RETROSPECTIVE_STORE_KEY,saved=>{check();const run=latest(saved);if(run&&!run.undone){run.undone=true;run.status='completed';run.message='已撤销本次复盘修复；旧记录和检查结果保留';}return saved;},empty());
}
