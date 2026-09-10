import {
  createSummaryBatch,
  splitSummaryBatch,
  bindDraftBundle,
  SUMMARY_OUTPUT_CONTRACT,
} from './contracts.js';
import { MemoryRepository } from './repository.js';
import { LocalBM25Index, retrieveAndPack } from './retrieval.js';
import { SummaryEngine } from './summary-engine.js';
import { HostAdapter } from './host-adapter.js';
import { productFailure } from './product-feedback.js';
import { safeLogDetails } from './product-runtime-log.js';
import { verifyProductSources } from './product-sources.js';
import { makeId, clone, stableStringify, sha256, estimateUnits } from './utils.js';
import {
  captureProductHostSession,
  createProductTransport,
  productStoreFromSession,
  readProductHostRange,
  safeProductError,
} from './product-host-adapters.js';
import {
  PRODUCT_SETTINGS_VERSION,
  defaultProductSettings,
  listProductSettings,
  normalizeProductSettings,
  persistedProductSettings,
  productSettingConsumers,
  splitProductSettings,
  validateProductPatch,
} from './product-settings.js';

export const PRODUCT_MEMORY_NAMESPACE = 'shiyi-product-memory';
export const PRODUCT_SETTINGS_NAMESPACE = 'shiyi-product-settings';
export const PRODUCT_SETTINGS_KEY = 'current';

export const PRODUCT_SHELL_STATUS = Object.freeze({
  IDLE: 'idle',
  UNBOUND: 'unbound',
  READY: 'ready',
  READING: 'reading',
  AWAITING_FOCUS: 'awaiting_focus',
  RUNNING: 'running',
  SAVED: 'saved',
  CANCELED: 'canceled',
  INVALIDATED: 'invalidated',
  FAILED: 'failed',
  UNAVAILABLE: 'unavailable',
});

const PRODUCT_EVENT_NAMES = Object.freeze([
  'CHAT_CHANGED',
  'MESSAGE_EDITED',
  'MESSAGE_UPDATED',
  'MESSAGE_SWIPED',
  'MESSAGE_DELETED',
  'MESSAGE_SWIPE_DELETED',
]);

function text(value) { return typeof value === 'string' ? value.trim() : ''; }

function errorCode(error, fallback = 'PROVIDER_REQUEST_FAILED') {
  return safeProductError(error, fallback);
}

function noSecretSettings(settings) {
  const result = persistedProductSettings(settings);
  delete result.providerApiKey;
  return result;
}

function sourceRefs(records = []) {
  return records.map((message) => ({ sourceId: message.id, version: message.version, hash: message.hash, contentHash: message.contentHash }));
}

function eventDependencies(events, awareness, commitments) {
  return events.map((event) => {
    const ids = new Set([event.id]);
    const eventAwareness = awareness.filter((item) => ids.has(item?.eventRef) || (item?.eventRefs ?? []).some((id) => ids.has(id)));
    const followUps = commitments.filter((item) => ids.has(item?.eventRef) || (item?.eventRefs ?? []).some((id) => ids.has(id)));
    return {
      ...clone(event),
      awareness: clone(eventAwareness),
      awarenessChanges: clone(eventAwareness),
      temporal: clone(event.temporal ?? event.storyTime ?? event.time ?? { kind: 'unknown' }),
      followUps: clone(followUps),
      lifecycleDependencies: clone(followUps),
    };
  });
}

function summaryCounts(records) {
  return {
    eventCount: Array.isArray(records?.events) ? records.events.length : 0,
    awarenessCount: Array.isArray(records?.awarenessChanges) ? records.awarenessChanges.length : 0,
    entityFactCount: Array.isArray(records?.entityFactChanges) ? records.entityFactChanges.length : 0,
    relationshipCount: Array.isArray(records?.relationshipChanges) ? records.relationshipChanges.length : 0,
    personaCount: Array.isArray(records?.personaChanges) ? records.personaChanges.length : 0,
    commitmentCount: Array.isArray(records?.commitmentChanges) ? records.commitmentChanges.length : 0,
    summaryViewCount: Array.isArray(records?.summaryView) ? records.summaryView.length : 0,
  };
}

function cloneState(state) {
  return {
    schemaVersion: state.schemaVersion,
    kind: state.kind,
    status: state.status,
    activePage: state.activePage,
    closed: Boolean(state.closed),
    scope: clone(state.scope),
    session: state.session ? {
      status: 'ready',
      identityReady: true,
      scopeKind: 'chat-bound',
      hasStore: Boolean(state.session.handle?.store),
    } : null,
    range: clone(state.range),
    sourceMessages: clone(state.sourceMessages),
    sourceRevision: state.sourceRevision,
    focus: state.focus,
    focusConfirmed: state.focusConfirmed,
    draft: clone(state.draft),
    lastSaved: clone(state.lastSaved),
    lastPreview: clone(state.lastPreview),
    errorCode: state.errorCode,
    errorMessage: state.errorMessage,
    settings: clone(state.settings),
    settingsStatus: state.settingsStatus,
    injection: clone(state.injection),
    capabilities: clone(state.capabilities),
    job: clone(state.job),
  };
}

/**
 * The executable product session behind the four-navigation UI.  The
 * constructor is deliberately inert: no HostAdapter, current chat, history,
 * store, event subscription, provider, or model is touched until the user
 * invokes bindCurrentChat/readRange/startSummary.
 */
export function createProductShellController({
  host = globalThis,
  adapter = null,
  adapterFactory = (value) => new HostAdapter(value),
  model = null,
  modelFactory = null,
  transportFactory = createProductTransport,
  fetchImpl = globalThis.fetch,
  settings = {},
  accountId = null,
  branchId = null,
  now = () => Date.now(),
  eventNames = PRODUCT_EVENT_NAMES,
  maxMessages = 200,
  onChange = () => {},
  runtimeRules = () => '',
  summaryBundleValidator = () => () => {},
  shouldInvalidate = () => true,
} = {}) {
  let adapterInstance = adapter;
  let bindingPromise = null;
  let activeTask = null;
  let destroyed = false;
  let generation = 0;
  let subscriptions = [];
  let settingsLoaded = false;
  let globalApiSettings = null, legacyApiSettings = {}, legacySettings = {};
  let sessionStore = null;
  let repository = null;
  let engine = null;
  let transport = null;
  let abortController = null;
  let manualOperation = null;

  const state = {
    schemaVersion: 1,
    kind: 'ProductShellSession',
    status: PRODUCT_SHELL_STATUS.IDLE,
    activePage: 'memory',
    scope: null,
    session: null,
    range: null,
    sourceMessages: [],
    sourceRevision: null,
    focus: '',
    focusConfirmed: false,
    draft: { range: null, focus: '', focusConfirmed: false, status: 'empty' },
    lastSaved: null,
    lastPreview: null,
    errorCode: null,
    errorMessage: null,
    settings: normalizeProductSettings(settings, { includeSessionSecret: false }),
    settingsStatus: 'defaults',
    injection: { enabled: false, status: 'disabled', reason: 'formal generation hook is not available in this shell' },
    capabilities: {
      identity: 'not_bound',
      persistence: 'not_checked',
      summary: 'not_started',
      localRecall: 'available',
      vectorRecall: 'disabled_no_adapter',
      rerank: 'disabled_no_adapter',
      distributed: 'registered_no_transport',
    },
    job: null,
  };

  function mark(status, code = null, message = null) {
    state.status = status;
    state.errorCode = code;
    state.errorMessage = message;
    try { onChange({ status, code, message }); } catch { /* UI cannot break a transaction. */ }
  }

  function currentToken() { return generation; }
  function cleanMessages(messages) {
    const tags = String(state.settings.excludedTags ?? '').split(/[,，]/).map(s=>s.trim()).filter(s=>/^[A-Za-z][\w-]*$/.test(s));
    return messages.map(message=>{let body=message.text;for(const tag of tags)body=body.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`,'gi'),'');return {...message,text:body};});
  }
  function tokenValid(token, session = state.session) { return !destroyed && token === generation && session && state.session === session; }

  async function removeSubscriptions() {
    const pending = subscriptions.splice(0);
    const failures = [];
    for (const remove of pending) {
      try { await remove(); } catch { failures.push(remove); }
    }
    subscriptions.push(...failures);
    return failures.length;
  }

  function invalidate(reason = 'MESSAGE_UPDATED', code = 'SOURCE_INVALIDATED') {
    generation += 1;
    if (abortController && !abortController.signal.aborted) abortController.abort(reason);
    abortController = null;
    activeTask = null;
    state.job = null;
    state.lastSaved = null;
    state.lastPreview = null;
    state.draft.status = 'stale';
    if (reason === 'CHAT_CHANGED') {
      state.capabilities.identity = 'changed';
      mark(PRODUCT_SHELL_STATUS.INVALIDATED, 'CHAT_CHANGED', '聊天已切换，请重新绑定后读取。');
    } else {
      mark(PRODUCT_SHELL_STATUS.INVALIDATED, code, '所选正文已变化，请重新读取范围后重试。');
    }
  }

  function subscribeInvalidation(session) {
    if (typeof adapterInstance?.subscribe !== 'function') {
      state.capabilities.events = 'unavailable';
      return;
    }
    for (const eventName of eventNames) {
      try {
        const listener = () => {
          if (state.session !== session || !shouldInvalidate(eventName)) return;
          invalidate(eventName === 'CHAT_CHANGED' ? 'CHAT_CHANGED' : eventName, eventName === 'CHAT_CHANGED' ? 'CHAT_CHANGED' : 'SOURCE_INVALIDATED');
        };
        const remove = adapterInstance.subscribe(eventName, listener);
        if (typeof remove === 'function') subscriptions.push(remove);
        else if (remove && typeof remove.unsubscribe === 'function') subscriptions.push(() => remove.unsubscribe());
      } catch {
        state.capabilities.events = 'partial_unavailable';
      }
    }
    if (subscriptions.length) state.capabilities.events = 'subscribed';
  }

  async function loadSettings(store) {
    if (settingsLoaded) return;
    settingsLoaded = true;
    try {
      const found = typeof store.tryGetJson === 'function'
        ? await store.tryGetJson({ namespace: PRODUCT_SETTINGS_NAMESPACE, key: settingsKey() })
        : { found: true, value: await store.getJson({ namespace: PRODUCT_SETTINGS_NAMESPACE, key: settingsKey() }) };
      legacyApiSettings = found?.found ? splitProductSettings(found.value??{}).api : {};
      legacySettings = found?.found ? Object.fromEntries(Object.entries(found.value??{}).filter(([key])=>key in persistedProductSettings())) : {};
      if (found?.found && found.value) state.settings = normalizeProductSettings(found.value, { includeSessionSecret: false });
      if (globalApiSettings) Object.assign(state.settings,globalApiSettings);
      state.settingsStatus = found?.found ? 'readback_verified' : 'defaults_unpersisted';
    } catch {
      state.settingsStatus = 'unavailable';
      state.capabilities.persistence = 'unavailable';
    }
  }

  function settingsKey() { return `${PRODUCT_SETTINGS_KEY}-${sha256(state.scope).slice(0, 24)}`; }

  function sourceSplitUnits(){return Math.max(256,Math.floor((state.settings.inputBudgetUnits-estimateUnits(JSON.stringify(SUMMARY_OUTPUT_CONTRACT))-estimateUnits(state.settings.recordingRules)-2000)/2.5));}

  function createRepository(session, store) {
    repository = new MemoryRepository({
      store,
      namespace: PRODUCT_MEMORY_NAMESPACE,
      now,
      verifySourceRevision: async ({ bundle }) => {
        if (manualOperation && bundle.operationId === manualOperation.id && tokenValid(manualOperation.token, session)) return manualOperation.sourceRevision;
        const selected = state.range;
        if (!selected || state.session !== session || destroyed || !activeTask || abortController?.signal.aborted) return null;
        try {
          if(stableStringify(await adapterInstance.currentRef())!==session.refKey)return null;
          const current = await readProductHostRange(session, { ...selected, maxMessages });
          if(stableStringify(await adapterInstance.currentRef())!==session.refKey)return null;
          const batch = createSummaryBatch({
            scope: session.scope,
            operationId: state.job?.operationId ?? bundle.operationId,
            expectedRevision: bundle.expectedRevision,
            messages: cleanMessages(current.messages),
            requestedRange: current.requestedRange,
            focusSpec: state.job?.focusSpec ?? null,
            inputBudget: state.settings.inputBudgetUnits,
            outputBudget: state.settings.outputBudgetUnits,
            outputReserveUnits: 0,
            recordingRules: state.settings.recordingRules,
          });
          const children = splitSummaryBatch(batch, { maxInputUnits: state.job?.splitUnits??sourceSplitUnits() });
          return children.find((child) => child.operationId === bundle.operationId)?.sourceRevision ?? batch.sourceRevision;
        } catch {
          return null;
        }
      },
    });
    return repository;
  }

  async function bindCurrentChat(options = {}) {
    if (destroyed) return { status: PRODUCT_SHELL_STATUS.FAILED, errorCode: 'HOST_CONTRACT_INVALID' };
    if (bindingPromise) return bindingPromise;
    const pending = (async () => {
      const matchesExpected=ref=>options.expectedRef===undefined||stableStringify(ref)===stableStringify(options.expectedRef);
      if (state.session) {
        // A repeated bind is idempotent while it points at the same captured
        // session.  A changed host chat is intentionally not guessed here.
        try {
          adapterInstance ??= adapterFactory(host);
          const currentRef = await adapterInstance.currentRef();
          if (matchesExpected(currentRef) && state.session.refKey === stableStringify(currentRef) && state.status !== PRODUCT_SHELL_STATUS.INVALIDATED) return { status: 'ready', identityReady: true, persistence: repository ? 'available' : 'unavailable' };
        } catch { /* continue with a fresh explicit bind */ }
        await removeSubscriptions();
        invalidate('CHAT_CHANGED', 'CHAT_CHANGED');
        state.session = null;
        state.scope = null;
        settingsLoaded = false;
        state.settings = normalizeProductSettings({...settings,...globalApiSettings}, { includeSessionSecret: false });
        legacyApiSettings = {};
        state.range = null;
        state.sourceMessages = [];
        state.sourceRevision = null;
        state.focus = '';
        state.focusConfirmed = false;
        state.draft = { range: null, focus: '', focusConfirmed: false, status: 'empty' };
        transport = null;
        repository = null;
        sessionStore = null;
      }
      adapterInstance ??= adapterFactory(host);
      try {
        const session = await captureProductHostSession(adapterInstance, { accountId: options.accountId ?? accountId, branchId: options.branchId ?? branchId });
        if(!matchesExpected(session.ref))throw Object.assign(new Error('聊天已切换'),{code:'CHAT_CHANGED'});
        state.session = session;
        state.scope = clone(session.scope);
        state.capabilities.identity = 'ready';
        let store = null;
        try { store = productStoreFromSession(session); } catch {
          state.capabilities.persistence = 'unavailable';
          state.settingsStatus = 'unavailable';
        }
        sessionStore = store;
        if (store) {
          state.capabilities.persistence = 'available';
          createRepository(session, store);
          await loadSettings(store);
        }
        const finalRef=await adapterInstance.currentRef();
        if(!matchesExpected(finalRef)||stableStringify(finalRef)!==session.refKey)throw Object.assign(new Error('读取期间聊天已切换'),{code:'CHAT_CHANGED'});
        subscribeInvalidation(session);
        mark(PRODUCT_SHELL_STATUS.READY);
        state.draft.status = state.range ? 'ready' : 'empty';
        return { status: 'ready', identityReady: true, persistence: store ? 'available' : 'unavailable' };
      } catch (error) {
        state.session = null;
        state.scope = null;
        repository = null;
        sessionStore = null;
        const code = errorCode(error, error?.code === 'PERSISTENCE_UNAVAILABLE' ? 'PERSISTENCE_UNAVAILABLE' : 'CHAT_IDENTITY_NOT_READY');
        state.capabilities.identity = code === 'CHAT_IDENTITY_NOT_READY' ? 'not_ready' : 'unavailable';
        if (code === 'PERSISTENCE_UNAVAILABLE') state.capabilities.persistence = 'unavailable';
        mark(code === 'PERSISTENCE_UNAVAILABLE' ? PRODUCT_SHELL_STATUS.UNAVAILABLE : PRODUCT_SHELL_STATUS.FAILED, code, code === 'CHAT_IDENTITY_NOT_READY' ? '当前聊天身份尚未就绪，请先保存聊天后重试。' : '当前聊天暂不可用。');
        return { status: state.status, errorCode: code };
      }
    })();
    const wrapped = pending.finally(() => { if (bindingPromise === wrapped) bindingPromise = null; });
    bindingPromise = wrapped;
    return wrapped;
  }

  async function readRange(options = {}) {
    if (!state.session) return { status: PRODUCT_SHELL_STATUS.UNBOUND, errorCode: 'CHAT_IDENTITY_NOT_READY' };
    if (activeTask) return { status: PRODUCT_SHELL_STATUS.FAILED, errorCode: 'HOST_CONTRACT_INVALID' };
    const session = state.session;
    const token = currentToken();
    const liveRef = await adapterInstance.currentRef();
    if (!tokenValid(token, session) || stableStringify(liveRef) !== session.refKey) return { status: 'invalidated', errorCode: 'CHAT_CHANGED' };
    mark(PRODUCT_SHELL_STATUS.READING);
    try {
      const range = await readProductHostRange(session, {
        count: options.count ?? state.settings.messageCount,
        startIndex: options.startIndex,
        endIndex: options.endIndex,
        maxMessages,
      });
      if (!tokenValid(token, session)) return { status: state.status, errorCode: state.errorCode };
      if(stableStringify(await adapterInstance.currentRef())!==session.refKey)return {status:'invalidated',errorCode:'CHAT_CHANGED'};
      const batch = createSummaryBatch({
        scope: session.scope,
        operationId: 'preview-range',
        expectedRevision: repository ? await repository.getCommittedRevision(session.scope) : 0,
        messages: cleanMessages(range.messages),
        requestedRange: range.requestedRange,
        inputBudget: state.settings.inputBudgetUnits,
        outputBudget: state.settings.outputBudgetUnits,
        outputReserveUnits: 0,
        recordingRules: state.settings.recordingRules,
      });
      if (!tokenValid(token, session)) return { status: state.status, errorCode: state.errorCode };
      state.range = {
        count: range.messages.length,
        startIndex: range.requestedRange.startIndex,
        endIndex: range.requestedRange.endIndex,
        mode: options.startIndex !== undefined || options.endIndex !== undefined ? 'explicit_range' : 'recent_n',
      };
      state.sourceMessages = cleanMessages(range.messages);
      state.sourceRevision = batch.sourceRevision;
      state.draft.range = clone(state.range);
      state.draft.status = 'ready';
      state.draft.focus = state.focus;
      state.draft.focusConfirmed = state.focusConfirmed;
      mark(PRODUCT_SHELL_STATUS.READY);
      return { status: 'ready', count: range.messages.length, range: clone(state.range), sourceRevision: batch.sourceRevision };
    } catch (error) {
      if (!tokenValid(token, session)) return { status: state.status, errorCode: state.errorCode };
      const code = errorCode(error, 'HISTORY_UNAVAILABLE');
      mark(PRODUCT_SHELL_STATUS.FAILED, code, code === 'SOURCE_INVALIDATED' ? '所选正文已变化。' : '聊天范围读取失败。');
      return { status: PRODUCT_SHELL_STATUS.FAILED, errorCode: code };
    }
  }

  function setFocus(value, { confirmed = false } = {}) {
    state.focus = text(value);
    state.focusConfirmed = confirmed === true;
    state.draft.focus = state.focus;
    state.draft.focusConfirmed = state.focusConfirmed;
    return { status: 'drafted', focusSet: Boolean(state.focus), confirmed: state.focusConfirmed };
  }

  function makeModel() {
    if (model) return model;
    if (typeof modelFactory === 'function') return modelFactory({ transport, settings: clone(state.settings) });
    if (transport?.status === 'ready') return transport.model;
    return null;
  }

  async function startSummary({ focus = state.focus, confirmedFocus = state.focusConfirmed, trigger = 'manual', requireFloorSummaries = false, operationId = makeId('product-summary'), resume = false, excludeOperations = [], onDiagnostic = () => {} } = {}) {
    if (state.status === PRODUCT_SHELL_STATUS.INVALIDATED) return { status: state.status, errorCode: state.errorCode };
    if (!state.session || !repository) return { status: PRODUCT_SHELL_STATUS.UNAVAILABLE, errorCode: state.capabilities.persistence === 'unavailable' ? 'PERSISTENCE_UNAVAILABLE' : 'CHAT_IDENTITY_NOT_READY' };
    if (activeTask) return { status: PRODUCT_SHELL_STATUS.FAILED, errorCode: 'HOST_CONTRACT_INVALID' };
    if (!Array.isArray(state.sourceMessages) || state.sourceMessages.length === 0) return { status: PRODUCT_SHELL_STATUS.FAILED, errorCode: 'HISTORY_UNAVAILABLE' };
    const mode = state.settings.focusMode;
    const normalizedFocus = text(focus);
    state.focus = normalizedFocus;
    state.focusConfirmed = confirmedFocus === true;
    const needsConfirmation = mode === 'ask_every' || (mode === 'ask_manual' && trigger === 'manual');
    if (needsConfirmation && confirmedFocus !== true) {
      mark(PRODUCT_SHELL_STATUS.AWAITING_FOCUS, 'FOCUS_REQUIRED', '填写侧重点，或选择按现有偏好开始。');
      return { status: PRODUCT_SHELL_STATUS.AWAITING_FOCUS, errorCode: 'FOCUS_REQUIRED' };
    }
    let summaryModel;
    if (!model && !modelFactory) {
      const profile = {
        providerEndpoint: state.settings.providerEndpoint,
        providerEndpointMode: state.settings.providerEndpointMode,
        providerModel: state.settings.providerModel,
        providerAuthMode: state.settings.providerAuthMode,
        deadlineMs: state.settings.deadlineMs,
        outputBudgetUnits: state.settings.outputBudgetUnits,
      };
      transport = transportFactory(profile, { sessionApiKey: state.sessionApiKey ?? '', fetchImpl });
    }
    summaryModel = makeModel();
    if (!summaryModel) {
      mark(PRODUCT_SHELL_STATUS.UNAVAILABLE, 'MODEL_UNAVAILABLE', '尚未配置可用的总结传输或模型。');
      state.capabilities.summary = 'unavailable';
      return { status: PRODUCT_SHELL_STATUS.UNAVAILABLE, errorCode: 'MODEL_UNAVAILABLE' };
    }
    const session = state.session;
    const token = currentToken();
    let expectedRevision = await repository.getCommittedRevision(state.scope);
    if (!tokenValid(token, session)) return { status: state.status, errorCode: state.errorCode };
    const focusSpec = { mode: needsConfirmation ? mode : 'inherit', confirmed: true, focus: normalizedFocus || null };
    let batch = createSummaryBatch({
      scope: state.scope,
      operationId,
      expectedRevision,
      messages: cleanMessages(state.sourceMessages),
      requestedRange: { startIndex: state.range.startIndex, endIndex: state.range.endIndex },
      focusSpec,
      configVersion: String(PRODUCT_SETTINGS_VERSION),
      rulesVersion: 'product-shell-1',
      inputBudget: state.settings.inputBudgetUnits,
      outputBudget: state.settings.outputBudgetUnits,
      outputReserveUnits: 0,
      recordingRules: [state.settings.recordingRules, runtimeRules()].filter(Boolean).join('\n'),
      trigger,
    });
    const preflightAbort=new AbortController();abortController=preflightAbort;activeTask=operationId;
    state.draft={range:clone(state.range),focus:normalizedFocus,status:'running'};
    let frozen;
    try{
    frozen=resume?await repository.readPrivateTask(state.scope,operationId):null;
    if(resume&&!frozen?.batch)throw Object.assign(new Error('没有可续跑的暂存任务，请重新生成'),{code:'RESUME_UNAVAILABLE'});
    if(frozen?.batch){
      const old=frozen.batch;
      if(old.sourceRevision!==batch.sourceRevision||stableStringify(old.focusSpec)!==stableStringify(batch.focusSpec)||stableStringify(old.rules)!==stableStringify(batch.rules))throw Object.assign(new Error('本批原文或记录规则已变化，请重新生成；未复用过期结果'),{code:'SOURCE_INVALIDATED'});
      batch=old;expectedRevision=old.expectedRevision;
    }else await repository.savePrivateTask(state.scope,operationId,{batch,splitUnits:sourceSplitUnits()});
      if(preflightAbort.signal.aborted||!tokenValid(token,session))throw Object.assign(new Error('任务已停止'),{code:'CANCELED'});
    }catch(error){
      if(activeTask===operationId){activeTask=null;abortController=null;}
      if(preflightAbort.signal.aborted||!tokenValid(token,session))return {status:PRODUCT_SHELL_STATUS.CANCELED,errorCode:'CANCELED',operationId};
      mark(PRODUCT_SHELL_STATUS.FAILED,errorCode(error,'PERSISTENCE_ERROR'),'任务暂存未完成，原文与侧重点保留。');
      state.draft={range:clone(state.range),focus:normalizedFocus,status:'retryable'};
      return {status:PRODUCT_SHELL_STATUS.FAILED,errorCode:error.code??'PERSISTENCE_ERROR',failure:productFailure(error),errorDetails:safeLogDetails(errorDiagnostics(error)),operationId};
    }
    abortController = preflightAbort;
    activeTask = operationId;
    state.job = { operationId, focusSpec: clone(focusSpec), startedAt: now(), sourceRevision: batch.sourceRevision, splitUnits:frozen?.splitUnits??sourceSplitUnits() };
    state.draft = { range: clone(state.range), focus: normalizedFocus, focusConfirmed: confirmedFocus === true, status: 'running' };
    mark(PRODUCT_SHELL_STATUS.RUNNING);
    state.capabilities.summary = 'running';
    const summaryRepository=Object.create(repository);
    const validateBundle=summaryBundleValidator();
    summaryRepository.commitBundle=async (...args)=>{validateBundle(args[0]);return repository.commitBundle(...args);};
    summaryRepository.listRecords=async scope=>(await repository.readScope(scope,{includeOperations:[operationId],excludeOperations})).records;
    engine = new SummaryEngine({ repository: summaryRepository, model: summaryModel, maxInputUnits: state.settings.inputBudgetUnits, maxSourceUnits: state.job.splitUnits, requireFloorSummaries, stageCrossBatchMerges:true, recoveryEnabled:true, outputReserveUnits: 0, now });
    try {
      const result = await engine.process(batch, { signal: abortController.signal, onDiagnostic });
      if (!tokenValid(token, session)) return { status: state.status, errorCode: state.errorCode };
      const snapshot = await repository.readScope(session.scope);
      if (!tokenValid(token, session)) return { status: state.status, errorCode: state.errorCode };
      if (!snapshot || snapshot.committedRevision <= expectedRevision) throw Object.assign(new Error('persistence readback did not advance'), { code: 'PERSISTENCE_ERROR' });
      state.lastSaved = {
        committedRevision: snapshot.committedRevision,
        sourceRevision: batch.sourceRevision,
        range: clone(state.range),
        counts: summaryCounts(snapshot.records),
        awarenessIndivisible: true,
        savedAt: now(),
        source: 'committed-snapshot',
        events: clone(snapshot.records.events),
        awarenessChanges: clone(snapshot.records.awarenessChanges),
        temporal: clone(snapshot.records.events.map((event) => event.temporal ?? event.storyTime ?? event.time ?? { kind: 'unknown' })),
      };
      state.draft.status = 'saved';
      state.capabilities.summary = 'saved_readback_verified';
      mark(PRODUCT_SHELL_STATUS.SAVED);
      state.job = { ...state.job, status: result.status, requests: result.requests, completedAt: now() };
      return { status: PRODUCT_SHELL_STATUS.SAVED, operationId, requests: result.requests, committedRevision: snapshot.committedRevision, counts: clone(state.lastSaved.counts) };
    } catch (error) {
      if (!tokenValid(token, session)) return { status: state.status, errorCode: state.errorCode, operationId };
      if (abortController?.signal.aborted || error?.code === 'CANCELED' || error?.name === 'AbortError') {
        if (token !== generation) return { status: state.status, errorCode: state.errorCode, operationId };
        if (token === generation) mark(PRODUCT_SHELL_STATUS.CANCELED, 'CANCELED', '本次整理已取消；范围与侧重点草稿已保留。');
        state.draft.status = 'canceled';
        state.capabilities.summary = 'canceled';
        return { status: PRODUCT_SHELL_STATUS.CANCELED, errorCode: 'CANCELED', operationId };
      }
      const code = errorCode(error, 'PROVIDER_REQUEST_FAILED');
      // Never remove source/focus on a model, body, 502, or persistence error.
      if (token === generation) mark(PRODUCT_SHELL_STATUS.FAILED, code, code === 'PERSISTENCE_UNAVAILABLE' ? '持久保存/读回失败，未显示为已保存。' : '本次整理失败，草稿仍可重试。');
      state.draft.status = 'retryable';
      state.capabilities.summary = code === 'PERSISTENCE_UNAVAILABLE' ? 'persistence_failed' : 'failed';
      const safeFailure = productFailure(error);
      return { status: PRODUCT_SHELL_STATUS.FAILED, errorCode: code, failure: safeFailure, errorDetails: { ...safeLogDetails(errorDiagnostics(error)), status: safeFailure.status }, operationId };
    } finally {
      if (activeTask === operationId) activeTask = null;
      if (abortController?.signal.aborted || !activeTask) abortController = null;
      state.job = state.job && state.job.operationId === operationId ? { ...state.job, active: false } : state.job;
    }
  }

  async function cancelSummary() {
    if (!activeTask || !abortController) return { status: state.status, canceled: false };
    generation += 1;
    abortController.abort('user canceled');
    state.draft.status = 'canceled';
    mark(PRODUCT_SHELL_STATUS.CANCELED, 'CANCELED', '本次整理已取消；范围与侧重点草稿已保留。');
    return { status: PRODUCT_SHELL_STATUS.CANCELED, canceled: true, operationId: activeTask };
  }

  async function previewRecall(query, options = {}) {
    if (!repository || !state.scope) return { status: PRODUCT_SHELL_STATUS.UNAVAILABLE, errorCode: 'PERSISTENCE_UNAVAILABLE', previewOnly: true, sent: false };
    const session = state.session;
    const token = currentToken();
    const snapshot = await repository.readScope(state.scope);
    if (!tokenValid(token, session)) return { status: 'invalidated', previewOnly: true, sent: false };
    const records = snapshot.records ?? {};
    const units = eventDependencies(records.events ?? [], records.awarenessChanges ?? [], records.commitmentChanges ?? []);
    const index = new LocalBM25Index(units, { k1: state.settings.bm25K1, b: state.settings.bm25B });
    const result = await retrieveAndPack({
      index,
      query: text(query),
      limit: options.limit ?? state.settings.retrievalLimit,
      budgetUnits: options.budgetUnits ?? state.settings.retrievalBudgetUnits,
      vectorAdapter: null,
      reranker: null,
      vectorOptions: { rankConstant: state.settings.fusionRankConstant, localWeight: state.settings.fusionLocalWeight, vectorWeight: state.settings.vectorWeight },
    });
    state.lastPreview = {
      status: 'preview',
      previewOnly: true,
      sent: false,
      committedRevision: snapshot.committedRevision,
      candidateCount: result.candidates.length,
      unitCount: result.units.length,
      omittedCount: result.omitted.length,
      usedUnits: result.usedUnits,
      remainingUnits: result.remainingUnits,
      trace: { ...result.trace, vector: { status: state.settings.vectorEnabled ? 'unavailable_no_adapter' : 'disabled' }, rerank: { status: state.settings.rerankEnabled ? 'unavailable_no_adapter' : 'disabled', calls: 0 } },
      units: clone(result.units),
    };
    return clone(state.lastPreview);
  }

  async function saveSettings(next = {}) {
    const merged = normalizeProductSettings({ ...state.settings, ...next }, { includeSessionSecret: false });
    state.settings = merged;
    if (!sessionStore) {
      state.settingsStatus = 'draft_only_no_persistence';
      return { status: PRODUCT_SHELL_STATUS.UNAVAILABLE, errorCode: 'PERSISTENCE_UNAVAILABLE', settings: clone(merged) };
    }
    try {
      const session = state.session;
      const token = currentToken();
      const store = sessionStore;
      const key = settingsKey();
      const value = globalApiSettings ? splitProductSettings(noSecretSettings(merged)).chat : noSecretSettings(merged);
      const saved = { schemaVersion: PRODUCT_SETTINGS_VERSION, ...value };
      await store.setJson({ namespace: PRODUCT_SETTINGS_NAMESPACE, key, value: saved });
      const found = typeof store.tryGetJson === 'function'
        ? await store.tryGetJson({ namespace: PRODUCT_SETTINGS_NAMESPACE, key })
        : { found: true, value: await store.getJson({ namespace: PRODUCT_SETTINGS_NAMESPACE, key }) };
      if (!tokenValid(token, session)) return { status: 'invalidated', errorCode: 'CHAT_CHANGED' };
      if (!found?.found || stableStringify(found.value) !== stableStringify(saved)) throw new Error('settings readback mismatch');
      state.settingsStatus = 'readback_verified';
      return { status: 'saved', settings: clone(merged) };
    } catch {
      state.settingsStatus = 'failed_retryable';
      return { status: PRODUCT_SHELL_STATUS.FAILED, errorCode: 'PERSISTENCE_UNAVAILABLE', settings: clone(merged) };
    }
  }

  async function testConnection() {
    if (!sessionStore) return { status: PRODUCT_SHELL_STATUS.UNAVAILABLE, errorCode: 'CHAT_IDENTITY_NOT_READY' };
    const candidate = transportFactory({
      providerEndpoint: state.settings.providerEndpoint,
      providerEndpointMode: state.settings.providerEndpointMode,
      providerModel: state.settings.providerModel,
      providerAuthMode: state.settings.providerAuthMode,
      deadlineMs: state.settings.deadlineMs,
        outputBudgetUnits: state.settings.outputBudgetUnits,
    }, { sessionApiKey: state.sessionApiKey ?? '', fetchImpl });
    transport = candidate;
    if (candidate.status !== 'ready') return { status: PRODUCT_SHELL_STATUS.UNAVAILABLE, errorCode: candidate.errorCode };
    try {
      await candidate.testConnection();
      return { status: 'passed', transport: candidate.profile, sessionCredential: Boolean(state.sessionApiKey) };
    } catch (error) { return { status: PRODUCT_SHELL_STATUS.FAILED, errorCode: errorCode(error, 'PROVIDER_REQUEST_FAILED') }; }
  }

  function setSessionCredential(value) {
    state.sessionApiKey = typeof value === 'string' ? value : '';
    return { status: 'session_only', configured: Boolean(state.sessionApiKey) };
  }

  async function remember(textValue, { people = '', category='events',subject='',target='',field='补充信息',eventRef='',context='当前聊天',term='直至用户修改',typedValue,profileFacts=null,controlsPatch=null } = {}) {
    const content = text(textValue);
    if (!content || content.length > 12000) throw new Error('记事需要 1–12000 字');
    if (!repository || !state.session || state.status === 'invalidated' || activeTask) throw new Error('请先打开当前聊天，等待当前整理结束');
    const session = state.session, token = currentToken();
    const expectedRevision = await repository.getCommittedRevision(session.scope);
    if (!tokenValid(token, session)) throw new Error('聊天已变化');
    const operationId = makeId('user-note'), sourceRevision = sha256(content), sourceRefs = [{ sourceId: operationId, hash: sourceRevision, version: 1 }];
    const eventId = makeId('note');
    const output = { events: [{ id: eventId, subject: '用户补充设定', description: content, state: 'completed', epistemicStatus: 'user_asserted', perspective: 'unknown', sourceRefs }], awarenessChanges: people.split(/[,，]/).map(p=>p.trim()).filter(Boolean).map(person=>({ id: makeId('aware'), eventRef: eventId, person, knowledge: content, status: 'known', via: 'user_confirmed', learnedAt: {kind:'unknown'}, sourceRefs })), entityFactChanges: [], relationshipChanges: [], personaChanges: [], commitmentChanges: [], performanceHints: [], summaryView: [], conflicts: [], coverage: { sourceRefs, processed: sourceRefs, excluded: [], unprocessed: [] } };
    if(category!=='events'){
      if(!['awarenessChanges','entityFactChanges','relationshipChanges','personaChanges','commitmentChanges','performanceHints','summaryView','conflicts'].includes(category))throw new Error('未知记忆类别');
      output.events=[];output.awarenessChanges=[];
      const base={id:eventId,sourceRefs,description:content,epistemicStatus:'user_asserted'};
      if(['entityFactChanges','relationshipChanges','personaChanges','awarenessChanges'].includes(category)&&!subject.trim())throw new Error('请填写人物或主体');
      if(['relationshipChanges','personaChanges'].includes(category)&&!target.trim())throw new Error('请填写关系对象');
      const fields={
        awarenessChanges:{eventRef,person:subject,knowledge:content,status:'known',via:'user_confirmed',learnedAt:{kind:'unknown'}},
        entityFactChanges:{entity:subject,field:field||'补充信息',to:typedValue===undefined?content:typedValue},
        relationshipChanges:{from:subject,to:target,evidenceKind:'user_confirmed'},
        personaChanges:{subject,aspect:field||'变化',object:target,context,scope:'当前关系与场景',term},
        commitmentChanges:{subject:subject||people||'用户确认',content,state:'proposed'},
      };
      if(category==='relationshipChanges')fields[category].evidenceKind='expression';
      if(category==='awarenessChanges'&&!eventRef)throw new Error('请选择关联事件；不会凭空推断知情来源');
      output[category]=[{...base,...(fields[category]??{})}];
    }
    if(profileFacts){
      if(category!=='entityFactChanges'||!Array.isArray(profileFacts)||!profileFacts.length||profileFacts.length>200)throw new Error('人物属性列表无效');
      output.entityFactChanges=profileFacts.map(f=>({id:makeId('note'),entity:subject,field:f.field,to:f.value,sourceRefs,epistemicStatus:'user_asserted'}));
    }
    const bundle = bindDraftBundle(output, { scope: session.scope, operationId, expectedRevision, sourceRefs, sourceRevision });
    manualOperation = { id: operationId, sourceRevision, token };
    try {
      const receipt = await repository.commitBundle(bundle,{controlsPatch});
      if (!tokenValid(token, session)) throw new Error('聊天已变化');
      return { status: 'saved', committedRevision: receipt.committedRevision, eventId, source: 'user_asserted' };
    } finally { manualOperation = null; }
  }

  async function readMemoryView() {
    if (!repository || !state.scope) return { status: 'empty', persistence: 'unavailable', records: null };
    const snapshot = await repository.readScope(state.scope);
    return {
      status: 'ready',
      committedRevision: snapshot.committedRevision,
      source: 'committed-snapshot',
      counts: summaryCounts(snapshot.records),
      events: clone(snapshot.records.events),
      records: clone(snapshot.records),
      controls: clone(snapshot.manifest?.controls??{}),
      awarenessChanges: clone(snapshot.records.awarenessChanges),
      temporal: clone(snapshot.records.events.map((event) => event.temporal ?? event.storyTime ?? event.time ?? { kind: 'unknown' })),
      sources: clone(snapshot.records.coverage?.sourceRefs ?? []),
    };
  }

  async function sourceValidity(records) {
    if (!state.session) throw new Error('聊天未打开');
    const session = state.session, token = currentToken();
    return verifyProductSources(session.handle.history, records, () => { if (!tokenValid(token, session)) throw new Error('聊天已变化'); });
  }

  async function dispose() {
    destroyed = true;
    generation += 1;
    if (abortController && !abortController.signal.aborted) abortController.abort('disposed');
    activeTask = null;
    const unsubscribeFailures = await removeSubscriptions();
    return { status: 'disposed', unsubscribeFailures };
  }

  const controller = {
    get state() { return cloneState(state); },
    get settings() { return clone(state.settings); },
    get legacyApiSettings() { return clone(legacyApiSettings); },
    get legacySettings() { return clone(legacySettings); },
    useGlobalSettings(patch) { globalApiSettings=validateProductPatch(patch);Object.assign(state.settings,globalApiSettings);transport=null; },
    async historyTail(){
      if(!state.session)throw new Error('请先打开聊天');
      const session=state.session,token=currentToken();
      const check=async()=>{const ref=await adapterInstance.currentRef();if(!tokenValid(token,session)||stableStringify(ref)!==session.refKey)throw Object.assign(new Error('聊天已变化'),{code:'CHAT_CHANGED'});};
      await check();const range=await readProductHostRange(session,{count:1});await check();return range.endIndex;
    },
    useGlobalApiSettings(patch) {
      const {api,chat}=splitProductSettings(validateProductPatch(patch));
      if(Object.keys(chat).length)throw new Error('全局连接仅接受 API 字段');
      globalApiSettings=api;Object.assign(state.settings,api);transport=null;
    },
    get session() { return state.session ? { scope: clone(state.scope), stableIdReady: true } : null; },
    bindCurrentChat,
    readRange,
    setFocus,
    startSummary,
    cancelSummary,
    previewRecall,
    saveSettings,
    testConnection,
    setSessionCredential,
    readMemoryView,
    async updateMemoryControls(patch){if(!repository||!state.session||activeTask)throw new Error('请先打开聊天并等待任务结束');const token=currentToken(),session=state.session;const check=()=>{if(!tokenValid(token,session))throw new Error('聊天已变化');};check();return repository.updateControls(session.scope,patch,{check});},
    remember,
    sourceValidity,
    workspace() {
      if (!sessionStore || !state.scope || state.status === 'invalidated') throw new Error('请先打开当前聊天');
      const session = state.session;
      const token = currentToken();
      return { store: sessionStore, scope: clone(state.scope), isCurrent: () => tokenValid(token, session) && state.status !== 'invalidated' };
    },
    setPage(page) { state.activePage = ['memory', 'current', 'assistant', 'settings'].includes(page) ? page : 'memory'; return state.activePage; },
    close() { state.closed = true; return { status: 'closed', draft: clone(state.draft), settings: clone(state.settings) }; },
    reopen() { state.closed = false; return { status: state.status, draft: clone(state.draft), settings: clone(state.settings) }; },
    injectionStatus() { return clone(state.injection); },
    settingsStatus() { return { status: state.settingsStatus, settings: listProductSettings(state.settings), consumers: productSettingConsumers(state.settings) }; },
    assistantStatus() { return { status: 'unavailable', reason: '配置助手与资料导入/应用能力尚未在本批正式闭环内提供。' }; },
    report() {
      return {
        schemaVersion: 1,
        kind: 'ProductShellReport',
        status: state.status,
        activePage: state.activePage,
        identity: state.session ? 'ready' : 'not_ready',
        scopeBound: Boolean(state.scope),
        range: clone(state.range),
        sourceRevisionPresent: Boolean(state.sourceRevision),
        draft: { hasRange: Boolean(state.draft.range), hasFocus: Boolean(state.draft.focus), status: state.draft.status },
        lastSaved: state.lastSaved ? { committedRevision: state.lastSaved.committedRevision, sourceRevisionPresent: Boolean(state.lastSaved.sourceRevision), counts: clone(state.lastSaved.counts), source: state.lastSaved.source } : null,
        preview: state.lastPreview ? { previewOnly: true, sent: false, candidateCount: state.lastPreview.candidateCount, unitCount: state.lastPreview.unitCount, omittedCount: state.lastPreview.omittedCount } : null,
        settingsStatus: state.settingsStatus,
        settingConsumers: productSettingConsumers(state.settings),
        injection: clone(state.injection),
        capabilities: clone(state.capabilities),
        errorCode: state.errorCode,
      };
    },
    dispose,
  };
  return Object.freeze(controller);
}

export const PRODUCT_DEFAULT_SETTINGS = Object.freeze(defaultProductSettings());
import { errorDiagnostics } from './diagnostics.js';
