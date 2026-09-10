import { ShiyiError, SummaryResponseError } from './errors.js';
import { clone, decodeUtf8Chunk } from './utils.js';

export const PROVIDER_RESOURCES = Object.freeze({
  chat: '/chat/completions',
  embeddings: '/embeddings',
  models: '/models',
  rerank: '/rerank',
});

function trimSlashes(value) {
  return String(value ?? '').replace(/^\/+|\/+$/gu, '');
}

function normalizeMode(profile) {
  const mode = profile?.endpointMode ?? profile?.mode ?? 'base';
  if (mode !== 'base' && mode !== 'exact') throw new ShiyiError('endpoint mode must be base or exact', 'PROVIDER_PROFILE_INVALID');
  return mode;
}

function resourcePath(resource, profile = {}) {
  if (typeof resource === 'string' && resource.startsWith('/')) return resource;
  const name = resource === 'chatCompletions' ? 'chat' : resource;
  if (name === 'rerank') {
    const explicit = profile.rerankResource ?? profile.rerankPath;
    if (explicit) return String(explicit).startsWith('/') ? String(explicit) : `/${explicit}`;
  }
  if (!PROVIDER_RESOURCES[name]) throw new ShiyiError(`unknown provider resource: ${String(resource)}`, 'PROVIDER_RESOURCE_INVALID');
  return PROVIDER_RESOURCES[name];
}

function ensureUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new ShiyiError('provider URL is required', 'PROVIDER_PROFILE_INVALID');
  try { return new URL(value.trim()); } catch (error) { throw new ShiyiError('provider URL is invalid', 'PROVIDER_PROFILE_INVALID', { cause: error.message }); }
}

/**
 * Resolve only the resource selected by the caller.  In particular, `/v1` is
 * never added implicitly and exact mode does not attempt model-list guessing.
 */
export function resolveProviderEndpoint(profile = {}, resource = 'chat') {
  const mode = normalizeMode(profile);
  const input = profile.endpoint ?? profile.url ?? profile.baseUrl;
  const url = ensureUrl(input);
  if (mode === 'exact') return String(input).trim();
  const path = resourcePath(resource, profile);
  const existing = url.pathname.replace(/\/$/u, '');
  if (existing === path || existing.endsWith(path)) return url.toString().replace(/\/$/u, '');
  url.pathname = `${existing}/${trimSlashes(path)}`;
  return url.toString().replace(/\/$/u, '');
}

export function normalizeProviderProfile(profile = {}) {
  const endpointMode = normalizeMode(profile);
  const url = profile.endpoint ?? profile.url ?? profile.baseUrl;
  ensureUrl(url);
  const authMode = profile.authMode ?? 'bearer';
  if (!['none', 'bearer', 'api-key', 'custom'].includes(authMode)) throw new ShiyiError('unsupported authMode', 'PROVIDER_PROFILE_INVALID');
  return {
    endpointMode,
    url: String(url).trim(),
    model: profile.model ? String(profile.model) : '',
    authMode,
    apiKey: profile.apiKey == null ? '' : String(profile.apiKey),
    apiKeyHeader: profile.apiKeyHeader ? String(profile.apiKeyHeader) : 'x-api-key',
    timeoutMs: Number.isFinite(profile.timeoutMs) ? profile.timeoutMs : 120000,
    rerankResource: profile.rerankResource,
  };
}

export function buildProviderHeaders(profile = {}, extra = {}) {
  const normalized = normalizeProviderProfile(profile);
  const headers = { 'content-type': 'application/json', ...extra };
  const key = normalized.apiKey.trim();
  if (normalized.authMode === 'none' || !key) return headers;
  if (normalized.authMode === 'api-key') headers[normalized.apiKeyHeader] = key;
  else if (normalized.authMode === 'custom') headers[normalized.apiKeyHeader] = key;
  else headers.authorization = `Bearer ${key}`;
  return headers;
}

async function readBody(response) {
  if (response?.aborted || response?.bodyAborted || response?.truncated) throw new SummaryResponseError('provider response body was interrupted', { aborted: true });
  try {
    if (typeof response === 'string') return response;
    if (response?.body && typeof response.body !== 'string' && response.body[Symbol.asyncIterator]) {
      const chunks = [];
      for await (const chunk of response.body) chunks.push(decodeUtf8Chunk(chunk));
      return chunks.join('');
    }
    if (typeof response?.text === 'function') return await response.text();
    if (typeof response?.body === 'string') return response.body;
    if (response?.body !== undefined) return JSON.stringify(response.body);
    return JSON.stringify(response);
  } catch (error) {
    throw new SummaryResponseError('provider response body could not be read', { cause: error.message, aborted: true });
  }
}

export async function parseProviderJson(response, { requireStatus = true } = {}) {
  const status = Number(response?.status ?? response?.statusCode ?? 200);
  if (requireStatus && (status < 200 || status >= 300)) {
    const body = await readBody(response).catch(() => '');
    const header=response?.headers?.get?.('retry-after'),seconds=header&&Number(header);
    const retryAfterMs=header?(Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(header)-Date.now())):0;
    throw new ShiyiError(`provider returned HTTP ${status}`, 'PROVIDER_HTTP_ERROR', { status, body: body.slice(0, 1000),...(Number.isFinite(retryAfterMs)&&retryAfterMs>0?{retryAfterMs}: {}) });
  }
  const text = await readBody(response);
  try { return JSON.parse(text); } catch (error) {
    throw new SummaryResponseError('provider returned invalid JSON', { cause: error.message, bodyPrefix: text.slice(0, 200) });
  }
}

/** Shared transport for connection tests and real summary/vector/rerank work. */
export class ProviderClient {
  constructor(profile, { fetchImpl = globalThis.fetch, recordRequests = true } = {}) {
    this.profile = normalizeProviderProfile(profile);
    if (typeof fetchImpl !== 'function') throw new ShiyiError('fetch implementation is required', 'PROVIDER_FETCH_UNAVAILABLE');
    this.fetch = fetchImpl;
    this.requestLog = [];
    this.recordRequests = recordRequests;
  }

  async request(resource, payload, { signal, timeoutMs, headers = {}, method = 'POST' } = {}) {
    const url = resolveProviderEndpoint(this.profile, resource);
    const requestHeaders = buildProviderHeaders(this.profile, headers);
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) relayAbort();
    else signal?.addEventListener('abort', relayAbort, { once: true });
    const effectiveTimeout = timeoutMs ?? this.profile.timeoutMs;
    let timer = null;
    let timedOut = false;
    if (Number.isFinite(effectiveTimeout) && effectiveTimeout > 0) {
      timer = setTimeout(() => { timedOut = true; controller.abort('provider request timeout'); }, effectiveTimeout);
    }
    const init = {
      method,
      headers: requestHeaders,
      signal: controller.signal,
    };
    if (method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(payload ?? {});
    if (this.recordRequests) this.requestLog.push({ resource, url, payload: clone(payload), headers: clone(requestHeaders) });
    let onAbort;
    const canceled = new Promise((_, reject) => {
      onAbort = () => reject(new ShiyiError('request canceled', 'CANCELED'));
      if (controller.signal.aborted) onAbort(); else controller.signal.addEventListener('abort', onAbort, { once:true });
    });
    try {
      return await Promise.race([(async () => { if(controller.signal.aborted)throw new ShiyiError('request canceled','CANCELED'); return parseProviderJson(await this.fetch(url, init)); })(), canceled]);
    } catch (error) {
      if (timedOut) {
        const timeoutError = new ShiyiError(`${resource} request timed out`, 'TIMEOUT', { timeoutMs: effectiveTimeout });
        throw timeoutError;
      }
      if(error?.code||error?.name==='AbortError')throw error;
      throw new ShiyiError('provider network request failed', 'network.request_failed', error?.details);
    } finally {
      if (timer) clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      signal?.removeEventListener('abort', relayAbort);
    }
  }

  async chatCompletions(payload, options = {}) { return this.request('chat', payload, options); }
  async embeddings(payload, options = {}) { return this.request('embeddings', payload, options); }
  async rerank(payload, options = {}) { return this.request('rerank', payload, options); }
  async models(payload = {}, options = {}) { return this.request('models', payload, { ...options, method: options.method ?? 'GET' }); }

  /** Uses the exact same task adapter as the eventual operation. */
  async testConnection({ task = 'chat', payload = {}, ...options } = {}) {
    const method = task === 'embedding' || task === 'embeddings'
      ? this.embeddings.bind(this)
      : task === 'rerank'
        ? this.rerank.bind(this)
        : task === 'models'
          ? this.models.bind(this)
          : this.chatCompletions.bind(this);
    const result = await method(payload, options);
    return { ok: true, task, result };
  }
}

export function createProviderClient(profile, options = {}) {
  return new ProviderClient(profile, options);
}
