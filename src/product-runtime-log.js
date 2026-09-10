import { clone, stableStringify } from './utils.js';
import { productStoreFromSession } from './product-host-adapters.js';
import { PRODUCT_VERSION } from './product-release.js';
import { safeValidationIssues } from './validation-diagnostics.js';

export const RUNTIME_LOG_ADDRESS = Object.freeze({ namespace: 'shiyi-product-diagnostics', key: 'runtime-v1' });
export const RUNTIME_LOG_LIMIT = 200;
export const LOG_TASKS = Object.freeze({ summary:'总结', merge:'事件合并', connection:'连接测试', models:'拉取模型', assistant:'配置助手', knowledge:'知识库分析', vectors:'建立向量索引', import:'导入文件', recall:'召回预览' });
export const LOG_PHASES = Object.freeze({ start:'任务开始', range:'读取楼层', request:'发送模型请求', response:'收到模型响应', merge_deferred:'总结先保存，合并单独处理', merge_accepted:'确认同一次事件', merge_separate:'暂不合并', normalize:'兼容状态写法', repair_request:'正在自动纠正字段', repair_response:'收到字段纠错结果', repair_complete:'字段纠错通过', repair_failed:'字段纠错未通过', repair_skipped:'跳过字段纠错', floors:'检查逐楼摘要', validate:'校验记忆内容', commit:'保存记忆', complete:'任务完成', failed:'任务失败', canceled:'任务停止' });
const CODES = new Set(['OPERATION_FAILED','MERGE_RESPONSE_INVALID','FLOOR_SUMMARY_MISSING','MODEL_OUTPUT_TRUNCATED','MODEL_OUTPUT_BLOCKED','INPUT_BUDGET_EXCEEDED','COVERAGE_INCOMPLETE','SUMMARY_RESPONSE_ERROR','SUMMARY_RESPONSE_INVALID','VALIDATION_ERROR','PROVIDER_HTTP_ERROR','PROVIDER_REQUEST_FAILED','PROVIDER_PROFILE_INVALID','MODEL_UNAVAILABLE','TIMEOUT','CANCELED','CHAT_REF_UNAVAILABLE','CHAT_HANDLE_UNAVAILABLE','CHAT_IDENTITY_NOT_READY','HISTORY_UNAVAILABLE','CHAT_CHANGED','SOURCE_INVALIDATED','SCOPE_CONFLICT','REVISION_CONFLICT','PERSISTENCE_ERROR','PERSISTENCE_UNAVAILABLE','HOST_CONTRACT_INVALID','network.timeout','network.connect_failed','network.proxy_failed','network.dns_failed','network.tls_failed','network.body_interrupted','network.request_failed']);
const FINISH_REASONS = new Set(['stop','length','max_tokens','truncated','abort','content_filter','tool_calls','end_turn','unknown']);
const NUMBERS = ['batchNumber','childIndex','startIndex','endIndex','sourceCount','inputLimit','inputUnits','maxTokens','elapsedMs','status','expected','received','covered','invalidRows','duplicateCount','promptTokens','completionTokens','totalTokens','reasoningTokens','responseChars','savedBatches','normalizedFields','repairFields'];
export function safeLogDetails(value = {}) {
  const result = {};
  const issues=safeValidationIssues(value?.validationIssues);
  if(issues.length)result.validationIssues=issues;
  if(Number.isSafeInteger(value?.validationIssueCount)&&value.validationIssueCount>=0)result.validationIssueCount=value.validationIssueCount;
  for (const key of NUMBERS) if (Number.isSafeInteger(value?.[key]) && value[key] >= 0) result[key] = value[key];
  for (const key of ['missingFloors','duplicateFloors','emptyFloors']) if (Array.isArray(value?.[key])) result[key] = [...new Set(value[key].filter(n => Number.isSafeInteger(n) && n >= 0))].slice(0,200);
  if (value?.finishReason !== undefined) result.finishReason = FINISH_REASONS.has(value.finishReason) ? value.finishReason : 'unknown';
  if (typeof value?.truncated === 'boolean') result.truncated = value.truncated;
  if (typeof value?.repairAttempted === 'boolean') result.repairAttempted = value.repairAttempted;
  if (value?.code !== undefined) result.code = CODES.has(value.code) ? value.code : 'OPERATION_FAILED';
  if (['summary','assistant','embedding','rerank'].includes(value?.modelRole)) result.modelRole = value.modelRole;
  return result;
}
function safeEntry(value) {
  if (!Object.hasOwn(LOG_TASKS,value?.task) || !Object.hasOwn(LOG_PHASES,value?.phase)) return null;
  if (![value.id,value.run,value.at].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  return { id:value.id, run:value.run, at:value.at, task:value.task, phase:value.phase, level:['info','success','warning','error'].includes(value.level)?value.level:'info', details:safeLogDetails(value.details) };
}

/** Local bounded diagnostics. Never accepts prompts, response bodies, keys or URLs. */
export function createRuntimeLog({getStore,onChange=()=>{},now=()=>Date.now()} = {}) {
  let entries=[],store,loaded=false,loading,queue=Promise.resolve(),nextRun=0,nextId=0,persistence='not_loaded';
  const notify=()=>{try{onChange();}catch{/* diagnostics must not break a task */}};
  async function load() {
    if(loaded)return;
    if(loading)return loading;
    loading=(async()=>{
      try {
        store=productStoreFromSession({store:await getStore()});
        const found=await store.tryGetJson(RUNTIME_LOG_ADDRESS);
        if(found.found){
          if(found.value?.version!==1||!Array.isArray(found.value.entries))throw new Error('invalid log document');
          entries=found.value.entries.map(safeEntry).filter(Boolean).slice(-RUNTIME_LOG_LIMIT);
          nextRun=Math.max(0,...entries.map(e=>e.run));nextId=Math.max(0,...entries.map(e=>e.id));
        }
        persistence='ready';
      } catch {store=null;persistence='unavailable';}
      loaded=true;notify();
    })().finally(()=>{loading=null;});return loading;
  }
  function persist() {
    const document={version:1,entries:clone(entries)};
    queue=queue.catch(()=>{}).then(async()=>{
      if(!store)return;
      try {
        await store.setJson({...RUNTIME_LOG_ADDRESS,value:document});
        const check=await store.tryGetJson(RUNTIME_LOG_ADDRESS);
        if(!check.found||stableStringify(check.value)!==stableStringify(document))throw new Error('log readback mismatch');
        persistence='saved';
      } catch {persistence='failed';}
      notify();
    });return queue;
  }
  function record({run,task,phase,level='info',details={}}) {
    const entry=safeEntry({id:++nextId,run,task,phase,level,details,at:now()});
    if(!entry)return;
    entries=[...entries,entry].slice(-RUNTIME_LOG_LIMIT);notify();void persist();
  }
  return {
    load,record,async start(task,details={}){await load();const run=++nextRun;record({run,task,phase:'start',details});return run;},
    get state(){return {entries:clone(entries),persistence,limit:RUNTIME_LOG_LIMIT};},
    async flush(){await queue;},
    async clear(){await load();entries=[];notify();await persist();if(!store||persistence!=='saved')throw new Error('日志清空未通过保存确认，请重试');},
    async export(){await load();await queue;return {kind:'shiyi-runtime-log',version:1,pluginVersion:PRODUCT_VERSION,exportedAt:now(),persistence,entries:clone(entries)};},
  };
}
