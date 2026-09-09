import { clone, sha256, stableStringify, makeId } from './utils.js';
import { isMissingProductEntry } from './product-host-adapters.js';

const NS = 'shiyi-product-workspace';
const queues = new WeakMap();

/** Small UI/assistant documents; memory facts remain in MemoryRepository. */
export function createWorkspace(bound) {
  const { store, scope, isCurrent } = bound;
  const prefix = sha256(scope).slice(0, 24);
  const guard = () => { if (!isCurrent()) throw new Error('聊天已变化，请重新打开当前聊天'); };
  async function read(name, fallback = null) {
    guard();
    const key = `${prefix}-${name}`;
    let found;
    try { found = store.tryGetJson ? await store.tryGetJson({ namespace: NS, key }) : { found: true, value: await store.getJson({ namespace: NS, key }) }; }
    catch (error) {
      if (!store.tryGetJson && isMissingProductEntry(error)) found = { found:false };
      else throw new Error('当前聊天资料读取失败，请重试');
    }
    guard();
    return clone(found?.found && found.value !== undefined ? found.value : fallback);
  }
  async function write(name, value) {
    guard();
    const frozen = clone(value);
    await store.setJson({ namespace: NS, key: `${prefix}-${name}`, value: frozen });
    guard();
    const actual = await read(name);
    if (stableStringify(actual) !== stableStringify(frozen)) throw new Error('保存读回不一致，尚未确认保存');
    return actual;
  }
  function update(name, callback, fallback = null) {
    let byKey = queues.get(store); if (!byKey) { byKey = new Map(); queues.set(store, byKey); }
    const key = `${prefix}-${name}`;
    const operation = (byKey.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => write(name, await callback(await read(name, fallback))));
    byKey.set(key, operation);
    return operation.finally(() => { if (byKey.get(key) === operation) byKey.delete(key); });
  }
  async function remove(name) {
    guard();
    if (await read(name) === null) return;
    if (!store.deleteJson) throw new Error('宿主不支持删除');
    await store.deleteJson({ namespace: NS, key: `${prefix}-${name}` });
    if (await read(name) !== null) throw new Error('删除未通过读回确认');
  }
  return { read, write, update, remove, isCurrent, scope: clone(scope) };
}

export function splitDocument(text, { maxChars = 6000 } = {}) {
  const source = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const chunks = [];
  for (let start = 0; start < source.length;) {
    let end = Math.min(source.length, start + maxChars);
    if (end < source.length) { const breakAt = source.lastIndexOf('\n', end); if (breakAt > start + maxChars / 2) end = breakAt + 1; }
    if (end < source.length && /[\uD800-\uDBFF]/.test(source[end - 1])) end -= 1;
    chunks.push({ start, end, text: source.slice(start, end) }); start = end;
  }
  return chunks;
}

export async function importTextDocument(workspace, { name, text, purpose = 'knowledge' }) {
  if (!['rules', 'knowledge'].includes(purpose)) throw new Error('请选择配置规则或世界资料');
  if (!/\.(md|txt|json)$/i.test(name)) throw new Error('支持 MD、TXT、JSON 文本');
  if (typeof text !== 'string' || !text.trim()) throw new Error('文件没有可读取的文字');
  if (new TextEncoder().encode(text).length > 20 * 1024 * 1024) throw new Error('单个文件上限 20 MB，请拆分后导入');
  if (/\.json$/i.test(name)) {
    try { JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch { throw new Error('JSON 格式无效，请修正后重新导入；原有资料未改变'); }
  }
  const id = makeId('doc');
  const chunks = splitDocument(text);
  for (let i = 0; i < chunks.length; i++) await workspace.write(`${id}-${i}`, chunks[i]);
  const doc = { id, name: String(name).slice(0, 240), purpose, chars: text.length, chunks: chunks.length, hash: sha256(text), createdAt: Date.now(), analyzed: 0 };
  await workspace.update('documents', list => [...list, doc], []);
  return doc;
}
