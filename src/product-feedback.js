import { validationIssueText } from './validation-diagnostics.js';
import { upstreamErrorCode,upstreamErrorHint } from './diagnostics.js';

const NETWORK = {
  'network.timeout':'请求超时，请重试或调整请求超时。',
  'network.connect_failed':'无法连接模型服务，请检查地址和网络。',
  'network.proxy_failed':'模型服务的网络代理连接失败。',
  'network.dns_failed':'域名解析失败，请检查服务地址和网络。',
  'network.tls_failed':'TLS 连接失败，请检查服务证书和 HTTPS 地址。',
  'network.body_interrupted':'响应传输中断，请重试。',
  'network.request_failed':'网络请求失败，请检查服务是否可访问。',
};
const CODES = {
  QUALITY_RESPONSE_INVALID:'校对结果的格式、对象或原文证据未通过验证；原总结保留，可在内容校对中单独重试。',
  RECOVERY_LIMIT:'本批自动恢复已达到 2 次，已返回的结果暂存保留。可继续未完成任务；不会无上限调用模型。',
  RESUME_UNAVAILABLE:'本批没有可续跑的暂存任务（旧版本或已过保留期），请点击重新生成；旧记忆不会提前删除。',
  VECTOR_RESPONSE_COUNT:'向量返回数量与输入不符；已保存的索引保留，请在向量页重试未完成项。',
  VECTOR_RESPONSE_INDEX:'服务返回的向量序号缺失、重复或越界，无法安全对应记忆。',
  VECTOR_RESPONSE_INVALID:'服务没有返回有效的浮点向量；请确认选择的是向量模型。',
  VECTOR_DIMENSION_MISMATCH:'向量维度发生变化；旧记忆保留，请在索引维护中重建索引。',
  VECTOR_INPUT_EMPTY:'这条记忆没有可编码的文字，请修改原记忆后重试。',
  VECTOR_INPUT_TOO_LARGE:'单条记忆过长，未自动发送，请在向量列表检查原记忆。',
  VECTOR_INDEX_INCOMPLETE:'部分向量未完成；成功项已保存，可一键重试未完成项，无需重新总结。',
  PROVIDER_REQUEST_FAILED:'模型服务返回异常，未得到可用结果。请查看运行日志后重试。',
  MERGE_RESPONSE_INVALID:'合并接口返回的判断或依据不完整。总结已经保存，可以只重试合并。',
  CHAT_REF_UNAVAILABLE:'未能取得 TT 当前聊天。请确认已进入具体对话、正文加载完成后重试；不会读取其他聊天。',
  CHAT_IDENTITY_NOT_READY:'TT 尚未提供当前聊天的持久标识，请等待聊天保存完成后重试。',
  CHAT_HANDLE_UNAVAILABLE:'TT 未能提供当前聊天读取接口，请重新进入这段对话后重试。',
  HISTORY_UNAVAILABLE:'当前聊天正文未读到，或所选范围为空。请等待正文加载完成并检查楼层范围。',
  CHAT_CHANGED:'聊天已切换，旧聊天操作已停止；当前聊天会自动加载。',
  SOURCE_INVALIDATED:'所选正文或记录规则已变化，本次已停止；请按修改后的内容重新生成。',
  REVISION_CONFLICT:'当前聊天记忆已发生变化，旧草稿未覆盖新记录。请重新生成此批；旧成功结果仍保留。',
  SCOPE_CONFLICT:'暂存任务与当前聊天或批次不一致，已阻止混用；请确认聊天后重新生成。',
  FLOOR_SUMMARY_MISSING:'逐楼摘要未完整对应所选楼层，本批未保存。这不等于回复上限不足；请查看运行日志中的缺失楼层和结束原因。',
  MODEL_OUTPUT_TRUNCATED:'服务明确报告输出被截断，本批未保存。请查看运行日志中的实际回复上限、结束原因和用量。',
  MODEL_OUTPUT_BLOCKED:'模型服务拦截了输出，本批未保存；提高回复上限不能解决此问题。',
  INPUT_BUDGET_EXCEEDED:'输入超过预算，请提高总结输入预算或减少每批楼数；未完成部分不会注入。',
  TIMEOUT:NETWORK['network.timeout'], CANCELED:'任务已停止；已保存内容保留。',
  MODEL_UNAVAILABLE:'请先在 API 中填写并保存总结地址与模型。',
  PROVIDER_PROFILE_INVALID:'API 地址或认证配置不正确。',
  SUMMARY_RESPONSE_INVALID:'模型返回的内容不符合总结格式，本次结果未标记为成功。',
  VALIDATION_ERROR:'返回内容未通过结构或来源校验，本次结果未保存。请查看运行日志的校验字段；这不等于回复上限不足。',
  SUMMARY_RESPONSE_ERROR:'模型响应中断或内容格式不正确，请重试。',
  PERSISTENCE_ERROR:'保存或读回校验失败，不能确认本次结果已保存。',
  PERSISTENCE_UNAVAILABLE:'当前聊天存储不可用，请确认聊天已保存。',
};
const HTTP = {400:'服务拒绝请求参数，请检查所选模型、接口格式和输入长度。',413:'服务拒绝过大的输入，请减少本次输入或检查模型限制。',422:'服务无法处理这些输入参数，请检查模型和接口格式。',401:'认证失败，请检查本模型的 Key 和认证方式。',403:'服务拒绝访问，请检查账号权限。',404:'接口不存在，请检查地址和资源路径；不会自动添加 /v1。',408:'服务处理超时，请重试。',429:'服务限流或额度不足，请稍后重试或检查余额。',500:'模型服务内部错误，请稍后重试。',502:'模型服务网关错误，请稍后重试。',503:'模型服务暂时不可用，请稍后重试。',504:'模型服务网关超时，请重试或减少本次输入。'};

/** No response body, prompt, URL, or credential is used as a diagnostic payload. */
export function productFailure(error) {
  const rawCode=error?.code ?? (error?.name==='AbortError'?'CANCELED':null);
  const code=typeof rawCode==='string'&&/^[\w.-]{1,80}$/.test(rawCode)?rawCode:'OPERATION_FAILED';
  const rawStatus=Number(error?.details?.status);
  const status=Number.isInteger(rawStatus)&&rawStatus>=400&&rawStatus<=599?rawStatus:null;
  let message=HTTP[status]??NETWORK[code]??CODES[code];
  if(error?.details?.upstreamCode==='insufficient_quota')message='模型服务额度已用尽，已停止自动重试。请恢复额度或在 API 中选择可用服务；已保存记忆保留。';
  else if(status===524)message='服务网关等待模型超时（HTTP 524），不是本机回复上限不足。已返回的结果保留；等待服务恢复后可继续未完成任务，不必重做已完成阶段。';
  else if(status===429)message=error?.details?.retryAfterMs>0?'服务限流，请按接口提示等待后重试；已保存记忆保留。':'服务限流，未提供恢复时间，已停止自动重试。请稍后重试或检查服务额度；已保存记忆保留。';
  else if([502,503,504].includes(status)){
    const hint=error?.details?.upstreamHint;
    const cause=({timeout:'服务报文提示上游等待超时。',overloaded:'服务报文提示模型繁忙。',connection_reset:'服务报文提示上游连接断开。',context_limit:'服务报文提示输入上下文超限。'})[hint]??'接口未提供可确认的具体原因。';
    const label=({502:'网关错误',503:'暂时不可用',504:'网关超时'})[status];
    message=`模型服务${label}（HTTP ${status}）。${cause}已保存批次保留，在批次管理中继续未完成任务即可，不必重新总结成功批次。${error?.details?.streaming===false&&hint==='timeout'?'可在 API → 请求设置开启总结流式接收后再试；不会自动追加收费请求。':''}`;
  }
  if(code==='PERSISTENCE_ERROR'&&['vector_jobs','vector_index','vector_staging'].includes(error?.details?.storageArtifact)){
    message='向量本机保存未通过校验，已保存的故事记忆不受影响。可在召回 → 向量重试未完成项，无需重新总结；具体保存阶段见日志。';
  }
  if(code==='VALIDATION_ERROR'){
    const issue=validationIssueText(error?.details?.validationIssues?.[0]);
    if(issue)message=`${error?.details?.repairAttempted?'已自动纠错一次，但仍未通过：':''}${issue}。本次结果未保存；完整校验信息见运行日志。`;
    if(error?.details?.reason==='quality_validation'&&Number.isSafeInteger(error.details.accepted)&&Number.isSafeInteger(error.details.rejected)&&error.details.rejected>0)
      message=`已缓存 ${error.details.accepted} 项复核改动，${error.details.rejected} 项仍需修复。本批尚未进入正式记忆；点击继续未完成任务，仅重试复核，不重做主总结。`;
  }
  if(code==='FLOOR_SUMMARY_MISSING'&&['expected','received','covered'].every(k=>Number.isSafeInteger(error?.details?.[k])&&error.details[k]>=0)){
    const d=error.details;message=`收到 ${d.received} 条逐楼摘要，完整对应 ${d.covered}/${d.expected} 楼，本批未保存。请查看运行日志；这不代表回复上限不足。`;
  }
  if(code==='INPUT_BUDGET_EXCEEDED'&&Number.isSafeInteger(error?.details?.inputUnits)&&Number.isSafeInteger(error?.details?.inputLimit))message=`本次模型输入估算 ${error.details.inputUnits}，超过设置的 ${error.details.inputLimit}；该请求尚未发送。已返回的结果保留，可调整输入预算后继续。`;
  if(error?.details?.reason==='stream_incomplete')message='模型流式传输中断，未收到完整结束标记；半份结果没有保存。已完成阶段保留，可继续未完成任务。';
  if(error?.details?.reason==='stream_invalid')message='服务返回的流式格式不兼容，本次结果未保存。可在 API 请求设置关闭流式接收后重试；不会自动追加一次收费请求。';
  if(error?.details?.reason==='stream_error'&&!status&&error?.details?.upstreamCode!=='insufficient_quota')message='模型服务在流式返回途中报错，本批未保存。已完成阶段保留；具体服务错误分类见运行日志。';
  if(!message&&error instanceof TypeError)message='网络请求或浏览器跨域访问失败，请检查网络与服务地址。';
  // Local validation errors contain actionable Chinese text. Never echo remote
  // bodies or raw provider errors (they may contain the request and credentials).
  if(!message&&code==='OPERATION_FAILED'&&typeof error?.message==='string'&&/^[\u3400-\u9fff]/u.test(error.message))
    message=error.message.replace(/https?:\/\/\S+/gi,'[地址]').replace(/(?:Bearer\s+\S+|sk-[\w-]+|anima_[\w-]+)/gi,'[已隐藏]').slice(0,200);
  return {code,status,message:message??'操作未完成，请检查配置后重试。'};
}

export function failureText(error) { const f=productFailure(error);return `${f.message}${f.status?`（HTTP ${f.status}）`:f.code==='OPERATION_FAILED'?'':`（${f.code}）`}`; }

/** TT's status route reports upstream errors in an HTTP-200 envelope. */
export function providerEnvelopeFailure(response) {
  const code=Object.hasOwn(NETWORK,response?.code)?response.code:'PROVIDER_REQUEST_FAILED';
  const rawStatus=response?.status??response?.error?.status??String(response?.message??'').match(/\b(?:HTTP(?:\s+error)?|status(?:\s+code)?)\s*[:=]?\s*([45]\d\d)\b/i)?.[1];
  const status=Number(rawStatus);
  const upstreamCode=upstreamErrorCode(response);
  return Object.assign(new Error('模型服务返回错误'),{code,details:{...(Number.isInteger(status)&&status>=400&&status<=599?{status}:{}),...(upstreamCode?{upstreamCode}:{}),upstreamHint:upstreamErrorHint(response)}});
}
export const modelListFailure = providerEnvelopeFailure;
