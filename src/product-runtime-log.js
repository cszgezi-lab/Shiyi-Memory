import { clone, stableStringify } from './utils.js';
import { productStoreFromSession } from './product-host-adapters.js';
import { PRODUCT_VERSION } from './product-release.js';
import { safeValidationIssues } from './validation-diagnostics.js';
import { safeDiagnosticFields, errorDiagnostics } from './diagnostics.js';

export const RUNTIME_LOG_ADDRESS = Object.freeze({ namespace: 'shiyi-product-diagnostics', key: 'runtime-v1' });
export const RUNTIME_LOG_LIMIT = 2000;
export const RUNTIME_LOG_BYTES = 2 * 1024 * 1024;
export const LOG_TASKS = Object.freeze({ quality:'内容校对',operation:'插件操作',transport:'API 请求',background:'后台任务',storage:'存档', 'knowledge-vectors':'知识库向量',summary:'总结', merge:'事件合并', connection:'连接测试', models:'拉取模型', assistant:'配置助手', knowledge:'知识库分析', vectors:'建立向量索引', import:'导入文件', recall:'召回预览' });
export const LOG_PHASES = Object.freeze({ retry_wait:'等待并重试临时错误',recovery_compact:'失败后压缩可选上下文',response_saved:'模型结果已暂存',resume_response:'复用已返回结果',resume_commit:'确认上次已提交',checkpoint_warning:'进度记录待恢复',partial_repair:'补齐缺失内容',start:'任务开始', vector_storage_failed:'向量本机保存失败', vector_failed:'向量请求失败', vector_split:'拆小向量批次重试', vector_commit:'保存向量检查点', range:'读取楼层', request:'发送模型请求', response:'收到模型响应', merge_deferred:'总结先保存，合并单独处理', merge_accepted:'确认同一次事件', merge_separate:'暂不合并', normalize:'兼容模型字段', repair_request:'正在自动纠正字段', repair_response:'收到字段纠错结果', repair_complete:'字段纠错通过', repair_failed:'字段纠错未通过', repair_skipped:'跳过字段纠错', floors:'检查逐楼摘要', validate:'校验记忆内容', commit:'保存记忆', complete:'任务完成', failed:'任务失败', canceled:'任务停止' });
const CODES = new Set(['RECOVERY_LIMIT','RESUME_UNAVAILABLE','VECTOR_RESPONSE_COUNT','VECTOR_RESPONSE_INDEX','VECTOR_RESPONSE_INVALID','VECTOR_DIMENSION_MISMATCH','VECTOR_INPUT_EMPTY','VECTOR_INPUT_TOO_LARGE','VECTOR_INDEX_INCOMPLETE','OPERATION_FAILED','MERGE_RESPONSE_INVALID','FLOOR_SUMMARY_MISSING','MODEL_OUTPUT_TRUNCATED','MODEL_OUTPUT_BLOCKED','INPUT_BUDGET_EXCEEDED','COVERAGE_INCOMPLETE','SUMMARY_RESPONSE_ERROR','SUMMARY_RESPONSE_INVALID','VALIDATION_ERROR','PROVIDER_HTTP_ERROR','PROVIDER_REQUEST_FAILED','PROVIDER_PROFILE_INVALID','MODEL_UNAVAILABLE','TIMEOUT','CANCELED','CHAT_REF_UNAVAILABLE','CHAT_HANDLE_UNAVAILABLE','CHAT_IDENTITY_NOT_READY','HISTORY_UNAVAILABLE','CHAT_CHANGED','SOURCE_INVALIDATED','SCOPE_CONFLICT','REVISION_CONFLICT','PERSISTENCE_ERROR','PERSISTENCE_UNAVAILABLE','HOST_CONTRACT_INVALID','network.timeout','network.connect_failed','network.proxy_failed','network.dns_failed','network.tls_failed','network.body_interrupted','network.request_failed']);
const FINISH_REASONS = new Set(['stop','length','max_tokens','truncated','abort','content_filter','tool_calls','end_turn','unknown']);
CODES.add('QUALITY_RESPONSE_INVALID');
const NUMBERS = ['retryDelayMs','recoveryCalls','batchNumber','childIndex','startIndex','endIndex','sourceCount','inputLimit','inputUnits','maxTokens','elapsedMs','status','expected','received','covered','invalidRows','duplicateCount','promptTokens','completionTokens','totalTokens','reasoningTokens','responseChars','savedBatches','normalizedFields','defaultedValidityFields','repairFields','requestNumber','requestItems','receivedVectors','inputChars','longestInputChars','vectorDimensions','indexedItems','pendingItems','failedItems','beforeInputUnits','afterInputUnits','removedRelevantRecords','recoveryInputTarget','requestedMaxTokens','effectiveMaxTokens','relevantCandidateCount'];
export function safeLogDetails(value = {}) {
  const result = safeDiagnosticFields(value);
  const issues=safeValidationIssues(value?.validationIssues);
  if(issues.length)result.validationIssues=issues;
  if(Number.isSafeInteger(value?.validationIssueCount)&&value.validationIssueCount>issues.length)result.validationIssuesOmitted=value.validationIssueCount-issues.length;
  if(Number.isSafeInteger(value?.validationIssueCount)&&value.validationIssueCount>=0)result.validationIssueCount=value.validationIssueCount;
  for (const key of NUMBERS) if (Number.isSafeInteger(value?.[key]) && value[key] >= 0) result[key] = value[key];
  for (const key of ['missingFloors','duplicateFloors','emptyFloors']) if (Array.isArray(value?.[key])) result[key] = [...new Set(value[key].filter(n => Number.isSafeInteger(n) && n >= 0))].slice(0,200);
  if (value?.finishReason !== undefined) result.finishReason = FINISH_REASONS.has(value.finishReason) ? value.finishReason : 'unknown';
  if (typeof value?.truncated === 'boolean') result.truncated = value.truncated;
  if (typeof value?.repairAttempted === 'boolean') result.repairAttempted = value.repairAttempted;
  if (value?.code !== undefined) result.code = CODES.has(value.code) ? value.code : 'OPERATION_FAILED';
  if (['summary','assistant','embedding','rerank'].includes(value?.modelRole)) result.modelRole = value.modelRole;
  if (['tt_native','browser_direct'].includes(value?.transport)) result.transport=value.transport;
  if (['write','read','readback','compare','decode','unknown'].includes(value?.storageStage)) result.storageStage=value.storageStage;
  if (['vector_jobs','vector_index','vector_staging','runtime_log','workspace','memory','checkpoint','batch-recovery','response-cache','credentials','settings'].includes(value?.storageArtifact)) result.storageArtifact=value.storageArtifact;
  return result;
}
function safeEntry(value) {
  if (!Object.hasOwn(LOG_TASKS,value?.task) || !Object.hasOwn(LOG_PHASES,value?.phase)) return null;
  if (![value.id,value.run,value.at].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  return { id:value.id, run:value.run, at:value.at, pluginVersion:/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value.pluginVersion)?value.pluginVersion:null, task:value.task, phase:value.phase, level:['info','success','warning','error'].includes(value.level)?value.level:'info', details:safeLogDetails(value.details) };
}

/** Local bounded diagnostics. Never accepts prompts, response bodies, keys or URLs. */
export function createRuntimeLog({getStore,onChange=()=>{},now=()=>Date.now()} = {}) {
  let entries=[],store,loaded=false,loading,queue=Promise.resolve(),nextRun=0,nextId=0,persistence='not_loaded';
  let pending=false,writing=false,droppedEntries=0,partialRuns=[],storageFailure=null,legacyRetentionUnknown=false;
  const notify=()=>{try{onChange();}catch{/* diagnostics must not break a task */}};
  function trim(){
    const removed=[];
    if(entries.length>RUNTIME_LOG_LIMIT)removed.push(...entries.splice(0,entries.length-RUNTIME_LOG_LIMIT));
    while(entries.length&&new TextEncoder().encode(JSON.stringify(entries)).length>RUNTIME_LOG_BYTES)removed.push(...entries.splice(0,Math.max(1,Math.ceil(entries.length/10))));
    droppedEntries+=removed.length;
    const retained=new Set(entries.map(e=>e.run));partialRuns=[...new Set([...partialRuns,...removed.map(e=>e.run)])].filter(r=>retained.has(r));
  }
  async function load() {
    if(loaded)return;
    if(loading)return loading;
    loading=(async()=>{
      try {
        store=productStoreFromSession({store:await getStore()});
        const found=await store.tryGetJson(RUNTIME_LOG_ADDRESS);
        if(found.found){
          if(found.value?.version!==1||!Array.isArray(found.value.entries))throw Object.assign(new Error('invalid log document'),{details:{reason:'log_document_invalid'}});
          entries=found.value.entries.map(safeEntry).filter(Boolean);
          droppedEntries=Number.isSafeInteger(found.value.droppedEntries)?Math.max(0,found.value.droppedEntries):0;
          droppedEntries+=found.value.entries.length-entries.length;
          legacyRetentionUnknown=found.value.diagnosticVersion!==2||found.value.legacyRetentionUnknown===true;
          partialRuns=Array.isArray(found.value.partialRuns)?found.value.partialRuns.filter(Number.isSafeInteger):[];trim();
          nextRun=Math.max(0,...entries.map(e=>e.run));nextId=Math.max(0,...entries.map(e=>e.id));
        }
        persistence='ready';
      } catch(error) {store=null;persistence='unavailable';storageFailure=safeLogDetails({...errorDiagnostics(error),storageStage:'read',storageArtifact:'runtime_log'});}
      loaded=true;notify();
    })().finally(()=>{loading=null;});return loading;
  }
  function persist() {
    pending=true;
    if(writing)return queue;
    writing=true;
    queue=queue.catch(()=>{}).then(async()=>{
      while(pending){
      pending=false;
      if(!store)continue;
      const document={version:1,diagnosticVersion:2,droppedEntries,partialRuns:clone(partialRuns),legacyRetentionUnknown,entries:clone(entries)};
      let storageStage='write';
      try {
        await store.setJson({...RUNTIME_LOG_ADDRESS,value:document});
        storageStage='readback';
        const check=await store.tryGetJson(RUNTIME_LOG_ADDRESS);
        if(!check.found||stableStringify(check.value)!==stableStringify(document))throw Object.assign(new Error('log readback mismatch'),{details:{reason:'storage_mismatch',storageStage:'compare'}});
        persistence='saved';storageFailure=null;
      } catch(error) {persistence='failed';storageFailure=safeLogDetails({storageStage,...errorDiagnostics(error),storageArtifact:'runtime_log'});}
      notify();
      }
    }).finally(()=>{writing=false;});return queue;
  }
  function record({run,task,phase,level='info',details={}}) {
    const entry=safeEntry({id:++nextId,run:Number.isSafeInteger(run)?run:++nextRun,task:Object.hasOwn(LOG_TASKS,task)?task:'operation',phase:Object.hasOwn(LOG_PHASES,phase)?phase:'failed',level,details,at:now(),pluginVersion:PRODUCT_VERSION});
    if(!entry)return;
    entries.push(entry);trim();notify();void persist();
  }
  return {
    load,record,async start(task,details={}){await load();const run=++nextRun;record({run,task,phase:'start',details});return run;},
    get state(){return {entries:clone(entries),persistence,limit:RUNTIME_LOG_LIMIT,byteLimit:RUNTIME_LOG_BYTES,droppedEntries,partialRuns:clone(partialRuns),legacyRetentionUnknown,storageFailure:clone(storageFailure)};},
    async flush(){await queue;},
    async clear(){await load();entries=[];droppedEntries=0;partialRuns=[];legacyRetentionUnknown=false;notify();await persist();if(!store||persistence!=='saved')throw new Error('日志清空未通过保存确认，请重试');},
    async export(){await load();await queue;const terminal=new Set(entries.filter(e=>['complete','failed','canceled'].includes(e.phase)).map(e=>e.run));return {kind:'shiyi-runtime-log',version:1,diagnosticVersion:2,pluginVersion:PRODUCT_VERSION,exportedAt:now(),persistence,retention:{limit:RUNTIME_LOG_LIMIT,byteLimit:RUNTIME_LOG_BYTES,droppedEntries,partialRuns:clone(partialRuns),legacyRetentionUnknown,firstId:entries[0]?.id??null,lastId:entries.at(-1)?.id??null},unfinishedRuns:[...new Set(entries.filter(e=>e.phase==='start'&&!terminal.has(e.run)).map(e=>e.run))],storageFailure:clone(storageFailure),limitations:['不含密钥、请求正文、模型原文或私人文件路径。','宿主或服务未提供的错误原因无法还原。','未结束任务可能仍在运行或曾被强制退出；不能据此断定崩溃。','旧版本丢失的日志不能补录。'],entries:clone(entries)};},
  };
}
