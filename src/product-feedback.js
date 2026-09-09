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
  CHAT_REF_UNAVAILABLE:'未能取得 TT 当前聊天。请确认已进入具体对话、正文加载完成后重试；不会读取其他聊天。',
  CHAT_IDENTITY_NOT_READY:'TT 尚未提供当前聊天的持久标识，请等待聊天保存完成后重试。',
  CHAT_HANDLE_UNAVAILABLE:'TT 未能提供当前聊天读取接口，请重新进入这段对话后重试。',
  HISTORY_UNAVAILABLE:'当前聊天正文未读到，或所选范围为空。请等待正文加载完成并检查楼层范围。',
  CHAT_CHANGED:'读取期间聊天已切换，本次已停止；请在目标聊天重新开始总结。',
  SOURCE_INVALIDATED:'所选正文已修改，本次已停止；请按修改后的内容重新总结。',
  FLOOR_SUMMARY_MISSING:'逐楼摘要未完整对应所选楼层，本批未保存。这不等于回复上限不足；请查看运行日志中的缺失楼层和结束原因。',
  MODEL_OUTPUT_TRUNCATED:'服务明确报告输出被截断，本批未保存。请查看运行日志中的实际回复上限、结束原因和用量。',
  MODEL_OUTPUT_BLOCKED:'模型服务拦截了输出，本批未保存；提高回复上限不能解决此问题。',
  INPUT_BUDGET_EXCEEDED:'输入超过预算，请提高总结输入预算或减少每批楼数；未完成部分不会注入。',
  TIMEOUT:NETWORK['network.timeout'], CANCELED:'任务已停止；已保存内容保留。',
  MODEL_UNAVAILABLE:'请先在 API 中填写并保存总结地址与模型。',
  PROVIDER_PROFILE_INVALID:'API 地址或认证配置不正确。',
  SUMMARY_RESPONSE_INVALID:'模型返回的内容不符合总结格式，本次结果未标记为成功。',
  SUMMARY_RESPONSE_ERROR:'模型响应中断或内容格式不正确，请重试。',
  PERSISTENCE_ERROR:'保存或读回校验失败，不能确认本次结果已保存。',
  PERSISTENCE_UNAVAILABLE:'当前聊天存储不可用，请确认聊天已保存。',
};
const HTTP = {401:'认证失败，请检查本模型的 Key 和认证方式。',403:'服务拒绝访问，请检查账号权限。',404:'接口不存在，请检查地址和资源路径；不会自动添加 /v1。',408:'服务处理超时，请重试。',429:'服务限流或额度不足，请稍后重试或检查余额。',500:'模型服务内部错误，请稍后重试。',502:'模型服务网关错误，请稍后重试。',503:'模型服务暂时不可用，请稍后重试。',504:'模型服务网关超时，请重试或减少本次输入。'};

/** No response body, prompt, URL, or credential is used as a diagnostic payload. */
export function productFailure(error) {
  const rawCode=error?.code ?? (error?.name==='AbortError'?'CANCELED':null);
  const code=typeof rawCode==='string'&&/^[\w.-]{1,80}$/.test(rawCode)?rawCode:'OPERATION_FAILED';
  const rawStatus=Number(error?.details?.status);
  const status=Number.isInteger(rawStatus)&&rawStatus>=400&&rawStatus<=599?rawStatus:null;
  let message=HTTP[status]??NETWORK[code]??CODES[code];
  if(code==='FLOOR_SUMMARY_MISSING'&&['expected','received','covered'].every(k=>Number.isSafeInteger(error?.details?.[k])&&error.details[k]>=0)){
    const d=error.details;message=`收到 ${d.received} 条逐楼摘要，完整对应 ${d.covered}/${d.expected} 楼，本批未保存。请查看运行日志；这不代表回复上限不足。`;
  }
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
  return Object.assign(new Error('模型服务返回错误'),{code,details:{...(Number.isInteger(status)&&status>=400&&status<=599?{status}:{})}});
}
export const modelListFailure = providerEnvelopeFailure;
