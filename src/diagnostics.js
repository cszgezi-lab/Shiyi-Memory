// Shared, content-free diagnostics. Never serialize Error.message, API bodies,
// headers, URLs, user filenames or arbitrary server error objects into exports.
export const DIAGNOSTIC_REASONS = Object.freeze({
  input_budget_exceeded:'模型输入超过配置预算，请求尚未发送；已返回的结果保留',
  stream_invalid:'流式响应格式异常，未保存不完整内容',stream_incomplete:'流式响应在完成标记之前中断，未保存半份总结',stream_error:'服务在流式返回途中报告错误',
  chat_ref_unavailable:'宿主未能返回当前聊天标识',
  source_task_inactive:'原文校验所属任务已停止或被切换',
  source_plan_mismatch:'待校验请求与本次冻结的请求计划不一致',
  source_chat_changed:'原文校验期间当前聊天已切换',
  source_content_changed:'本批聊天正文或来源标识确实发生变化',
  source_read_failed:'读取原文失败，尚不能判断正文是否变化',
  quality_validation:'校对结果的结构、修改权限或原文证据未通过',
  empty_body:'接口返回空正文', invalid_envelope_json:'接口外层响应不是有效 JSON',
  empty_model_content:'模型回复正文为空', invalid_model_json:'模型正文不是有效 JSON',
  invalid_model_root:'模型结果不是要求的 JSON 对象', missing_categories:'模型结果缺少必需区块',
  invalid_repair_shape:'补全结果改变了区块结构或遗漏原有记录', body_interrupted:'读取响应正文时中断',
  http_error:'接口返回非成功 HTTP 状态', network_unclassified:'网络请求失败；宿主未提供更具体的网络原因',
  timeout:'请求超过等待时间', canceled:'请求被取消', output_truncated:'接口明确报告输出被截断',
  output_blocked:'接口明确报告内容过滤', invalid_chat_response:'接口缺少聊天回复',
  storage_read:'读取存档失败', storage_write:'写入存档失败', storage_readback:'写入后无法读回',
  storage_mismatch:'写入内容与读回内容不一致', storage_decode:'存档完整性校验失败',
  log_document_invalid:'旧日志格式无法读取，未覆盖旧文件', unclassified:'错误未提供可识别原因；请结合阶段与代码位置定位',
});
export const DIAGNOSTIC_PURPOSES=Object.freeze({summary_verification:'原文复核与补漏',summary_narrative:'事件与楼层整理',summary_details:'人物与知情整理',reference_repair:'纠正事件引用',summary:'主总结',floor_repair:'逐楼摘要补全',category_repair:'区块补全',enum_repair:'字段纠错',chat:'聊天模型',embeddings:'向量',rerank:'重排',models:'模型列表',ui:'界面操作',background:'后台任务'});
export const DIAGNOSTIC_STAGES=Object.freeze({prepare:'准备请求',request:'等待接口',read_body:'读取响应正文',parse_envelope:'解析接口响应',parse_content:'解析模型正文',validate:'校验结果',repair:'补全结果',storage:'本机保存',ui:'界面操作',background:'后台处理'});
export const UPSTREAM_CODES=Object.freeze({invalid_api_key:'密钥无效',api_key_missing:'服务要求密钥',context_length_exceeded:'超出模型上下文',insufficient_quota:'额度不足',rate_limit_exceeded:'服务限流',model_not_found:'模型不存在',server_error:'服务内部错误',invalid_request_error:'服务拒绝请求格式',outbound_host_denied:'出站地址被服务拒绝'});
// Providers may put a vendor-specific code beside a standard error type.
// An unrecognized code must not hide a recognized quota/authentication cause.
export function upstreamErrorCode(value){
  const candidates=[value?.error?.code,value?.error?.type,value?.code];
  const recognized=candidates.map(code=>code==='quota_exceeded'?'insufficient_quota':code).filter(code=>typeof code==='string'&&Object.hasOwn(UPSTREAM_CODES,code));
  return recognized.includes('insufficient_quota')?'insufficient_quota':recognized[0];
}
export const DIAGNOSTIC_ACTIONS=Object.freeze({open:'打开聊天',refresh:'刷新记忆',saveSettings:'保存设置',saveApi:'保存 API',forgetKey:'清除密钥',editRecord:'修改记忆',editPersonProfile:'修改人物档案',deleteRecord:'删除记忆',deleteRecords:'批量删除记忆',remember:'新增记忆',manageBatches:'管理总结批次',deleteBatch:'删除批次',regenerateBatch:'重新总结',retryBatch:'重试总结',retryIncompleteBatches:'重试未完成批次',saveModule:'保存扩展模块',editModuleRecord:'修改扩展记忆',rememberModule:'新增扩展记忆',importModules:'导入模块',exportModules:'导出模块',inspectMvu:'读取 MVU',syncModules:'同步 MVU',applyProposal:'应用助手方案',undoSettings:'撤销配置',saveDictionaryEntry:'修改字典',exportBackup:'导出聊天备份',exportGlobalBackup:'导出全局备份',setAutoStartFloor:'设置自动总结起点',setAutomatic:'配置自动总结',processAutomatic:'执行自动总结',setDraft:'保存助手草稿',newConversation:'新建助手对话',selectConversation:'切换助手对话',deleteConversation:'删除助手对话',hideRecord:'排除记忆',restoreHidden:'恢复被排除记忆',removeDocument:'删除知识库资料',updateDocument:'更新知识库资料',stop:'停止任务',disable:'暂停插件'});
const files=new Set(['summary-planner.js','request-deadline.js','provider.js','summary-stages.js','summary-context.js','summary-reference-repair.js','summary-engine.js','summary-recovery.js','contracts.js','repository.js','reliable-storage.js','host-adapter.js','product-application.js','product-workspace.js','product-network.js','product-shell-controller.js','product-host-adapters.js','product-view.js','product-runtime-log.js','product-model-list.js','product-vector-indexer.js','product-vector-cache.js','product-vector-storage.js','product-dictionary.js','product-event-merge.js','product-credentials.js','product-global-settings.js','product-module-controller.js','diagnostics.js']);
const errorTypes=new Set(['Error','TypeError','SyntaxError','RangeError','AbortError','DOMException','ShiyiError','SummaryResponseError','ValidationError','PersistenceError','ScopeConflictError','RevisionConflictError']);
files.add('summary-verification.js');
files.add('provider-stream.js');
const verificationCodes=new Set(['invalid_shape','missing_evidence','quote_not_in_source','protected_or_unknown_field','source_mismatch','source_removal','unknown_or_duplicate_target','unknown_category','missing_sources','duplicate_id']);
const verificationPath=/^(?:verification|reviewedSourceIds|reviews|checks|updates|repartitions|(?:edits|splitEvents|updates|additions|repartition)\[\d{1,6}\](?:\.events\[\d{1,6}\])?(?:\.(?:value|sources)|\.evidence\[\d{1,6}\]\.(?:sourceId|quote))?)$/;
let sequence=0;
export const QUALITY_REASONS=Object.freeze(['返回格式或条数不正确','缺少原文依据','依据不能对应原文','含不允许修改的字段','事实性质不正确','文字字段不正确','列表字段不正确','更新对象不在本批或重复','更新依据不属于原记录','新增区块或来源锚点不正确','新增记录不正确','新增依据不属于来源锚点','新增依据不属于本次校对来源','新增记录过长','新增记录含未知字段','知情字段缺失或事件不存在','知情字段缺失或关联事件/属性不存在','人物属性缺失或越权确认','疑点没有关联原记录','没有一项校对结果通过验证','校对项未通过原文与字段校验']);
export function diagnosticRequestId(){return `req-${Date.now().toString(36)}-${(++sequence).toString(36)}`;}
export function safeDiagnosticFields(value={}){
  const result={};
  if(Array.isArray(value?.verificationIssues))result.verificationIssues=value.verificationIssues.slice(0,100).flatMap(r=>typeof r?.path==='string'&&verificationPath.test(r.path)&&verificationCodes.has(r.code)?[{path:r.path,code:r.code,...(Number.isSafeInteger(r.sourceFloor)&&r.sourceFloor>=0?{sourceFloor:r.sourceFloor}:{})}]:[]);
  if(QUALITY_REASONS.includes(value?.qualityReason))result.qualityReason=value.qualityReason;
  if(Array.isArray(value?.qualityRejections))result.qualityRejections=value.qualityRejections.slice(0,100).flatMap(r=>['update','addition','issue'].includes(r?.kind)&&Number.isSafeInteger(r.index)&&r.index>=0?[{kind:r.kind,index:r.index,reason:QUALITY_REASONS.includes(r.reason)?r.reason:'校对项未通过原文与字段校验'}]:[]);
  for(const [key,labels]of [['reason',DIAGNOSTIC_REASONS],['purpose',DIAGNOSTIC_PURPOSES],['stage',DIAGNOSTIC_STAGES]])if(Object.hasOwn(labels,value?.[key]))result[key]=value[key];
  if(typeof value?.requestId==='string'&&/^req-[a-z0-9]{1,16}-[a-z0-9]{1,10}$/.test(value.requestId))result.requestId=value.requestId;
  if(errorTypes.has(value?.errorType))result.errorType=value.errorType;
  if(Object.hasOwn(UPSTREAM_CODES,value?.upstreamCode))result.upstreamCode=value.upstreamCode;
  if(Object.hasOwn(DIAGNOSTIC_ACTIONS,value?.action))result.action=value.action;
  for(const key of ['bodyChars','jsonPosition','jsonLine','jsonColumn','choicesCount','toolCallsCount','attempt','repairCategoriesCount','timeoutMs','retryAfterMs','validationIssuesOmitted','stackFramesOmitted','causeCount'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0)result[key]=value[key];
  for(const key of ['statusKnown','upstreamDetailsProvided'])if(typeof value?.[key]==='boolean')result[key]=value[key];
  if(['object','array','string','null','undefined','number','boolean'].includes(value?.contentType))result.contentType=value.contentType;
  if(['json','html','text','other','unknown'].includes(value?.responseType))result.responseType=value.responseType;
  if(Array.isArray(value?.repairCategories))result.repairCategories=value.repairCategories.filter(k=>['events','awarenessChanges','entityFactChanges','relationshipChanges','personaChanges','commitmentChanges','performanceHints','summaryView','conflicts'].includes(k));
  if(Array.isArray(value?.stackFrames))result.stackFrames=value.stackFrames.filter(frame=>{const m=/^([a-z-]+\.js):(\d{1,7}):(\d{1,7})$/.exec(frame);return m&&files.has(m[1]);}).slice(0,12);
  if(Array.isArray(value?.causes))result.causes=value.causes.slice(0,4).map(c=>safeDiagnosticFields({...c,causes:undefined}));
  return result;
}
export function errorDiagnostics(error){
  const frames=[...String(error?.stack??'').matchAll(/(?:[/\\])([a-z-]+\.js):(\d{1,7}):(\d{1,7})/g)].filter(m=>files.has(m[1])).map(m=>`${m[1]}:${m[2]}:${m[3]}`);
  const allFrames=[...new Set([...(safeDiagnosticFields(error?.details).stackFrames??[]),...frames])];
  const details={...error?.details,errorType:errorTypes.has(error?.name)?error.name:'Error',code:error?.code??'OPERATION_FAILED',stackFrames:allFrames.slice(0,12),stackFramesOmitted:Math.max(0,allFrames.length-12)};
  if(!details.reason)details.reason='unclassified';
  const seen=new Set([error]),causes=[];let cause=error?.cause??error?.details?.causeError;
  while(cause&&typeof cause==='object'&&!seen.has(cause)&&causes.length<4){seen.add(cause);causes.push(safeDiagnosticFields({...cause.details,errorType:errorTypes.has(cause.name)?cause.name:'Error'}));cause=cause.cause??cause.details?.causeError;}
  if(causes.length)details.causes=causes;
  return details;
}
export function jsonFailure(error,text,{stage='parse_content',...details}={}){
  const empty=!String(text??'').trim(),position=/position\s+(\d+)/i.exec(error?.message??''),line=/line\s+(\d+)\s+column\s+(\d+)/i.exec(error?.message??'');
  return {...details,stage,reason:stage==='parse_envelope'?(empty?'empty_body':'invalid_envelope_json'):(empty?'empty_model_content':'invalid_model_json'),bodyChars:String(text??'').length,...(position?{jsonPosition:Number(position[1])}:{}),...(line?{jsonLine:Number(line[1]),jsonColumn:Number(line[2])}:{}),causeError:error};
}
export function contentType(value){return value===null?'null':Array.isArray(value)?'array':typeof value;}

/** Last-resort listener only for this extension's own source URLs. It never
 * intercepts another extension's failures or suppresses host error reporting. */
export function installDiagnosticBoundary(host,report){
  if(typeof host?.addEventListener!=='function')return()=>{};
  const root=new URL('../',import.meta.url).href;
  const onError=event=>{
    const error=event?.error??event?.reason;
    if(!String(error?.stack??'').includes(root)&&!String(event?.filename??'').startsWith(root))return;
    try{report(error??new Error('plugin runtime error'),{stage:'background',task:'background'});}catch{/* no recursive reporting */}
  };
  host.addEventListener('error',onError);host.addEventListener('unhandledrejection',onError);
  return()=>{host.removeEventListener?.('error',onError);host.removeEventListener?.('unhandledrejection',onError);};
}
