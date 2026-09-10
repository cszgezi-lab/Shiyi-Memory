import { PRODUCT_SETTING_REGISTRY as registry } from './product-settings.js';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const button = (action, label, primary = false) => `<button type="button" data-action="${action}" ${primary ? 'class="sy-primary"' : ''}>${label}</button>`;
export const field = (label, input) => `<label class="sy-field"><span>${label}</span>${input}</label>`;
const names = { base:'自动补接口路径', exact:'完整地址（不补路径）', none:'无需 Key', bearer:'标准 Key（默认）', 'api-key':'x-api-key（服务商要求时）', inherit:'沿用记录偏好', ask_manual:'手动总结时填写', ask_every:'每次总结前填写', disabled:'关闭', broadcast:'各类别均衡召回', leader_only:'仅指定通道', original:'原创', fanfiction:'同人', system:'系统', user:'用户', start:'请求开头', before_last:'最后一条消息前' };
const copy = {
  messageCount:['默认总结楼数','手动总结的初始值；本次以范围选择中的输入为准。'],
  autoSummaryEnabled:['自动整理聊天','AI 回复后检查是否需要整理。'],
  autoSummaryEvery:['每新增多少楼自动整理','一条聊天消息算一楼。'],
  recordingRules:['长期记录偏好','告诉总结模型哪些内容值得记住。'],
  focusMode:['总结侧重点','手动总结时可以临时补充要求。'],
  inputBudgetUnits:['总结输入预算','估算正文、提示词和相关记忆的输入长度；不是回复上限。'],
  outputBudgetUnits:['总结回复上限（Token）','0 表示沿用服务商默认值。'],
  excludedTags:['忽略的正文标签','标签中的内容不参与总结，用逗号分隔。'],
  injectionEnabled:['自动注入相关记忆','发送聊天时，把相关记忆加入本轮请求。'],
  retrievalLimit:['每次最多注入几条',''],
  retrievalBudgetUnits:['注入长度上限',''],
  timeProtection:['注入日期参照','附带事件日期和时间关系。'],
  personaEnabled:['注入相关人物信息','保留身份、学校、住址和已有变化。'],
  performanceEnabled:['注入人物演绎参考','使用有记录依据的变化，不编造内心。'],
  injectionPosition:['记忆放置位置',''], injectionRole:['记忆消息角色',''],
  vectorEnabled:['向量检索','按语义寻找记忆；需要配置向量 API。'],
  vectorAutoUpdate:['后台更新索引','启用向量后，记忆变化会自动调用向量 API 补建索引，不等待发送聊天时才处理。'],
  rerankEnabled:['重排筛选','再次比较候选记忆的相关性；需要配置重排 API。'],
  retrievalCandidateLimit:['初选记忆数量','先找出候选，再筛选用于注入的记忆。'],
  rerankMaxCandidates:['交给重排的记忆数量',''],
  bm25K1:['重复关键词的影响','决定同一个词重复出现时，对排名的影响。'],
  bm25B:['长短记忆的平衡','减少长记录仅因字多而靠前的情况。'],
  vectorWeight:['语义检索权重',''], fusionLocalWeight:['关键词检索权重',''],
  fusionRankConstant:['合并排名平滑值','数值越大，前后名次的差距越平缓。'],
  distributedEnabled:['分类检索','先从事件、人物、约定和资料等分类找候选，再统一筛选。'],
  distributedStrategy:['分类检索方式',''],
  distributedChannel:['指定检索类别','仅指定通道时填写 memory 或 knowledge。'],
  retrievalTimeoutMs:['总检索超时（毫秒）','0 表示分别使用向量与重排的超时设置。'],
  vectorTimeoutMs:['向量超时（毫秒）',''], rerankTimeoutMs:['重排超时（毫秒）',''],
  worldMode:['故事类型','同人的原作设定不等于当前聊天已经发生的事实。'],
  knowledgeEnabled:['检索已导入资料','全局资料库作为原作参照，不会合并其他聊天的经历。'],
  aliases:['人物别名','每行填写：主名=别名,别名。'],
  dictionaryEnabled:['使用自动字典','总结和资料分析时生成；别称有歧义时不自动归并。'],
  tagRecallEnabled:['标签辅助召回','结合本轮相关主题补充候选，仍保留普通语义检索。'],
  tagCandidateLimit:['每个标签初选几条','与普通候选合并去重，再统一重排。'],
  externalStatePaths:['只读变量路径','读取指定的 chatMetadata 或 lastMessageExtra 字段，不改写 MVU。'],
  storyDate:['故事日期参照（兼容设置）','未知留空，不使用现实日期代替剧情日期。'],
  deadlineMs:['模型请求超时（毫秒）','120000 即 2 分钟。'],
  assistantBudgetUnits:['助手输入预算','估算对话、文件和工具说明的输入长度；不是回复上限。'],
  assistantOutputTokens:['助手回复上限（Token）','0 表示沿用服务商默认值。'],
  summaryBatchSize:['每多少楼记录一次','10 楼一批：1–300 楼会分成 30 批。'],
  assistantFollowSummary:['沿用总结模型','共用地址、模型和已保存的 Key，无需再填一遍。'],
};

export function setting(key, label, help, placeholder = '') {
  const d = registry[key]; if (!d || d.persisted === false) throw new Error(`未知设置：${key}`);
  const [name, hint] = [label ?? copy[key]?.[0] ?? d.label, help ?? copy[key]?.[1] ?? ''];
  let input;
  const attr = `data-setting="${key}"`;
  if (d.type === 'boolean') input = `<input type="checkbox" ${attr} ${d.defaultValue ? 'checked' : ''}>`;
  else if (d.type === 'enum') input = `<select ${attr}>${d.values.map(v => `<option value="${esc(v)}" ${v === d.defaultValue ? 'selected' : ''}>${esc(names[v] ?? v)}</option>`).join('')}</select>`;
  else if (['recordingRules','aliases','externalStatePaths'].includes(key)) input = `<textarea rows="4" ${attr} maxlength="${d.maxLength}">${esc(d.defaultValue)}</textarea>`;
  else input = `<input ${attr} type="${['integer','number'].includes(d.type) ? 'number' : key === 'storyDate' ? 'date' : 'text'}" ${d.min !== undefined ? `min="${d.min}" max="${d.max}" step="${d.type === 'integer' ? 1 : 'any'}"` : `maxlength="${d.maxLength}"`} value="${esc(d.defaultValue)}" placeholder="${esc(placeholder)}" autocomplete="off">`;
  const html=`<label class="sy-field ${d.type === 'boolean' ? 'sy-toggle' : ''}"><span>${esc(name)}${hint ? `<small class="sy-help">${esc(hint)}</small>` : ''}</span>${input}</label>`;
  return key==='aliases'?`<details><summary>手动字典文本（高级）</summary>${html}</details>`:html;
}
const fields = keys => keys.map(key => setting(key)).join('');
const advanced = (title, keys) => `<details class="sy-advanced"><summary>${title}</summary>${fields(keys)}</details>`;
const card = (title, body) => `<div class="sy-card"><h4>${title}</h4>${body}</div>`;

export const SETTING_GROUPS = Object.freeze({
  recording: ['messageCount','autoSummaryEnabled','autoSummaryEvery','recordingRules','focusMode','inputBudgetUnits','outputBudgetUnits','excludedTags','summaryBatchSize'],
  injection: ['injectionEnabled','retrievalLimit','retrievalBudgetUnits','timeProtection','personaEnabled','performanceEnabled','injectionPosition','injectionRole'],
  vectors: ['vectorEnabled','vectorAutoUpdate'],
  retrieval: ['rerankEnabled','tagRecallEnabled','tagCandidateLimit','retrievalCandidateLimit','rerankMaxCandidates','bm25K1','bm25B','vectorWeight','fusionLocalWeight','fusionRankConstant','distributedEnabled','distributedStrategy','distributedChannel','retrievalTimeoutMs','vectorTimeoutMs','rerankTimeoutMs'],
  world: ['worldMode','knowledgeEnabled','dictionaryEnabled','aliases','externalStatePaths','storyDate'],
});
export function settingsSection(kind) {
  const keys = SETTING_GROUPS[kind];
  if (kind === 'recording') return card('记录偏好', fields(keys.slice(0,5)) + advanced('总结高级设置', keys.slice(5)));
  if (kind === 'injection') return card('把记忆交给 AI', fields(keys.slice(0,6)) + advanced('注入位置', keys.slice(6)));
  if (kind === 'vectors') return card('向量索引',fields(keys));
  if (kind === 'retrieval') return card('召回策略', fields(['rerankEnabled','retrievalCandidateLimit','rerankMaxCandidates']) + advanced('标签辅助召回',['tagRecallEnabled','tagCandidateLimit']) + advanced('关键词与融合',['bm25K1','bm25B','vectorWeight','fusionLocalWeight','fusionRankConstant']) + advanced('分类检索',['distributedEnabled','distributedStrategy','distributedChannel']) + advanced('超时保护',['retrievalTimeoutMs','vectorTimeoutMs','rerankTimeoutMs']));
  return card('世界与资料', fields(['worldMode','knowledgeEnabled','dictionaryEnabled','aliases']) + advanced('变量与日期兼容设置',['externalStatePaths','storyDate']));
}

export const API_INFO = Object.freeze({
  summary: { prefix:'provider', title:'总结模型', help:'整理你选择的聊天楼层，提取事件、人物、关系与知情者。不会替代主聊天模型。', resource:'/chat/completions' },
  assistant: { prefix:'assistant', title:'配置助手', help:'理解你的要求和配置文件，生成可确认、可应用的设置方案。', resource:'/chat/completions' },
  embedding: { prefix:'embedding', title:'向量模型', help:'按意思寻找相关记忆。已预填硅基流动推荐配置，可更换服务商。', resource:'/embeddings' },
  rerank: { prefix:'rerank', title:'重排模型', help:'从候选记忆里挑出更相关的内容，让注入更精简。', resource:'/rerank' },
});
export function apiSettingsHTML() {
  return Object.entries(API_INFO).map(([kind, {prefix, title, help, resource}]) => `<section class="sy-card sy-api-card" data-api-card="${kind}"><div class="sy-top"><h4>${title}</h4>${['embedding','rerank'].includes(kind) ? button(`recommend-${kind}`, '补齐推荐值') : ''}</div><p class="sy-help">${help}</p>
    ${kind === 'assistant' ? setting('assistantFollowSummary') + '<p class="sy-inherited sy-help" data-inherited></p>' : ''}
    <div data-api-fields="${kind}">
    ${setting(`${prefix}Endpoint`, 'API 地址', `基础地址只补 ${resource}，不自动添加 /v1。`, '填写你的服务商地址')}
    ${field('API Key', `<input type="password" autocomplete="new-password" data-key="${kind}" placeholder="无需认证的服务可以留空"><small class="sy-help">随 API 保存到本机 TT 数据，重启自动恢复；不加入助手消息或拾忆导出。${['embedding','rerank'].includes(kind) ? '硅基流动需要填写 Key。' : ''}</small>`)}
    <p class="sy-help" data-key-status="${kind}" role="status"></p>${button(`forget-key-${kind}`,'清除已保存 Key')}
    <div class="sy-model-picker"><div class="sy-top"><span>选择模型</span>${button(`models-${kind}`, '拉取模型列表')}</div>
    <label class="sy-field"><span class="sy-sr-only">${title}模型列表</span><select data-model-list="${kind}" disabled><option value="">先拉取模型列表，也可以在下方直接输入</option></select></label>
    ${setting(`${prefix}Model`, '模型名称', '', '选择列表中的模型，或手动填写')}
    <p class="sy-help" role="status" data-model-status="${kind}"></p></div>
    <details class="sy-advanced"><summary>高级连接选项（通常不用改）</summary>${setting(`${prefix}EndpointMode`, '地址如何使用', `默认只补 ${resource}，绝不补 /v1。填完整接口地址时可选“不补路径”。`)}${setting(`${prefix}AuthMode`, 'Key 发送方式', '一般保持“标准 Key”；不需要 Key 可留空或选“无需 Key”。只有服务商明确要求时才改用 x-api-key。')}${field('模型列表地址（可选）', `<input data-models-url="${kind}" placeholder="留空时按 API 地址推导 /models" autocomplete="off">`)}</details>
    </div><div class="sy-actions">${button(`save-api-${kind}`, '保存', true)}${button(`test-${kind}`, '测试连接')}</div></section>`).join('') + card('请求设置', setting('deadlineMs') + setting('assistantBudgetUnits') + setting('assistantOutputTokens'));
}

// Upgrade opt-in: never replace a custom endpoint, model, or a deliberate zero/false.
export function missingRecommendations(settings, kind) {
  if (!['embedding','rerank'].includes(kind)) return {};
  const endpointKey = `${kind}Endpoint`, modelKey = `${kind}Model`;
  const endpoint = String(settings[endpointKey] ?? '').trim();
  const model = String(settings[modelKey] ?? '').trim();
  const recommendedEndpoint = registry[endpointKey].defaultValue;
  if (!endpoint && !model) return { [endpointKey]: recommendedEndpoint, [modelKey]: registry[modelKey].defaultValue };
  if (endpoint === recommendedEndpoint && !model) return { [modelKey]: registry[modelKey].defaultValue };
  return {};
}
