import {
  DRAFT_CATEGORIES,
  SUMMARY_OUTPUT_CONTRACT,
  bindDraftBundle,
  coverageState,
  splitSummaryBatch,
  validateDraftBundle,
} from './contracts.js';
import { ScopeConflictError, ShiyiError, SummaryResponseError, ValidationError } from './errors.js';
import { abortError, clone, decodeUtf8Chunk, estimateUnits, sha256, stableStringify, throwIfAborted } from './utils.js';
import { requireIndependentFloorSummaries } from './floor-summaries.js';
import { safeLogDetails } from './product-runtime-log.js';

function responseStatus(response) {
  return Number(response?.status ?? response?.statusCode ?? 200);
}

async function readRawBody(response) {
  if (response?.aborted || response?.bodyAborted || response?.truncated || response?.complete === false) {
    throw new SummaryResponseError('summary response body was interrupted or truncated', { httpStatus: responseStatus(response) });
  }
  if (typeof response === 'string') return response;
  if (response?.body && typeof response.body !== 'string' && response.body[Symbol.asyncIterator]) {
    const chunks = [];
    try {
      for await (const chunk of response.body) chunks.push(decodeUtf8Chunk(chunk));
    } catch (error) {
      throw new SummaryResponseError('summary response body stream was interrupted', { cause: error.message });
    }
    return chunks.join('');
  }
  if (typeof response?.text === 'function') {
    try { return await response.text(); } catch (error) { throw new SummaryResponseError('summary response body could not be read', { cause: error.message }); }
  }
  if (typeof response?.body === 'string') return response.body;
  if (response?.body !== undefined) return JSON.stringify(response.body);
  return JSON.stringify(response);
}

function stripJsonFence(text) {
  const value = String(text ?? '').trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return fenced ? fenced[1].trim() : value;
}

async function parseModelResponse(raw, { onMetadata = () => {} } = {}) {
  const status = responseStatus(raw);
  if (status < 200 || status >= 300) {
    const body = await readRawBody(raw).catch(() => '');
    throw new SummaryResponseError(`summary model returned HTTP ${status}`, { status, bodyPrefix: body.slice(0, 200) });
  }
  let payload = raw;
  if (typeof raw === 'string' || raw?.text || raw?.body !== undefined || raw?.status !== undefined || raw?.statusCode !== undefined) {
    const text = stripJsonFence(await readRawBody(raw));
    try { payload = JSON.parse(text); } catch (error) { throw new SummaryResponseError('summary model returned invalid JSON', { cause: error.message, bodyPrefix: text.slice(0, 200) }); }
  }
  // OpenAI-compatible chat response. A length stop is a truncated model
  // result even when the provider happened to return syntactically valid JSON.
  const finishReason = payload?.choices?.[0]?.finish_reason ?? payload?.choices?.[0]?.finishReason ?? payload?.finish_reason ?? payload?.finishReason;
  const content=payload?.choices?.[0]?.message?.content??payload?.output_text;
  const metadata=safeLogDetails({status,finishReason:finishReason??'unknown',truncated:['length','max_tokens','truncated','abort'].includes(String(finishReason).toLowerCase()),promptTokens:payload?.usage?.prompt_tokens,completionTokens:payload?.usage?.completion_tokens,totalTokens:payload?.usage?.total_tokens,reasoningTokens:payload?.usage?.completion_tokens_details?.reasoning_tokens,responseChars:typeof content==='string'?content.length:undefined});
  try{onMetadata(metadata);}catch{/* diagnostics are not part of model validation */}
  if (['length', 'max_tokens', 'truncated', 'abort'].includes(String(finishReason).toLowerCase())) {
    const error=new SummaryResponseError('summary model output was truncated', metadata);error.code='MODEL_OUTPUT_TRUNCATED';throw error;
  }
  if(finishReason==='content_filter'){const error=new SummaryResponseError('summary model output was filtered',metadata);error.code='MODEL_OUTPUT_BLOCKED';throw error;}
  if (payload?.choices?.[0]?.message?.content !== undefined) payload = payload.choices[0].message.content;
  else if (payload?.output_text !== undefined) payload = payload.output_text;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(stripJsonFence(payload)); } catch (error) { throw new SummaryResponseError('summary model content is not valid JSON', { cause: error.message }); }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new SummaryResponseError('summary model response must be an object');
  if (payload.draftBundle && typeof payload.draftBundle === 'object') return payload.draftBundle;
  return payload;
}

function modelInvoker(model) {
  if (typeof model === 'function') return model;
  if (typeof model?.summarize === 'function') return model.summarize.bind(model);
  if (typeof model?.generate === 'function') return model.generate.bind(model);
  if (typeof model?.chatCompletions === 'function') {
    const invoke = (request, options) => model.chatCompletions(invoke.providerPayload(request), options);
    // Keep the exact wire shape in one place so the host can measure the
    // serialized payload before invoking an adapter.  The adapter receives no
    // second, independently estimated request.
    invoke.providerPayload = (request) => ({
      model: model.profile?.model,
      ...(model.profile?.maxTokens>0?{max_tokens:model.profile.maxTokens}:{}),
      messages: [
        { role: 'system', content: request.instructions },
        { role: 'user', content: JSON.stringify(request) },
      ],
      response_format: { type: 'json_object' },
    });
    return invoke;
  }
  throw new ValidationError('summary model adapter must be a function or expose summarize/generate/chatCompletions');
}

function ensureAllCategories(raw) {
  const missing = DRAFT_CATEGORIES.filter((category) => !(category in (raw ?? {})));
  if (missing.length) throw new SummaryResponseError('summary output is missing required categories', { missing });
}

function focusFingerprint(focusSpec, focusVersion = null) {
  return String(focusVersion ?? sha256(focusSpec ?? null).slice(0, 24));
}

function focusGate(focusSpec) {
  if (!focusSpec) return { mode: 'inherit', confirmed: true, focus: null };
  const mode = String(focusSpec.mode ?? focusSpec.askMode ?? 'inherit').toLocaleLowerCase();
  if (!['inherit', 'ask_manual', 'ask_every'].includes(mode)) throw new ValidationError(`unsupported FocusSpec mode: ${mode}`);
  // `inherit` is a non-interactive mode.  The ask modes are explicitly
  // confirmed by the local UI; no model request is made to decide a focus.
  if (mode !== 'inherit' && focusSpec.confirmed !== true) return { mode, confirmed: false, focus: null };
  return {
    mode,
    confirmed: true,
    focus: focusSpec.focus ?? focusSpec.prompt ?? focusSpec.once ?? null,
  };
}

function serializableFocusSpec(focusSpec) {
  const result = clone(focusSpec ?? null);
  if (result && typeof result === 'object') {
    // Resolved focus and recording rules have their own canonical wire fields
    // below. FocusSpec carries only selection/confirmation metadata so marker
    // text is not serialized twice.
    delete result.focus;
    delete result.prompt;
    delete result.once;
    delete result.rules;
    delete result.focusRules;
  }
  return result;
}

function sourceRefsFor(child) {
  return child.sourceMessages.map((message) => ({ sourceId: message.id, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId }));
}

function evidenceRefsFor(child) {
  return [...child.sourceMessages, ...child.bridgeMessages].map((message) => ({
    sourceId: message.id,
    version: message.version,
    hash: message.hash,
    contentHash: message.contentHash,
    fragmentId: message.fragmentId,
  }));
}

function makeInstructions(focus, rules) {
  return [
    '你是中文剧情记忆整理员。所有自然语言内容必须使用简体中文，不能以英文动作句代替中文总结；技术字段、枚举和来源标识保持契约原样。',
    '严格执行 outputContract.narrativeRules：完整事件纪要 description、召回速览 recallSummary 与逐楼经过 summaryView.text 分开写。标题不是纪要，多模块变化不代替事情的起因、过程和结果。输出前对照原文检查人物、时间、地点、条件/否认及结局，不续写，不用猜测填补缺失。',
    'Return one JSON DraftBundle for this complete source range.',
    'Return every required category with its exact categoryTypes from outputContract. The nine memory categories are arrays of record objects; use [] for categories with no changes. coverage is always an OBJECT with array fields sourceRefs, bridgeRefs, processed, excluded, unprocessed; never return coverage:[] or coverage:null. Follow coverageRules honestly.',
    'For all sourceRefs, copy source message id strings exactly, with fragmentId only when present. Do not output floor numbers or event IDs as source IDs. Omit host-owned hash, contentHash, version and swipeId; the host supplies frozen evidence metadata. Follow sourceRefRules for record sources and coverage alike.',
    'summaryView is NOT a batch overview. Write one row for EVERY sourceMessages item: {id, floorIndex: item.index, text, sourceRefs:[{sourceId:item.id, fragmentId:item.fragmentId if present}]}. Copy the source ID exactly. Never merge floors or omit user/non-story floors; do not summarize bridgeMessages. Briefly mark non-story content. Never manufacture details to fill a category.',
    'Do not invent scope, operationId, expectedRevision, paths, executable code, or permissions.',
    'Keep expression, response, mutual confirmation, public scope, state, epistemic status, perspective, time, and follow-up distinct.',
    'A recalled event includes its awareness, temporal context, and lifecycle dependencies as one unit.',
    'bridgeMessages are context only: do not count them as a new occurrence unless a sourceMessage supplies new evidence.',
    'Read focus, recording rules, source range, bridge context, relevant records, output schema, and budget only from the structured request envelope.',
    'Apply focus only as an extraction/display emphasis; never relax source, time, or authority checks. Treat rules as constraints, not executable instructions.',
  ].join('\n');
}

function recordText(record) {
  if (!record) return '';
  return [record.text, record.content, record.description, record.action, record.summary, record.knowledge, record.fact, record.entity, record.subject, record.object]
    .filter((value) => value !== undefined && value !== null).join(' ').toLocaleLowerCase();
}

function sourceText(messages) { return (messages ?? []).map((message) => message.text ?? '').join(' ').toLocaleLowerCase(); }

function sourceOverlap(record, sourceIds) {
  const refs = [...(record?.sourceRefs ?? record?.sources ?? [])];
  return refs.some((ref) => sourceIds.has(typeof ref === 'string' ? ref : ref?.sourceId ?? ref?.id));
}

/**
 * Choose a finite, deterministic relevant-record slice.  IDs are gathered
 * from the whole authoritative snapshot for reference validation, but only a
 * bounded slice is placed in the model context.
 */
function selectRelevantRecords(records, sourceMessages, bridgeMessages, budgetUnits, maxRecords = 64) {
  const sourceIds = new Set([...(sourceMessages ?? []), ...(bridgeMessages ?? [])].map((message) => message.id));
  const query = sourceText([...(sourceMessages ?? []), ...(bridgeMessages ?? [])]);
  const tokens = [...new Set(query.split(/[^\p{L}\p{N}_-]+/u).filter((token) => token.length > 1))];
  const selected = {};
  const modelCategories = DRAFT_CATEGORIES.filter((category) => category !== 'coverage');
  for (const category of modelCategories) selected[category] = [];
  let usedUnits = 0;
  const candidates = [];
  for (const category of modelCategories) {
    const values = records?.[category];
    if (!Array.isArray(values)) continue;
    values.forEach((record, index) => {
      const text = recordText(record);
      const hits = tokens.reduce((count, token) => count + (text.includes(token) ? 1 : 0), 0);
      const overlap = sourceOverlap(record, sourceIds) ? 1 : 0;
      const unresolved = ['unresolved', 'active', 'proposed', 'attempted'].includes(String(record?.state ?? record?.status ?? record?.lifecycleState ?? '').toLocaleLowerCase()) ? 0.25 : 0;
      candidates.push({ category, record, index, score: overlap * 100 + hits * 10 + unresolved, units: estimateUnits(stableStringify(record)) });
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.category.localeCompare(b.category) || a.index - b.index);
  const limit = Number.isFinite(budgetUnits) ? Math.max(0, budgetUnits) : Infinity;
  for (const candidate of candidates) {
    if (Object.values(selected).reduce((sum, value) => sum + value.length, 0) >= maxRecords) break;
    if (usedUnits + candidate.units > limit) continue;
    selected[candidate.category].push(clone(candidate.record));
    usedUnits += candidate.units;
  }
  return { records: selected, usedUnits, candidateCount: candidates.length, omittedCount: Math.max(0, candidates.length - Object.values(selected).reduce((sum, value) => sum + value.length, 0)) };
}

function contextIds(records) {
  const ids = new Set();
  for (const category of Object.keys(records ?? {})) {
    if (!Array.isArray(records[category])) continue;
    for (const record of records[category]) if (record?.id) ids.add(record.id);
  }
  for (const [from, to] of Object.entries(records?.idAliases ?? {})) { ids.add(from); ids.add(to); }
  return ids;
}

function defineModelAlias(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

/** P1 one-request-per-segment orchestration with atomic bundle commits. */
export class SummaryEngine {
  constructor({ model, repository, maxInputUnits = 12000, maxSourceUnits = null, outputReserveUnits = null, maxRelevantRecords = 64, requireFloorSummaries = false, now = () => Date.now() } = {}) {
    this.model = modelInvoker(model);
    if (!repository || typeof repository.commitBundle !== 'function') throw new ValidationError('SummaryEngine requires a MemoryRepository');
    this.repository = repository;
    // maxInputUnits is the complete serialized-request ceiling. A caller
    // that also needs small body chunks for continuation can opt into the
    // separate maxSourceUnits split quota without weakening that ceiling.
    this.maxInputUnits = maxInputUnits;
    this.requireFloorSummaries=requireFloorSummaries;
    this.maxSourceUnits = Number.isFinite(maxSourceUnits) && maxSourceUnits > 0 ? maxSourceUnits : null;
    this.outputReserveUnits = Number.isFinite(outputReserveUnits) ? Math.max(0, outputReserveUnits) : null;
    this.maxRelevantRecords = Math.max(1, Number(maxRelevantRecords) || 64);
    this.now = now;
    this.requestLog = [];
  }

  async _existingContext(scope, { sourceMessages = [], bridgeMessages = [], budgetUnits = Infinity, relevantRecords = null } = {}) {
    if (typeof this.repository.listRecords !== 'function') return { records: {}, authoritativeRecords: {}, ids: new Set(), selection: { usedUnits: 0, candidateCount: 0, omittedCount: 0 } };
    const authoritativeRecords = await this.repository.listRecords(scope);
    const ids = contextIds(authoritativeRecords);
    const selection = selectRelevantRecords(relevantRecords ?? authoritativeRecords, sourceMessages, bridgeMessages, budgetUnits, this.maxRelevantRecords);
    return { records: selection.records, authoritativeRecords, ids, selection };
  }

  async process(batch, { signal, relevantRecords = null, onProgress = null, onDiagnostic = () => {}, correctionAuthorizations = [] } = {}) {
    const emit=(phase,details={},level='info')=>{try{onDiagnostic({phase,level,details:safeLogDetails(details)});}catch{/* log failure must not affect a commit */}};
    const focus = focusGate(batch?.focusSpec);
    if (!focus.confirmed) {
      return {
        kind: 'SummaryJob',
        operationId: batch?.operationId,
        status: 'awaiting_focus',
        reason: 'focus_confirmation_required',
        focusSpec: clone(batch?.focusSpec),
        requests: 0,
        receipts: [],
        startedAt: this.now(),
      };
    }
    const children = splitSummaryBatch(batch, { maxInputUnits: this.maxSourceUnits ?? this.maxInputUnits });
    const splitPlan = children.map((child) => ({
      childIndex: child.childRange.childIndex,
      operationId: child.operationId,
      expectedRevision: child.expectedRevision,
      sourceRefs: sourceRefsFor(child),
      childRange: child.childRange,
    }));
    const splitPlanFingerprint = sha256(splitPlan);
    const checkpoint = typeof this.repository.getCheckpoint === 'function' ? await this.repository.getCheckpoint(batch.operationId, batch.scope) : null;
    const checkpointBinding = {
      scopeKey: stableStringify(batch.scope),
      sourceRevision: batch.sourceRevision,
      configVersion: String(batch.configVersion),
      rulesVersion: String(batch.rulesVersion),
      focusVersion: focusFingerprint(batch.focusSpec, batch.focusVersion),
      splitPlanFingerprint,
    };
    if (checkpoint && checkpointBinding.scopeKey !== checkpoint.scopeKey) {
      throw new ScopeConflictError('summary checkpoint scope differs from requested scope', { expected: checkpointBinding.scopeKey, actual: checkpoint.scopeKey });
    }
    if (checkpoint) {
      const mismatches = Object.entries(checkpointBinding).filter(([key, expected]) => checkpoint[key] !== undefined && checkpoint[key] !== expected).map(([key, expected]) => ({ key, expected, actual: checkpoint[key] }));
      if (mismatches.length) throw new ScopeConflictError('summary checkpoint binding does not match frozen batch', { mismatches });
    }
    const completed = new Set(checkpoint?.completedChildIndexes ?? []);
    if ([...completed].some((index) => !Number.isInteger(index) || index < 0 || index >= children.length)) {
      throw new ScopeConflictError('summary checkpoint contains an invalid child index', { completedChildIndexes: [...completed], totalChildren: children.length });
    }
    if (checkpoint && completed.size && Array.isArray(checkpoint.receipts) && typeof this.repository.getOperationReceipt === 'function') {
      for (const childIndex of completed) {
        const plan = splitPlan[childIndex];
        const receipt = checkpoint.receipts.find((item) => item?.operationId === plan.operationId);
        const persisted = await this.repository.getOperationReceipt(plan.operationId);
        if (!receipt || !persisted || persisted.scopeKey !== checkpointBinding.scopeKey || persisted.bundleHash !== receipt.bundleHash || persisted.committedRevision !== plan.expectedRevision + 1) {
          throw new ScopeConflictError('summary checkpoint completed child lacks a matching committed receipt', { childIndex, operationId: plan.operationId });
        }
      }
    } else if (checkpoint && completed.size && checkpoint.schemaVersion >= 2 && typeof this.repository.getOperationReceipt === 'function') {
      throw new ScopeConflictError('summary checkpoint completed children have no commit credentials');
    }
    const state = {
      kind: 'SummaryJob',
      operationId: batch.operationId,
      status: completed.size === children.length ? 'done' : 'running',
      parentRange: clone(batch.parentRange),
      totalChildren: children.length,
      completedChildren: [...completed].sort((a, b) => a - b),
      failedChildren: [],
      requests: 0,
      receipts: clone(checkpoint?.receipts ?? []),
      startedAt: this.now(),
    };
    if (completed.size === children.length) return state;
    for (const child of children) {
      const childIndex = child.childRange.childIndex;
      if (completed.has(childIndex)) continue;
      let phase='request';
      const started=this.now();
      const baseDetails={childIndex,startIndex:child.sourceMessages[0]?.index,endIndex:child.sourceMessages.at(-1)?.index,sourceCount:child.sourceMessages.length};
      try {
        throwIfAborted(signal);
        const focusForChild = focusGate(child.focusSpec);
        const wireFocusSpec = serializableFocusSpec(child.focusSpec);
        const effectiveRules = child.rules ?? child.focusSpec?.rules ?? child.focusSpec?.focusRules ?? null;
        const outputContract = clone(SUMMARY_OUTPUT_CONTRACT);
        const sourceUnits = estimateUnits(JSON.stringify(child.sourceMessages));
        const bridgeUnits = estimateUnits(JSON.stringify(child.bridgeMessages ?? []));
        const focusRules = { focusSpec: wireFocusSpec, focus: focusForChild.focus, rules: effectiveRules, configVersion: child.configVersion, rulesVersion: child.rulesVersion };
        const focusRulesUnits = estimateUnits(JSON.stringify(focusRules));
        const schemaUnits = estimateUnits(JSON.stringify(outputContract));
        const outputReserveUnits = Number.isFinite(child.budgets?.outputReserveUnits)
          ? Math.max(0, child.budgets.outputReserveUnits)
          : this.outputReserveUnits ?? Math.max(1, Math.ceil((Number(this.maxInputUnits) || 12000) * 0.2));
        // maxInputUnits is the complete serialized input-request ceiling.
        // Output reserve is separately reported because it is not part of the
        // serialized input payload measured immediately before adapter I/O.
        const explicitInputBudget = Number.isFinite(child.budgets?.inputUnits) && child.budgets.inputUnits >= 0;
        const configuredLimit = explicitInputBudget ? Number(child.budgets.inputUnits) : (Number(this.maxInputUnits) || 12000);
        const contentQuota = Math.max(0, configuredLimit - sourceUnits - bridgeUnits - focusRulesUnits - schemaUnits - 1500);
        const context = relevantRecords
          ? await this._existingContext(child.scope, { sourceMessages: child.sourceMessages, bridgeMessages: child.bridgeMessages, budgetUnits: contentQuota, relevantRecords })
          : await this._existingContext(child.scope, { sourceMessages: child.sourceMessages, bridgeMessages: child.bridgeMessages, budgetUnits: contentQuota });
        const committedRevision = typeof this.repository.getCommittedRevision === 'function' ? await this.repository.getCommittedRevision(child.scope) : child.expectedRevision;
        const budget = {
          limitUnits: configuredLimit,
          measurement: 'conservative_estimate_of_serialized_sections',
          strategy: context.selection.omittedCount > 0 ? 'bounded_partial_context' : 'bounded_context',
          status: sourceUnits + bridgeUnits + focusRulesUnits > configuredLimit ? 'fixed_sections_exceed_content_quota' : 'within_content_quota',
          overflowUnits: Math.max(0, sourceUnits + bridgeUnits + focusRulesUnits - configuredLimit),
          outputReserveUnits,
          sections: {
            source: sourceUnits,
            bridge: bridgeUnits,
            focusRules: focusRulesUnits,
            relevantRecords: context.selection.usedUnits,
            outputSchema: schemaUnits,
            outputReserve: outputReserveUnits,
          },
          usedInputUnits: sourceUnits + bridgeUnits + focusRulesUnits + context.selection.usedUnits,
          totalReservedUnits: sourceUnits + bridgeUnits + focusRulesUnits + context.selection.usedUnits + schemaUnits + outputReserveUnits,
          relevantRecordCount: Object.values(context.records).reduce((sum, values) => sum + (Array.isArray(values) ? values.length : 0), 0),
          omittedRelevantRecords: context.selection.omittedCount,
          contextTruncated: context.selection.omittedCount > 0,
        };
        const extractionContext = {
          kind: 'ExtractionContext',
          schemaVersion: 1,
          scope: clone(child.scope),
          committedRevision,
          sourceRevision: child.sourceRevision,
          configVersion: String(child.configVersion),
          rulesVersion: String(child.rulesVersion),
          focusVersion: focusFingerprint(child.focusSpec, child.focusVersion),
          focusSpec: clone(wireFocusSpec),
          focus: clone(focusForChild),
          rules: clone(effectiveRules),
          // Source bodies and selected records live once at request level.
          // Non-enumerable compatibility aliases are attached below for
          // function adapters without duplicating provider JSON.
          coverage: {
            sourceRefs: sourceRefsFor(child),
            bridgeRefs: evidenceRefsFor(child),
            relevantRecordIds: Object.values(context.records).flatMap((values) => (Array.isArray(values) ? values.map((record) => record?.id).filter(Boolean) : [])),
            relevantRecordCount: context.selection.candidateCount,
            omittedRelevantRecords: context.selection.omittedCount,
          },
          outputContract,
          budget,
        };
        const request = {
          kind: 'ShiyiSummaryRequest',
          instructions: makeInstructions(focusForChild, effectiveRules),
          scope: clone(child.scope),
          operationId: child.operationId,
          parentOperationId: batch.operationId,
          expectedRevision: child.expectedRevision,
          parentRange: clone(child.parentRange),
          childRange: clone(child.childRange),
          sourceMessages: clone(child.sourceMessages),
          bridgeMessages: clone(child.bridgeMessages ?? []),
          relevantRecords: clone(context.records),
          extractionContext,
        };
        // These aliases keep the existing local adapter contract ergonomic;
        // they are deliberately non-enumerable and therefore absent from the
        // serialized provider payload.  Each body/schema/context section is
        // transmitted exactly once.
        defineModelAlias(request, 'outputContract', extractionContext.outputContract);
        defineModelAlias(request, 'outputCategories', [...DRAFT_CATEGORIES]);
        defineModelAlias(request, 'focusSpec', extractionContext.focusSpec);
        defineModelAlias(request, 'focus', extractionContext.focus);
        defineModelAlias(request, 'rules', extractionContext.rules);
        defineModelAlias(request, 'budget', extractionContext.budget);
        defineModelAlias(extractionContext, 'sourceMessages', request.sourceMessages);
        defineModelAlias(extractionContext, 'bridgeMessages', request.bridgeMessages);
        defineModelAlias(extractionContext, 'relevantRecords', request.relevantRecords);
        // For a provider adapter this is the exact payload that will be sent,
        // including system/user messages and response format.  Measure that
        // serialized envelope at the last responsible moment and reject a
        // declared budget overflow before any adapter call.  The local
        // estimate is explicitly a bounded planning unit, not provider token
        // accounting or a claim about tokenizer behavior.
        // Optional previous memories must fit after the complete wire envelope,
        // not consume the room reserved for schema and source evidence.
        const wireUnits=()=>estimateUnits(JSON.stringify(typeof this.model.providerPayload==='function'?this.model.providerPayload(request):request));
        while(wireUnits()>configuredLimit){
          const entries=Object.entries(request.relevantRecords).filter(([,rows])=>Array.isArray(rows)&&rows.length);
          if(!entries.length)break;
          // Keep source-overlapping evidence ahead of merely optional history.
          const ids=new Set(child.sourceMessages.map(m=>m.id));
          const candidates=entries.flatMap(([category,rows])=>rows.map((record,index)=>({category,record,index,score:sourceOverlap(record,ids)?1:0})));
          candidates.sort((a,b)=>a.score-b.score||b.index-a.index);
          const removed=candidates[0];request.relevantRecords[removed.category].splice(removed.index,1);
          if(removed.category==='events')request.relevantRecords.awarenessChanges=(request.relevantRecords.awarenessChanges??[]).filter(a=>a.eventRef!==removed.record.id&&!(a.eventRefs??[]).includes(removed.record.id));
          const remaining=Object.values(request.relevantRecords).flatMap(rows=>Array.isArray(rows)?rows:[]);
          extractionContext.coverage.relevantRecordIds=remaining.map(r=>r.id);
          budget.relevantRecordCount=remaining.length;budget.omittedRelevantRecords=context.selection.candidateCount-remaining.length;
          extractionContext.coverage.omittedRelevantRecords=budget.omittedRelevantRecords;
          budget.contextTruncated=true;budget.strategy='bounded_partial_context';
          budget.sections.relevantRecords=estimateUnits(JSON.stringify(request.relevantRecords));
          budget.usedInputUnits=sourceUnits+bridgeUnits+focusRulesUnits+budget.sections.relevantRecords;
          budget.totalReservedUnits=budget.usedInputUnits+schemaUnits+outputReserveUnits;
        }
        if (typeof this.model.providerPayload === 'function') {
          budget.measurement = 'serialized_provider_payload_estimate_units';
          const providerPayload = this.model.providerPayload(request);
          const providerPayloadUnits = estimateUnits(JSON.stringify(providerPayload));
          // Keep the diagnostic local-only. It must not become an enumerable
          // field in the measured/final provider payload.
          defineModelAlias(budget, 'providerPayloadUnits', providerPayloadUnits);
          if (providerPayloadUnits > configuredLimit) {
            const error = new ValidationError('serialized provider request exceeds input budget', {
              code: 'INPUT_BUDGET_EXCEEDED',
              limitUnits: configuredLimit,
              providerPayloadUnits,
              outputReserveUnits,
              sections: budget.sections,
            });
            error.code = 'INPUT_BUDGET_EXCEEDED';
            throw error;
          }
        } else {
          budget.measurement = 'serialized_model_request_estimate_units';
          const serializedRequestUnits = estimateUnits(JSON.stringify(request));
          defineModelAlias(budget, 'serializedRequestUnits', serializedRequestUnits);
          if (serializedRequestUnits > configuredLimit) {
            const error = new ValidationError('serialized model request exceeds input budget', {
              code: 'INPUT_BUDGET_EXCEEDED',
              limitUnits: configuredLimit,
              serializedRequestUnits,
              outputReserveUnits,
              sections: budget.sections,
            });
            error.code = 'INPUT_BUDGET_EXCEEDED';
            throw error;
          }
        }
        this.requestLog.push({ operationId: child.operationId, parentOperationId: batch.operationId, childIndex, sourceIds: child.sourceMessages.map((message) => message.id) });
        state.requests += 1;
        emit('request',{...baseDetails,inputLimit:configuredLimit,inputUnits:wireUnits(),maxTokens:this.model.providerPayload?.(request)?.max_tokens??0});
        const raw = await this.model(request, { signal });
        throwIfAborted(signal);
        phase='response';
        const output = await parseModelResponse(raw,{onMetadata:metadata=>emit('response',{...baseDetails,...metadata,elapsedMs:this.now()-started})});
        ensureAllCategories(output);
        phase='validate';
        const sourceRefs = sourceRefsFor(child);
        const bundle = bindDraftBundle(output, {
          scope: child.scope,
          operationId: child.operationId,
          expectedRevision: child.expectedRevision,
          parentRange: child.parentRange,
          childRange: child.childRange,
          sourceRefs: evidenceRefsFor(child),
          sourceFloorIndices: [...child.sourceMessages,...child.bridgeMessages].map(m=>({sourceId:m.id,fragmentId:m.fragmentId,index:m.index})),
          sourceTexts: [...child.sourceMessages,...child.bridgeMessages].map(m=>({sourceId:m.id,fragmentId:m.fragmentId,text:m.text})),
          sourceRevision: child.sourceRevision,
          configVersion: child.configVersion,
          rulesVersion: child.rulesVersion,
          focusVersion: focusFingerprint(child.focusSpec, child.focusVersion),
          correctionAuthorizations,
        });
        if(this.requireFloorSummaries){
          phase='floors';
          const details=requireIndependentFloorSummaries(bundle,child.sourceMessages);
          emit('floors',{...baseDetails,...details},'success');
        }
        phase='validate';emit('validate',baseDetails);
        // The host freezes what was submitted; the model still has to report
        // which of those refs it processed.  Overwriting processed here would
        // make an explicit unprocessed gap look complete.
        bundle.coverage.sourceRefs = clone(sourceRefs);
        const validation = validateDraftBundle(bundle, {
          expectedBinding: { scope: child.scope, operationId: child.operationId, expectedRevision: child.expectedRevision },
          allowedSourceIds: new Set([...child.sourceMessages, ...child.bridgeMessages].map((message) => message.id)),
          knownRecordIds: context.ids ?? new Set(),
          existingFacts: context.authoritativeRecords?.entityFactChanges ?? [],
          expectedSourceRefs: sourceRefs,
          enforceCorrectionAuthority: true,
          trustedCorrectionIds: correctionAuthorizations,
          newSourceIds: child.sourceMessages.map((message) => message.id),
        });
        if (!validation.valid) throw new ValidationError('summary DraftBundle failed validation', validation);
        const coverage = coverageState(bundle.coverage, sourceRefs);
        if (!coverage.complete) {
          const incomplete = new ValidationError('summary coverage is incomplete; unprocessed source range must be resumed', { coverage });
          incomplete.code = 'COVERAGE_INCOMPLETE';
          throw incomplete;
        }
        throwIfAborted(signal);
        phase='commit';emit('commit',baseDetails);
        const receipt = await this.repository.commitBundle(bundle, { scope: child.scope, expectedRevision: child.expectedRevision, sourceRevision: child.sourceRevision });
        state.receipts.push(receipt);
        completed.add(childIndex);
        state.completedChildren = [...completed].sort((a, b) => a - b);
        if (typeof this.repository.saveCheckpoint === 'function') await this.repository.saveCheckpoint(batch.operationId, {
          status: 'running',
          scope: clone(batch.scope),
          sourceRevision: batch.sourceRevision,
          configVersion: String(batch.configVersion),
          rulesVersion: String(batch.rulesVersion),
          focusVersion: checkpointBinding.focusVersion,
          splitPlanFingerprint,
          splitPlan: clone(splitPlan),
          parentRange: clone(batch.parentRange),
          completedChildIndexes: state.completedChildren,
          failedChildIndexes: state.failedChildren,
          totalChildren: children.length,
          receipts: clone(state.receipts),
        });
        if (typeof onProgress === 'function') await onProgress(clone(state));
      } catch (error) {
        emit(phase,{...baseDetails,...safeLogDetails(error?.details),code:signal?.aborted?'CANCELED':error?.code,elapsedMs:this.now()-started},signal?.aborted?'warning':'error');
        if (error?.name === 'AbortError' || error?.code === 'CANCELED' || signal?.aborted) {
          state.status = 'canceled';
          state.canceledChild = childIndex;
          if (typeof this.repository.saveCheckpoint === 'function') await this.repository.saveCheckpoint(batch.operationId, {
            status: 'canceled', scope: clone(batch.scope), sourceRevision: batch.sourceRevision, configVersion: String(batch.configVersion), rulesVersion: String(batch.rulesVersion), focusVersion: checkpointBinding.focusVersion, splitPlanFingerprint, splitPlan: clone(splitPlan), completedChildIndexes: [...completed].sort((a, b) => a - b), failedChildIndexes: state.failedChildren, totalChildren: children.length, receipts: clone(state.receipts),
          });
          throw (error?.name === 'AbortError' ? error : abortError());
        }
        if (error?.code === 'COVERAGE_INCOMPLETE') {
          state.status = 'partial';
          state.partialChild = childIndex;
          state.unprocessedChildren = [...new Set([...(state.unprocessedChildren ?? []), childIndex])];
          if (typeof this.repository.saveCheckpoint === 'function') await this.repository.saveCheckpoint(batch.operationId, {
            status: 'partial', scope: clone(batch.scope), sourceRevision: batch.sourceRevision, configVersion: String(batch.configVersion), rulesVersion: String(batch.rulesVersion), focusVersion: checkpointBinding.focusVersion, splitPlanFingerprint, splitPlan: clone(splitPlan), parentRange: clone(batch.parentRange), completedChildIndexes: [...completed].sort((a, b) => a - b), failedChildIndexes: state.failedChildren, partialChildIndexes: state.unprocessedChildren, totalChildren: children.length, receipts: clone(state.receipts), coverage: clone(error.details?.coverage ?? null),
          });
          throw error;
        }
        state.status = 'failed';
        state.failedChildren.push(childIndex);
        if (typeof this.repository.saveCheckpoint === 'function') await this.repository.saveCheckpoint(batch.operationId, {
          status: 'failed', scope: clone(batch.scope), sourceRevision: batch.sourceRevision, configVersion: String(batch.configVersion), rulesVersion: String(batch.rulesVersion), focusVersion: checkpointBinding.focusVersion, splitPlanFingerprint, splitPlan: clone(splitPlan), completedChildIndexes: [...completed].sort((a, b) => a - b), failedChildIndexes: state.failedChildren, totalChildren: children.length, receipts: clone(state.receipts), error: { code: error.code, message: error.message },
        });
        throw error;
      }
    }
    state.status = 'done';
    state.completedAt = this.now();
    if (typeof this.repository.saveCheckpoint === 'function') await this.repository.saveCheckpoint(batch.operationId, {
      status: 'done', scope: clone(batch.scope), sourceRevision: batch.sourceRevision, configVersion: String(batch.configVersion), rulesVersion: String(batch.rulesVersion), focusVersion: checkpointBinding.focusVersion, splitPlanFingerprint, splitPlan: clone(splitPlan), parentRange: clone(batch.parentRange), completedChildIndexes: state.completedChildren, failedChildIndexes: [], totalChildren: children.length, receipts: clone(state.receipts),
    });
    return state;
  }

  async run(batch, options = {}) { return this.process(batch, options); }
  async summarize(batch, options = {}) { return this.process(batch, options); }
}

export { parseModelResponse };
