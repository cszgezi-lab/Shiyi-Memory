import { ValidationError } from './errors.js';
import {
  asArray,
  asString,
  clone,
  estimateUnits,
  isPlainObject,
  makeId,
  normalizeText,
  sha256,
  stableStringify,
  uniqueStrings,
} from './utils.js';

export const DRAFT_CATEGORIES = Object.freeze([
  'events',
  'awarenessChanges',
  'entityFactChanges',
  'relationshipChanges',
  'personaChanges',
  'commitmentChanges',
  'performanceHints',
  'summaryView',
  'conflicts',
  'coverage',
]);

/**
 * The model-facing contract is deliberately data-only.  Keeping the field
 * names and enum values here (instead of sending only category names) makes a
 * request self describing and gives the host one canonical contract to audit.
 */
export const SUMMARY_OUTPUT_CONTRACT = Object.freeze({
  schemaVersion: 1,
  kind: 'DraftBundle',
  categories: DRAFT_CATEGORIES,
  requiredCategories: DRAFT_CATEGORIES,
  requiredFields: Object.freeze(['scope(host-bound)', 'operationId(host-bound)', 'expectedRevision(host-bound)', 'schemaVersion', 'events', 'awarenessChanges', 'entityFactChanges', 'relationshipChanges', 'personaChanges', 'commitmentChanges', 'performanceHints', 'summaryView', 'conflicts', 'coverage']),
  fields: Object.freeze({
    events: Object.freeze(['id', 'sourceRefs', 'subject', 'action|description', 'object', 'state', 'epistemicStatus', 'perspective']),
    awarenessChanges: Object.freeze(['id', 'eventRef|eventRefs', 'actorId|person|audience', 'knowledge|fact|content', 'status', 'via', 'learnedAt', 'sourceRefs']),
    entityFactChanges: Object.freeze(['id', 'entity|entityId', 'field|key', 'to|value|newValue', 'epistemicStatus', 'sourceRefs']),
    relationshipChanges: Object.freeze(['id', 'from|subject', 'to|object', 'evidenceKind', 'epistemicStatus', 'sourceRefs']),
    personaChanges: Object.freeze(['id', 'subject|person|entity', 'aspect|field|key', 'object|objectRef', 'context', 'scope', 'expiresAt|validUntil|term|duration', 'epistemicStatus', 'sourceRefs']),
    commitmentChanges: Object.freeze(['id', 'participants|subject', 'content|description', 'state', 'epistemicStatus', 'sourceRefs']),
    performanceHints: Object.freeze(['id', 'sourceRefs']),
    summaryView: Object.freeze(['id', 'sourceRefs']),
    conflicts: Object.freeze(['id', 'sourceRefs']),
    coverage: Object.freeze(['sourceRefs', 'bridgeRefs', 'processed', 'excluded', 'unprocessed']),
  }),
  enums: Object.freeze({
    eventState: Object.freeze(['proposed', 'attempted', 'accepted', 'completed', 'declined', 'canceled']),
    epistemicStatus: Object.freeze(['observed', 'user_asserted', 'character_claim', 'inferred', 'unknown']),
    awarenessStatus: Object.freeze(['known', 'heard', 'suspected', 'mistaken', 'explicitly_unaware']),
    awarenessVia: Object.freeze(['witnessed', 'heard_in_scene', 'read', 'told', 'background', 'user_confirmed', 'special_ability']),
    perspective: Object.freeze(['first_person', 'second_person', 'third_person', 'omniscient', 'unknown']),
  }),
});

export function createSummaryOutputContract() {
  return clone(SUMMARY_OUTPUT_CONTRACT);
}

export const EVENT_STATES = Object.freeze([
  'proposed',
  'attempted',
  'accepted',
  'completed',
  'declined',
  'canceled',
]);

export const EPISTEMIC_STATUSES = Object.freeze([
  'observed',
  'user_asserted',
  'character_claim',
  'inferred',
  'unknown',
]);

export const AWARENESS_STATUSES = Object.freeze([
  'known',
  'heard',
  'suspected',
  'mistaken',
  'explicitly_unaware',
]);

export const AWARENESS_VIA = Object.freeze([
  'witnessed',
  'heard_in_scene',
  'read',
  'told',
  'background',
  'user_confirmed',
  'special_ability',
]);

export const PERSPECTIVES = Object.freeze([
  'first_person',
  'second_person',
  'third_person',
  'omniscient',
  'unknown',
]);

export const RELATION_EVIDENCE_KINDS = Object.freeze([
  'expression',
  'response',
  'mutual_confirmation',
  'boundary',
  'shared_experience',
  'habit',
]);

export const LIFECYCLE_STATES = Object.freeze([
  'active',
  'resolved',
  'retracted',
  'superseded',
]);

const CATEGORY_DEFAULTS = Object.freeze({
  events: [],
  awarenessChanges: [],
  entityFactChanges: [],
  relationshipChanges: [],
  personaChanges: [],
  commitmentChanges: [],
  performanceHints: [],
  summaryView: [],
  conflicts: [],
  coverage: { sourceRefs: [], excluded: [], unprocessed: [] },
});

function requireScope(scope, errors = []) {
  if (!isPlainObject(scope)) {
    errors.push('scope must be an object');
    return {};
  }
  const result = {};
  for (const key of ['accountId', 'chatId', 'branchId']) {
    if (scope[key] !== undefined && (typeof scope[key] !== 'string' || !scope[key].trim())) {
      errors.push(`scope.${key} must be a non-empty string when provided`);
    } else if (scope[key] !== undefined) {
      result[key] = scope[key];
    }
  }
  if (!result.chatId && !result.branchId && !result.accountId) {
    errors.push('scope must identify at least an account, chat, or branch');
  }
  return result;
}

export function normalizeScope(scope) {
  const errors = [];
  const normalized = requireScope(scope, errors);
  if (errors.length) throw new ValidationError('invalid scope', errors);
  return normalized;
}

export function scopeKey(scope) {
  return stableStringify(normalizeScope(scope));
}

function normalizeSourceRef(ref) {
  if (typeof ref === 'string' && ref.trim()) return { sourceId: ref.trim() };
  if (!isPlainObject(ref)) return null;
  const sourceId = ref.sourceId ?? ref.messageId ?? ref.id ?? ref.uuid;
  if (typeof sourceId !== 'string' || !sourceId.trim()) return null;
  const result = { sourceId: sourceId.trim() };
  if (ref.version !== undefined && !((typeof ref.version === 'number' && Number.isInteger(ref.version) && ref.version >= 0) || (typeof ref.version === 'string' && ref.version.trim()))) return null;
  if (ref.swipeId !== undefined && !((typeof ref.swipeId === 'number' && Number.isInteger(ref.swipeId) && ref.swipeId >= 0) || (typeof ref.swipeId === 'string' && ref.swipeId.trim()))) return null;
  if (ref.fragmentId !== undefined && (typeof ref.fragmentId !== 'string' || !ref.fragmentId.trim())) return null;
  for (const key of ['hash', 'contentHash']) if (ref[key] !== undefined && (typeof ref[key] !== 'string' || !ref[key].trim())) return null;
  for (const key of ['version', 'swipeId', 'hash', 'contentHash', 'fragmentId', 'kind']) {
    if (ref[key] !== undefined) result[key] = ref[key];
  }
  return result;
}

export function normalizeSourceRefs(refs) {
  return (Array.isArray(refs) ? refs : []).map(normalizeSourceRef).filter(Boolean);
}

function normalizeMessage(message, index) {
  if (!isPlainObject(message)) throw new ValidationError(`source message ${index} must be an object`);
  const id = message.id ?? message.messageId ?? message.uuid ?? message.sourceId;
  if (typeof id !== 'string' || !id.trim()) {
    throw new ValidationError(`source message ${index} has no stable id`);
  }
  if (message.complete === false || message.streaming === true || message.isStreaming === true) {
    throw new ValidationError(`source message ${id} is not complete`, { sourceId: id });
  }
  const text = String(message.text ?? message.mes ?? message.content ?? '');
  // External hashes are useful evidence, but they are optional and can be
  // stale.  Always retain a digest of the frozen body so edits are detected
  // even when a host omits (or incorrectly reuses) its hash.
  const contentHash = sha256(text);
  const suppliedHash = typeof message.hash === 'string' && message.hash.trim() ? message.hash.trim() : null;
  const version = message.version ?? message.swipeId ?? 0;
  if (!((typeof version === 'number' && Number.isInteger(version) && version >= 0) || (typeof version === 'string' && version.trim()))) {
    throw new ValidationError(`source message ${id} has an invalid version/swipe`, { sourceId: id });
  }
  if (message.fragmentId !== undefined && (typeof message.fragmentId !== 'string' || !message.fragmentId.trim())) {
    throw new ValidationError(`source message ${id} has an invalid fragmentId`, { sourceId: id });
  }
  return {
    id: id.trim(),
    role: message.role ?? message.name ?? 'unknown',
    text,
    version,
    hash: suppliedHash ?? contentHash,
    contentHash,
    index,
    complete: true,
    fragmentId: message.fragmentId,
  };
}

/** Freeze the input range and revisions used by a summary job. */
export function createSummaryBatch({
  scope,
  operationId = makeId('summary'),
  expectedRevision = 0,
  messages = [],
  sourceMessages,
  focusSpec = null,
  configVersion = '1',
  rulesVersion = '1',
  bridgeMessages = [],
  requestedRange,
  inputBudget,
  outputBudget,
  outputReserveUnits,
  rules = null,
  recordingRules = null,
  focusVersion = null,
  trigger = 'automatic',
} = {}) {
  const frozenScope = normalizeScope(scope);
  if (typeof operationId !== 'string' || !operationId.trim()) throw new ValidationError('operationId must be a non-empty string');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new ValidationError('expectedRevision must be a non-negative integer');
  const input = sourceMessages ?? messages;
  if (!Array.isArray(input) || input.length === 0) throw new ValidationError('summary batch requires at least one source message');
  const normalizedMessages = input.map(normalizeMessage);
  const normalizedBridgeMessages = Array.isArray(bridgeMessages) ? bridgeMessages.map(normalizeMessage) : [];
  const range = requestedRange ?? {
    startIndex: normalizedMessages[0].index,
    endIndex: normalizedMessages[normalizedMessages.length - 1].index,
  };
  return {
    schemaVersion: 1,
    kind: 'SummaryBatch',
    scope: frozenScope,
    operationId: operationId.trim(),
    expectedRevision,
    configVersion: String(configVersion),
    rulesVersion: String(rulesVersion),
    focusSpec: focusSpec ? clone(focusSpec) : null,
    focusVersion: focusVersion == null ? sha256(focusSpec ?? null).slice(0, 24) : String(focusVersion),
    trigger: String(trigger ?? 'automatic'),
    rules: clone(recordingRules ?? rules),
    sourceMessages: clone(normalizedMessages),
    bridgeMessages: clone(normalizedBridgeMessages),
    parentRange: { startIndex: range.startIndex, endIndex: range.endIndex },
    coverage: {
      sourceRefs: normalizedMessages.map((message) => ({ sourceId: message.id, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
      bridgeRefs: normalizedBridgeMessages.map((message) => ({ sourceId: message.id, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
      processed: [],
      unprocessed: [],
    },
    budgets: {
      inputUnits: Number.isFinite(inputBudget) ? inputBudget : null,
      outputUnits: Number.isFinite(outputBudget) ? outputBudget : null,
      outputReserveUnits: Number.isFinite(outputReserveUnits) ? outputReserveUnits : null,
    },
    // Scope (including branch), version, fragment and body all participate in
    // the frozen revision.  The caller-provided hash remains an auditable
    // source field, while contentHash protects against stale/missing hashes.
    sourceRevision: sha256({
      scope: frozenScope,
      parentRange: { startIndex: range.startIndex, endIndex: range.endIndex },
      sourceMessages: normalizedMessages.map((message) => ({ id: message.id, role: message.role, text: message.text, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
      bridgeMessages: normalizedBridgeMessages.map((message) => ({ id: message.id, role: message.role, text: message.text, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
    }),
  };
}

function normalizedCategory(value, category) {
  if (category === 'coverage') {
    if (!isPlainObject(value)) return clone(CATEGORY_DEFAULTS.coverage);
    return {
      sourceRefs: normalizeSourceRefs(value.sourceRefs ?? value.processed ?? []),
      bridgeRefs: normalizeSourceRefs(value.bridgeRefs ?? []),
      processed: normalizeSourceRefs(value.processed ?? value.sourceRefs ?? []),
      excluded: Array.isArray(value.excluded) ? clone(value.excluded) : [],
      unprocessed: Array.isArray(value.unprocessed) ? clone(value.unprocessed) : [],
    };
  }
  return Array.isArray(value) ? clone(value) : [];
}

function validateRawCoverageShape(coverage) {
  const errors = [];
  if (!isPlainObject(coverage)) return ['coverage must be an object'];
  const arrayFields = ['sourceRefs', 'bridgeRefs', 'processed', 'excluded', 'unprocessed'];
  for (const key of arrayFields) {
    if (coverage[key] !== undefined && !Array.isArray(coverage[key])) {
      errors.push(`coverage.${key} must be an array`);
      continue;
    }
    const values = coverage[key] ?? [];
    for (let index = 0; index < values.length; index += 1) {
      const item = values[index];
      if (key === 'excluded' || key === 'unprocessed') {
        const validString = typeof item === 'string' && item.trim();
        const validObject = isPlainObject(item) && normalizeSourceRefs([item]).length === 1;
        if (!validString && !validObject) errors.push(`coverage.${key}[${index}] must identify a source`);
      } else if (!normalizeSourceRefs([item]).length) {
        errors.push(`coverage.${key}[${index}] must be a valid source reference`);
      }
    }
  }
  return errors;
}

function validateRawBundleShape(source) {
  const errors = [];
  for (const category of DRAFT_CATEGORIES) {
    if (!(category in source)) continue;
    if (category === 'coverage') {
      if (!isPlainObject(source[category])) errors.push(`${category} must be an object`);
    } else if (!Array.isArray(source[category])) {
      errors.push(`${category} must be an array`);
    }
  }
  if ('coverage' in source) errors.push(...validateRawCoverageShape(source.coverage));
  if (errors.length) throw new ValidationError('DraftBundle contains malformed category types', { errors });
}

function sourceEvidenceKey(ref) {
  const normalized = normalizeSourceRefs([ref])[0];
  if (!normalized) return null;
  return stableStringify({
    sourceId: normalized.sourceId,
    version: normalized.version ?? null,
    swipeId: normalized.swipeId ?? null,
    fragmentId: normalized.fragmentId ?? null,
    contentHash: normalized.contentHash ?? normalized.hash ?? null,
  });
}

function evidenceFieldMatches(requested, candidate, field) {
  if (requested[field] === undefined) return true;
  return stableStringify(requested[field]) === stableStringify(candidate[field]);
}

function bindEvidenceRef(ref, candidates, field) {
  const matches = candidates.filter((candidate) => (
    evidenceFieldMatches(ref, candidate, 'version')
    && evidenceFieldMatches(ref, candidate, 'swipeId')
    && evidenceFieldMatches(ref, candidate, 'fragmentId')
    && evidenceFieldMatches(ref, candidate, 'contentHash')
    && evidenceFieldMatches(ref, candidate, 'hash')
  ));
  if (matches.length > 1) {
    throw new ValidationError(`${field} has ambiguous source evidence`, {
      sourceId: ref.sourceId,
      candidates: matches.map((candidate) => sourceEvidenceKey(candidate)),
    });
  }
  if (matches.length === 1) return clone(matches[0]);
  // A known source with supplied locator fields must bind to the exact frozen
  // evidence.  Keeping a mismatched fragment/hash merely because there is one
  // candidate would let later source-ID-only validation accept forged
  // evidence.  Unknown source IDs are retained so the normal allowed-source
  // validation can report them, but known mismatches fail here.
  if (candidates.length > 0) {
    throw new ValidationError(`${field} cannot resolve source evidence`, {
      sourceId: ref.sourceId,
      candidates: candidates.map((candidate) => sourceEvidenceKey(candidate)),
    });
  }
  return null;
}

/**
 * Bind model business fields to host-owned execution metadata.  Model values
 * for scope/operationId/expectedRevision are deliberately ignored.
 */
export function bindDraftBundle(modelOutput, {
  scope,
  operationId,
  expectedRevision,
  parentRange = null,
  childRange = null,
  sourceRefs = [],
  sourceRevision = null,
  configVersion = '1',
  rulesVersion = '1',
  focusVersion = null,
  correctionAuthorizations = [],
} = {}) {
  const boundScope = normalizeScope(scope);
  if (typeof operationId !== 'string' || !operationId.trim()) throw new ValidationError('bound operationId is required');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new ValidationError('bound expectedRevision is invalid');
  const source = isPlainObject(modelOutput) ? modelOutput : {};
  validateRawBundleShape(source);
  const boundEvidenceRefs = normalizeSourceRefs(sourceRefs);
  const evidenceBySource = new Map();
  for (const ref of boundEvidenceRefs) {
    const list = evidenceBySource.get(ref.sourceId) ?? [];
    list.push(ref);
    evidenceBySource.set(ref.sourceId, list);
  }
  const bindEvidence = (record) => {
    const next = clone(record);
    const raw = normalizeSourceRefs(record?.sourceRefs ?? record?.sources ?? []);
    next.sourceRefs = raw.map((ref, index) => {
      const candidates = evidenceBySource.get(ref.sourceId) ?? [];
      const matched = bindEvidenceRef(ref, candidates, `record.sourceRefs[${index}]`);
      // Unknown refs are retained for the later allowed-source validation;
      // known-but-ambiguous refs fail above rather than being last-write-wins.
      return matched ?? clone(ref);
    });
    delete next.sources;
    return next;
  };
  const bundle = {
    schemaVersion: 1,
    kind: 'DraftBundle',
    scope: clone(boundScope),
    operationId: operationId.trim(),
    expectedRevision,
    configVersion: String(configVersion),
    rulesVersion: String(rulesVersion),
    focusVersion: focusVersion == null ? null : String(focusVersion),
    sourceRevision: sourceRevision ? String(sourceRevision) : null,
    parentRange: parentRange ? clone(parentRange) : null,
    childRange: childRange ? clone(childRange) : null,
    events: normalizedCategory(source.events, 'events').map(bindEvidence),
    awarenessChanges: normalizedCategory(source.awarenessChanges, 'awarenessChanges').map(bindEvidence),
    entityFactChanges: normalizedCategory(source.entityFactChanges, 'entityFactChanges').map(bindEvidence),
    relationshipChanges: normalizedCategory(source.relationshipChanges, 'relationshipChanges').map(bindEvidence),
    personaChanges: normalizedCategory(source.personaChanges, 'personaChanges').map(bindEvidence),
    commitmentChanges: normalizedCategory(source.commitmentChanges, 'commitmentChanges').map(bindEvidence),
    performanceHints: normalizedCategory(source.performanceHints, 'performanceHints').map(bindEvidence),
    summaryView: normalizedCategory(source.summaryView, 'summaryView').map(bindEvidence),
    conflicts: normalizedCategory(source.conflicts, 'conflicts').map(bindEvidence),
    coverage: normalizedCategory(source.coverage, 'coverage'),
    binding: {
      sourceRefs: boundEvidenceRefs,
      boundBy: 'shiyi-core',
      // Only the host may populate this allow-list.  Model fields such as
      // explicitCorrection/correctionOf/changeKind are retained for audit,
      // but do not grant authority by themselves.
      correctionAuthorizations: [...new Set((Array.isArray(correctionAuthorizations) ? correctionAuthorizations : []).filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))],
    },
  };
  // Preserve diagnostics without allowing the model to smuggle executable or
  // persistence instructions into the bundle.
  if (Array.isArray(source.trace)) bundle.trace = clone(source.trace);
  return bundle;
}

export function createDraftBundle(input = {}) {
  const { modelOutput, ...binding } = input;
  return bindDraftBundle(modelOutput ?? input.data ?? input, binding);
}

function recordId(record, field = 'id') {
  return typeof record?.[field] === 'string' && record[field].trim() ? record[field].trim() : null;
}

function sourceIdsOf(record) {
  return normalizeSourceRefs(record?.sourceRefs ?? record?.sources ?? []).map((ref) => ref.sourceId);
}

function validEnum(value, allowed, field, errors, { optional = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!optional) errors.push(`${field} is required`);
    return;
  }
  if (!allowed.includes(value)) errors.push(`${field} must be one of ${allowed.join(', ')}`);
}

function validateSourceRefs(record, field, allowedSourceIds, errors) {
  const rawRefs = record?.sourceRefs ?? record?.sources;
  if (!Array.isArray(rawRefs)) errors.push(`${field}.sourceRefs must be an array`);
  const refs = normalizeSourceRefs(rawRefs ?? []);
  if (Array.isArray(rawRefs) && refs.length !== rawRefs.length) errors.push(`${field}.sourceRefs contains an invalid reference`);
  if (refs.length === 0) errors.push(`${field}.sourceRefs must contain a stable source reference`);
  if (allowedSourceIds) {
    for (const ref of refs) if (!allowedSourceIds.has(ref.sourceId)) errors.push(`${field} references unknown source ${ref.sourceId}`);
  }
  return refs;
}

function validateEvents(events, allowedSourceIds, errors, invalidIds, newSourceIds = null) {
  const ids = new Set();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const field = `events[${index}]`;
    const errorsBefore = errors.length;
    const id = recordId(event);
    if (!id) { errors.push(`${field}.id must be a non-empty string`); continue; }
    if (ids.has(id)) errors.push(`${field}.id is duplicated: ${id}`);
    ids.add(id);
    const refs = validateSourceRefs(event, field, allowedSourceIds, errors);
    if (newSourceIds && refs.length && !refs.some((ref) => newSourceIds.has(ref.sourceId))) {
      errors.push(`${field} is supported only by bridge/context sources; a new source reference is required`);
    }
    validEnum(event.state ?? event.status, EVENT_STATES, `${field}.state`, errors, { optional: false });
    validEnum(event.epistemicStatus, EPISTEMIC_STATUSES, `${field}.epistemicStatus`, errors, { optional: false });
    validEnum(event.perspective, PERSPECTIVES, `${field}.perspective`, errors, { optional: false });
    if (!event.action && !event.description && !event.content) errors.push(`${field} needs an action or description`);
    if (event.invalid === true || event.valid === false || errors.length > errorsBefore) invalidIds.add(id);
  }
  return ids;
}

function checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors) {
  const refs = [];
  for (const key of ['eventRef', 'eventId', 'sourceEventId']) {
    if (record?.[key] !== undefined) refs.push({ key, value: record[key] });
  }
  for (const key of ['eventRefs', 'eventIds']) {
    if (Array.isArray(record?.[key])) refs.push(...record[key].map((value) => ({ key, value })));
  }
  for (const ref of refs) {
    if (typeof ref.value !== 'string' || (!eventIds.has(ref.value) && !knownRecordIds?.has(ref.value))) {
      errors.push(`${field}.${ref.key} references unknown event ${String(ref.value)}`);
    } else if (eventIds.has(ref.value) && invalidEventIds.has(ref.value)) {
      errors.push(`${field}.${ref.key} depends on invalid event ${ref.value}`);
    }
  }
  return refs;
}

function validateAwareness(records, eventIds, knownRecordIds, invalidEventIds, allowedSourceIds, errors) {
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const field = `awarenessChanges[${index}]`;
    const id = recordId(record);
    if (!id) errors.push(`${field}.id must be a non-empty string`); else if (ids.has(id)) errors.push(`${field}.id is duplicated`); else ids.add(id);
    checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors);
    validateSourceRefs(record, field, allowedSourceIds, errors);
    if (!record.actorId && !record.person && !record.personId && !record.audience) errors.push(`${field} needs an actor/person/audience`);
    if (!record.knowledge && !record.fact && !record.content) errors.push(`${field} needs a knowledge payload`);
    validEnum(record.status ?? record.knowledgeStatus, AWARENESS_STATUSES, `${field}.status`, errors, { optional: false });
    validEnum(record.via, AWARENESS_VIA, `${field}.via`, errors, { optional: false });
    if (!('learnedAt' in record)) errors.push(`${field}.learnedAt is required (null/unknown is allowed)`);
    validEnum(record.epistemicStatus, EPISTEMIC_STATUSES, `${field}.epistemicStatus`, errors);
    validEnum(record.perspective, PERSPECTIVES, `${field}.perspective`, errors);
  }
  return ids;
}

function validateEntityFacts(records, eventIds, knownRecordIds, invalidEventIds, allowedSourceIds, errors, existingFacts = [], { enforceCorrectionAuthority = false, trustedCorrectionIds = new Set() } = {}) {
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const field = `entityFactChanges[${index}]`;
    const id = recordId(record);
    if (!id) errors.push(`${field}.id must be a non-empty string`); else if (ids.has(id)) errors.push(`${field}.id is duplicated`); else ids.add(id);
    checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors);
    validateSourceRefs(record, field, allowedSourceIds, errors);
    if (!record.entity && !record.entityId) errors.push(`${field} needs an entity`);
    if (!record.field && !record.key) errors.push(`${field} needs a field/key`);
    validEnum(record.epistemicStatus, EPISTEMIC_STATUSES, `${field}.epistemicStatus`, errors, { optional: false });
    const entity = record.entity ?? record.entityId;
    const key = record.field ?? record.key;
    const value = record.to ?? record.value ?? record.newValue;
    if (!('to' in record) && !('value' in record) && !('newValue' in record)) errors.push(`${field} needs a new value (null is allowed)`);
    const hardFact = existingFacts.find((fact) => (fact.entity ?? fact.entityId) === entity && (fact.field ?? fact.key) === key && fact.confirmed === true);
    if (hardFact && stableStringify(hardFact.value ?? hardFact.to) !== stableStringify(value)) {
      const modelMarker = record.explicitCorrection === true || record.correctionOf || record.changeKind === 'correct' || record.changeKind === 'revise';
      const hostAuthorized = trustedCorrectionIds.has(id) || trustedCorrectionIds.has(record.correctionOf);
      if (!modelMarker || (enforceCorrectionAuthority && !hostAuthorized)) {
        errors.push(`${field} conflicts with confirmed fact ${entity}.${key}; host-authorized correction evidence is required`);
      }
    }
  }
  return ids;
}

function validateRelationships(records, eventIds, knownRecordIds, invalidEventIds, allowedSourceIds, errors) {
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const field = `relationshipChanges[${index}]`;
    const id = recordId(record);
    if (!id) errors.push(`${field}.id must be a non-empty string`); else if (ids.has(id)) errors.push(`${field}.id is duplicated`); else ids.add(id);
    checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors);
    validateSourceRefs(record, field, allowedSourceIds, errors);
    if (!(record.from ?? record.subject) || !(record.to ?? record.object)) errors.push(`${field} needs directional participants`);
    const evidenceKind = record.evidenceKind ?? (RELATION_EVIDENCE_KINDS.includes(record.kind) ? record.kind : undefined);
    validEnum(evidenceKind, RELATION_EVIDENCE_KINDS, `${field}.evidenceKind`, errors, { optional: false });
    // A response or mutual confirmation is never synthesized from an
    // expression.  If supplied, it must retain its own evidence payload.
    for (const key of ['expression', 'response', 'mutualConfirmation', 'publicScope']) {
      if (record[key] !== undefined && typeof record[key] !== 'object' && typeof record[key] !== 'string' && typeof record[key] !== 'boolean') {
        errors.push(`${field}.${key} has an invalid shape`);
      }
    }
    validEnum(record.epistemicStatus, EPISTEMIC_STATUSES, `${field}.epistemicStatus`, errors, { optional: false });
  }
  return ids;
}

function validatePersona(records, eventIds, knownRecordIds, invalidEventIds, allowedSourceIds, errors) {
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const field = `personaChanges[${index}]`;
    const id = recordId(record);
    if (!id) errors.push(`${field}.id must be a non-empty string`); else if (ids.has(id)) errors.push(`${field}.id is duplicated`); else ids.add(id);
    checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors);
    validateSourceRefs(record, field, allowedSourceIds, errors);
    if (!(record.subject ?? record.person ?? record.entity)) errors.push(`${field} needs a subject`);
    if (!(record.aspect ?? record.field ?? record.key)) errors.push(`${field} needs an aspect`);
    // Object/context/time/scope make a local change non-global by default.
    if (!record.object && !record.objectRef) errors.push(`${field}.object is required to bound a persona change`);
    if (!record.context) errors.push(`${field}.context is required to bound a persona change`);
    if (!record.scope) errors.push(`${field}.scope is required to bound a persona change`);
    if (!('expiresAt' in record) && !('validUntil' in record) && !('term' in record) && !('duration' in record)) errors.push(`${field}.expiresAt/term is required to bound a persona change`);
    validEnum(record.epistemicStatus, EPISTEMIC_STATUSES, `${field}.epistemicStatus`, errors, { optional: false });
  }
  return ids;
}

function validateCommitments(records, eventIds, knownRecordIds, invalidEventIds, allowedSourceIds, errors) {
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const field = `commitmentChanges[${index}]`;
    const id = recordId(record);
    if (!id) errors.push(`${field}.id must be a non-empty string`); else if (ids.has(id)) errors.push(`${field}.id is duplicated`); else ids.add(id);
    checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors);
    validateSourceRefs(record, field, allowedSourceIds, errors);
    validEnum(record.state ?? record.status, EVENT_STATES, `${field}.state`, errors, { optional: false });
    if (!record.participants && !record.subject) errors.push(`${field} needs participants`);
    if (!record.content && !record.description) errors.push(`${field} needs commitment content`);
    validEnum(record.epistemicStatus, EPISTEMIC_STATUSES, `${field}.epistemicStatus`, errors, { optional: false });
  }
  return ids;
}

function validateGenericRecords(category, records, eventIds, knownRecordIds, invalidEventIds, allowedSourceIds, errors, { sourceRequired = false } = {}) {
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const field = `${category}[${index}]`;
    const id = recordId(record);
    if (!id) errors.push(`${field}.id must be a non-empty string`); else if (ids.has(id)) errors.push(`${field}.id is duplicated`); else ids.add(id);
    checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors);
    if (sourceRequired) validateSourceRefs(record, field, allowedSourceIds, errors);
  }
  return ids;
}

function isolateDependencies(bundle, invalidEventIds) {
  const isolated = [];
  if (invalidEventIds.size) isolated.push(...[...invalidEventIds].map((id) => ({ kind: 'event', id, reason: 'invalid_event' })));
  for (const category of ['awarenessChanges', 'relationshipChanges', 'personaChanges', 'commitmentChanges']) {
    for (const record of bundle[category] ?? []) {
      const refs = [record.eventRef, record.eventId, ...(record.eventRefs ?? []), ...(record.eventIds ?? [])].filter(Boolean);
      if (refs.some((ref) => invalidEventIds.has(ref))) isolated.push({ kind: category, id: record.id, reason: 'depends_on_invalid_event' });
    }
  }
  return isolated;
}

function coverageRefKey(ref) {
  const normalized = normalizeSourceRefs([ref])[0];
  if (!normalized) return null;
  return stableStringify({
    sourceId: normalized.sourceId,
    version: normalized.version ?? null,
    swipeId: normalized.swipeId ?? null,
    fragmentId: normalized.fragmentId ?? null,
    // A fragment/version can still be edited in place.  Keep the body hash
    // in the evidence key so coverage and binding cannot silently attach the
    // result for one edit to another.
    contentHash: normalized.contentHash ?? normalized.hash ?? null,
  });
}

function coverageSourceId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (isPlainObject(value)) {
    const ref = normalizeSourceRefs([value])[0];
    return ref?.sourceId ?? null;
  }
  return null;
}

/**
 * Validate and classify model-reported coverage without treating the frozen
 * submitted range as proof that the model actually processed it.
 */
export function coverageState(coverage, expectedSourceRefs = []) {
  const value = isPlainObject(coverage) ? coverage : {};
  const submitted = normalizeSourceRefs(value.sourceRefs ?? []);
  const processed = normalizeSourceRefs(value.processed ?? []);
  const excluded = Array.isArray(value.excluded) ? value.excluded.map((item) => ({ item: clone(item), sourceId: coverageSourceId(item) })).filter((item) => item.sourceId) : [];
  const unprocessed = Array.isArray(value.unprocessed) ? value.unprocessed.map((item) => ({ item: clone(item), sourceId: coverageSourceId(item) })).filter((item) => item.sourceId) : [];
  const expected = normalizeSourceRefs(expectedSourceRefs);
  const expectedById = new Map();
  for (const ref of expected) {
    const key = ref.sourceId;
    if (!expectedById.has(key)) expectedById.set(key, []);
    expectedById.get(key).push(ref);
  }
  const usedExpected = new Set();
  const matchedStatus = { processed: [], excluded: [], unprocessed: [] };
  const overlaps = [];
  const matchExpected = (ref) => {
    const options = expectedById.get(ref?.sourceId) ?? [];
    const hasLocator = ['version', 'swipeId', 'fragmentId', 'contentHash', 'hash'].some((key) => ref?.[key] !== undefined);
    if (!hasLocator && options.length > 1) return null;
    const matches = options.filter((candidate) => {
      const key = coverageRefKey(candidate);
      if (usedExpected.has(key)) return false;
      if (ref?.fragmentId !== undefined && ref.fragmentId !== candidate.fragmentId) return false;
      if (ref?.version !== undefined && ref.version !== candidate.version) return false;
      if (ref?.swipeId !== undefined && ref.swipeId !== candidate.swipeId) return false;
      if (ref?.contentHash !== undefined && ref.contentHash !== candidate.contentHash) return false;
      if (ref?.hash !== undefined && ref.hash !== candidate.hash) return false;
      return true;
    });
    // A source-only status is ambiguous when multiple frozen fragments/edits
    // share its message ID.  Treat it as an overlap, not as the first match.
    return matches.length === 1 ? matches[0] : null;
  };
  const assign = (kind, values) => {
    for (const entry of values) {
      const ref = typeof entry === 'string' ? { sourceId: entry } : normalizeSourceRefs([entry])[0];
      if (!ref) continue;
      const candidate = matchExpected(ref);
      const key = candidate ? coverageRefKey(candidate) : `source:${ref.sourceId}`;
      const prior = [...matchedStatus.processed, ...matchedStatus.excluded, ...matchedStatus.unprocessed].find((item) => item.key === key);
      if (prior && prior.kind !== kind) overlaps.push(key);
      if (!candidate && (expectedById.get(ref.sourceId)?.length ?? 0) > 0) overlaps.push(`ambiguous:${ref.sourceId}`);
      if (candidate) usedExpected.add(coverageRefKey(candidate));
      matchedStatus[kind].push({ key, kind, sourceId: ref.sourceId, ref: clone(ref) });
    }
  };
  assign('processed', processed);
  assign('excluded', excluded.map((entry) => entry.item));
  assign('unprocessed', unprocessed.map((entry) => entry.item));
  const missing = expected.filter((ref) => !usedExpected.has(coverageRefKey(ref))).map((ref) => clone(ref));
  return {
    submitted,
    processed,
    excluded,
    unprocessed,
    missing,
    overlaps,
    complete: expected.length > 0 && missing.length === 0 && overlaps.length === 0 && unprocessed.length === 0,
    partial: expected.length > 0 && (missing.length > 0 || unprocessed.length > 0 || overlaps.length > 0),
    expected,
    expectedById,
  };
}

function validateCoverage(value, sourceSet, errors, expectedSourceRefs = []) {
  if (!isPlainObject(value)) return;
  const arrays = ['sourceRefs', 'bridgeRefs', 'processed', 'excluded', 'unprocessed'];
  for (const key of arrays) if (!Array.isArray(value[key])) errors.push(`coverage.${key} must be an array`);
  const sourceRefs = Array.isArray(value.sourceRefs) ? value.sourceRefs : [];
  const processed = Array.isArray(value.processed) ? value.processed : [];
  const excluded = Array.isArray(value.excluded) ? value.excluded : [];
  const unprocessed = Array.isArray(value.unprocessed) ? value.unprocessed : [];
  const seen = new Map();
  const mark = (kind, item) => {
    const sourceId = coverageSourceId(item);
    if (!sourceId) { errors.push(`coverage.${kind} contains an invalid source reference`); return; }
    if (sourceSet && !sourceSet.has(sourceId)) errors.push(`coverage.${kind} references unknown source ${sourceId}`);
    const list = seen.get(sourceId) ?? [];
    list.push(kind);
    seen.set(sourceId, list);
    if ((kind === 'excluded' || kind === 'unprocessed') && isPlainObject(item) && !(typeof item.reason === 'string' && item.reason.trim())) {
      errors.push(`coverage.${kind} entry for ${sourceId} requires a reason`);
    }
  };
  for (const ref of sourceRefs) mark('sourceRefs', ref);
  for (const ref of processed) mark('processed', ref);
  for (const ref of excluded) mark('excluded', ref);
  for (const ref of unprocessed) mark('unprocessed', ref);
  for (const [sourceId, kinds] of seen) {
    const statuses = kinds.filter((kind) => ['processed', 'excluded', 'unprocessed'].includes(kind));
    if (new Set(statuses).size > 1) errors.push(`coverage source ${sourceId} appears in multiple status sets`);
  }
  if (expectedSourceRefs?.length) {
    const expected = normalizeSourceRefs(expectedSourceRefs);
    const expectedIds = new Set(expected.map((ref) => ref.sourceId));
    for (const ref of sourceRefs) if (!expectedIds.has(ref.sourceId)) errors.push(`coverage.sourceRefs references source outside frozen range ${ref.sourceId}`);
    const statuses = [...processed, ...excluded, ...unprocessed];
    for (const ref of expected) {
      const matches = statuses.filter((item) => {
        const candidate = normalizeSourceRefs([item])[0];
        if (!candidate || candidate.sourceId !== ref.sourceId) return false;
        if (ref.fragmentId !== undefined && candidate.fragmentId !== ref.fragmentId) return false;
        if (ref.version !== undefined && candidate.version !== undefined && candidate.version !== ref.version) return false;
        return true;
      });
      if (!matches.length) errors.push(`coverage is missing status for frozen source ${ref.sourceId}${ref.fragmentId ? ` fragment ${ref.fragmentId}` : ''}`);
    }
  }
}

function temporaryEventId(id) {
  return typeof id === 'string' && /^(?:tmp|temp|temporary)(?:[-_]|$)/iu.test(id);
}

/**
 * Return a deterministic identity used to avoid counting one event twice.
 * A source/message ID is evidence, not an event identity: the semantic
 * fingerprint is included so two events from one message remain distinct.
 */
export function eventIdentity(event) {
  if (!isPlainObject(event)) return null;
  if (typeof event.identityKey === 'string' && event.identityKey.trim()) return `identity:${event.identityKey.trim()}`;
  if (typeof event.eventIdentity === 'string' && event.eventIdentity.trim()) return `identity:${event.eventIdentity.trim()}`;
  if (typeof event.sourceEventId === 'string' && event.sourceEventId.trim()) return `source-event:${event.sourceEventId.trim()}`;
  // A host/model supplied occurrence identifier is stronger evidence than a
  // text fingerprint.  In particular, two independently sourced occurrences
  // can have identical descriptions.  Stable IDs are therefore identities for
  // durable records; only operation-local temporary IDs fall through.
  for (const key of ['occurrenceId', 'occurrenceKey', 'canonicalId', 'sameOccurrenceId']) {
    if (typeof event[key] === 'string' && event[key].trim()) return `occurrence:${event[key].trim()}`;
  }
  if (typeof event.id === 'string' && event.id.trim() && !temporaryEventId(event.id)) return `id:${event.id.trim()}`;
  // Temporary records may be deduplicated only with an explicit same-event
  // link.  Semantic similarity by itself is intentionally not identity.
  for (const key of ['sameEventAs', 'sameAs', 'duplicateOf', 'repeatsEvent', 'sameOccurrenceAs']) {
    if (typeof event[key] === 'string' && event[key].trim()) return `linked:${event[key].trim()}`;
  }
  // `sourceEventId` above is the preferred link, but allow an explicit
  // source-evidence link object without treating source/message ID as event
  // identity.  Unknown dates and matching prose are not equality evidence.
  return null;
}

/** Keep the first occurrence and report repeated mentions rather than events. */
export function dedupeEvents(events = []) {
  const seen = new Map();
  const unique = [];
  const duplicates = [];
  const idMap = new Map();
  for (const event of events) {
    const identity = eventIdentity(event);
    if (!identity || !seen.has(identity)) {
      if (identity) seen.set(identity, event.id);
      unique.push(event);
    } else {
      duplicates.push({ duplicateId: event.id, keptId: seen.get(identity), identity });
      if (event?.id && seen.get(identity)) idMap.set(event.id, seen.get(identity));
    }
  }
  return { events: unique, duplicates, idMap };
}

/**
 * Validate the complete bundle before any write.  `valid:false` is returned
 * instead of throwing so callers can display isolated dependency diagnostics;
 * `assertValidDraftBundle` is provided for transactional callers.
 */
export function validateDraftBundle(bundle, {
  expectedBinding,
  allowedSourceIds,
  knownRecordIds = new Set(),
  existingFacts = [],
  expectedSourceRefs = [],
  enforceCorrectionAuthority = false,
  trustedCorrectionIds = [],
  newSourceIds = null,
} = {}) {
  const errors = [];
  const value = isPlainObject(bundle) ? bundle : {};
  const actualScope = value.scope;
  if (!isPlainObject(actualScope)) errors.push('scope is required');
  else if (expectedBinding?.scope && stableStringify(actualScope) !== stableStringify(expectedBinding.scope)) errors.push('scope does not match program binding');
  if (typeof value.operationId !== 'string' || !value.operationId.trim()) errors.push('operationId is required');
  else if (expectedBinding?.operationId && value.operationId !== expectedBinding.operationId) errors.push('operationId does not match program binding');
  if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 0) errors.push('expectedRevision must be a non-negative integer');
  else if (expectedBinding?.expectedRevision !== undefined && value.expectedRevision !== expectedBinding.expectedRevision) errors.push('expectedRevision does not match program binding');
  for (const category of DRAFT_CATEGORIES) {
    if (!(category in value)) errors.push(`missing required category ${category}`);
  }
  for (const category of ['events', 'awarenessChanges', 'entityFactChanges', 'relationshipChanges', 'personaChanges', 'commitmentChanges', 'performanceHints', 'summaryView', 'conflicts']) {
    if (!Array.isArray(value[category])) errors.push(`${category} must be an array`);
  }
  if (!isPlainObject(value.coverage)) errors.push('coverage must be an object');
  const sourceSet = allowedSourceIds ? new Set(allowedSourceIds) : null;
  const knownSet = knownRecordIds instanceof Set ? knownRecordIds : new Set(knownRecordIds ?? []);
  const invalidEventIds = new Set();
  const eventIds = validateEvents(value.events ?? [], sourceSet, errors, invalidEventIds, newSourceIds ? new Set(newSourceIds) : null);
  validateAwareness(value.awarenessChanges ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors);
  const trustedCorrections = trustedCorrectionIds instanceof Set ? trustedCorrectionIds : new Set(trustedCorrectionIds ?? []);
  validateEntityFacts(value.entityFactChanges ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors, existingFacts, { enforceCorrectionAuthority, trustedCorrectionIds: trustedCorrections });
  validateRelationships(value.relationshipChanges ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors);
  validatePersona(value.personaChanges ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors);
  validateCommitments(value.commitmentChanges ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors);
  validateGenericRecords('performanceHints', value.performanceHints ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors);
  validateGenericRecords('summaryView', value.summaryView ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors);
  validateGenericRecords('conflicts', value.conflicts ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors);
  validateCoverage(value.coverage, sourceSet, errors, expectedSourceRefs);
  const isolated = isolateDependencies(value, invalidEventIds);
  const deduped = dedupeEvents(value.events ?? []);
  return {
    valid: errors.length === 0,
    errors,
    isolated,
    duplicateMentions: deduped.duplicates,
    normalized: clone(value),
  };
}

export function assertValidDraftBundle(bundle, options = {}) {
  const result = validateDraftBundle(bundle, options);
  if (!result.valid) throw new ValidationError('DraftBundle validation failed', result);
  return result.normalized;
}

export function validateSummaryBatch(batch) {
  const errors = [];
  try { normalizeScope(batch?.scope); } catch (error) { errors.push(error.message); }
  if (typeof batch?.operationId !== 'string' || !batch.operationId) errors.push('operationId is required');
  if (!Number.isInteger(batch?.expectedRevision) || batch.expectedRevision < 0) errors.push('expectedRevision is invalid');
  if (!Array.isArray(batch?.sourceMessages) || batch.sourceMessages.length === 0) errors.push('sourceMessages is required');
  if (Array.isArray(batch?.sourceMessages)) {
    for (const message of batch.sourceMessages) if (message.complete === false) errors.push(`source ${message.id ?? '?'} is incomplete`);
  }
  return { valid: errors.length === 0, errors };
}

export function splitSummaryBatch(batch, { maxInputUnits = 12000 } = {}) {
  const check = validateSummaryBatch(batch);
  if (!check.valid) throw new ValidationError('invalid SummaryBatch', check.errors);
  const messages = batch.sourceMessages;
  const limit = Math.max(1, Number(maxInputUnits) || 12000);
  const children = [];
  let current = [];
  let currentUnits = 0;
  const flush = () => {
    if (!current.length) return;
    const first = current[0];
    const last = current[current.length - 1];
    const childIndex = children.length;
    children.push({
      ...clone(batch),
      operationId: `${batch.operationId}/child-${childIndex + 1}`,
      expectedRevision: batch.expectedRevision + childIndex,
      parentOperationId: batch.operationId,
      parentRange: clone(batch.parentRange),
      childRange: { startIndex: first.index, endIndex: last.index, childIndex, totalChildren: null },
      sourceMessages: clone(current),
      coverage: {
        ...clone(batch.coverage),
        sourceRefs: current.map((message) => ({ sourceId: message.id, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
        processed: [],
      },
    });
    current = [];
    currentUnits = 0;
  };
  for (const message of messages) {
    const units = estimateUnits(message.text);
    if (current.length && currentUnits + units > limit) flush();
    if (units <= limit) {
      current.push(message);
      currentUnits += units;
      continue;
    }
    // A single long message is split only at text boundaries.  Each fragment
    // carries the same source version and an explicit fragment id.
    const characters = [...message.text];
    let offset = 0;
    let fragmentIndex = 0;
    while (offset < characters.length) {
      // Boundaries preserve original code points. Binary search avoids repeatedly
      // normalizing an ever-growing prefix for each individual character.
      let low=offset+1,high=characters.length,best=offset+1;
      while(low<=high){const end=Math.floor((low+high)/2);if(estimateUnits(characters.slice(offset,end).join(''))<=limit){best=end;low=end+1;}else high=end-1;}
      const piece=characters.slice(offset,best).join('');offset=best;
      if (current.length) flush();
      current.push({ ...clone(message), text: piece, fragmentId: `${message.id}#${fragmentIndex}` });
      currentUnits = estimateUnits(piece);
      flush();
      fragmentIndex += 1;
    }
  }
  flush();
  for (const child of children) {
    child.childRange.totalChildren = children.length;
    child.sourceRevision = sha256({
      scope: child.scope,
      parentRange: child.parentRange,
      sourceMessages: child.sourceMessages.map((message) => ({ id: message.id, role: message.role, text: message.text, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
      bridgeMessages: (child.bridgeMessages ?? []).map((message) => ({ id: message.id, role: message.role, text: message.text, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
    });
  }
  for (let index = 1; index < children.length; index += 1) {
    const previous = children[index - 1].sourceMessages.at(-1);
    children[index].bridgeMessages = [
      ...clone(batch.bridgeMessages ?? []),
      { ...clone(previous), contextOnly: true },
    ];
    children[index].sourceRevision = sha256({
      scope: children[index].scope,
      parentRange: children[index].parentRange,
      sourceMessages: children[index].sourceMessages.map((message) => ({ id: message.id, role: message.role, text: message.text, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
      bridgeMessages: children[index].bridgeMessages.map((message) => ({ id: message.id, role: message.role, text: message.text, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
    });
  }
  if (children.length === 1) {
    children[0].operationId = batch.operationId;
    children[0].expectedRevision = batch.expectedRevision;
    children[0].childRange = { ...children[0].childRange, childIndex: 0, totalChildren: 1 };
  }
  return children;
}

export function requiredCategoryKeys() {
  return [...DRAFT_CATEGORIES];
}
