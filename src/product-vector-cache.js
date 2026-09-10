import { sha256, throwIfAborted, abortError } from './utils.js';

export function vectorNorm(vector) {
  if (!Array.isArray(vector) || !vector.length || vector.some(value => !Number.isFinite(value))) return 0;
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return Number.isFinite(norm) ? norm : 0;
}

export function validVectorEntry(entry) {
  if(!vectorNorm(entry?.vector))return false;
  return entry.segments===undefined || Array.isArray(entry.segments)&&entry.segments.length>0&&entry.segments.every(v=>Array.isArray(v)&&v.length===entry.vector.length&&vectorNorm(v));
}

export function vectorIndexCoverage(cards, entries, hash) {
  let indexed=0,stale=0,missing=0;
  const dimensions=new Set();
  for(const card of cards){const entry=entries.get(card.id);if(entry?.hash===hash(card)&&entry.norm){indexed++;dimensions.add(entry.vector.length);}else if(entry)stale++;else missing++;}
  // A mixed embedding space is not a complete usable index.
  return {total:cards.length,indexed,pending:cards.length-indexed,stale,missing,dimensions:[...dimensions],mixed:dimensions.size>1};
}

/** Derived, per-chat memory only. No credentials, query text or vectors are
 * exported to settings, reports or other application instances.
 */
export class ProductVectorCache {
  constructor() { this.generation = 0; this.clear(); }
  clear() {
    this.generation++;
    this.workspace = null; this.key = null; this.entries = null; this.pending = null;
    this.queries = new Map(); this.hashes = new WeakMap();
  }
  hash(card) {
    const previous = this.hashes.get(card);
    if (previous?.text === card.text) return previous.hash;
    const hash = sha256(card.text);
    this.hashes.set(card, { text: card.text, hash });
    return hash;
  }
  async load(workspace, key, signal) {
    throwIfAborted(signal);
    if (this.workspace !== workspace || this.key !== key) {
      this.clear(); this.workspace = workspace; this.key = key;
    }
    if (this.entries) return this.entries;
    if (this.pending && !this.pending.signal?.aborted) return this.pending.promise;
    const generation = this.generation;
    const pending = {};
    const promise = Promise.resolve().then(async () => {
      const raw = await workspace.read(key, {});
      throwIfAborted(signal);
      if (generation !== this.generation || this.pending !== pending) throw abortError('vector scope changed');
      const entries = new Map();
      let processed = 0;
      for (const [id, entry] of Object.entries(raw ?? {})) {
        const norm = validVectorEntry(entry)?vectorNorm(entry.vector):0;
        if (norm && typeof entry.hash === 'string') entries.set(id, { ...entry, norm,segmentNorms:entry.segments?.map(vectorNorm) });
        if (++processed % 128 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
          throwIfAborted(signal);
          if (generation !== this.generation || this.pending !== pending) throw abortError('vector scope changed');
        }
      }
      this.entries = entries;
      return entries;
    });
    Object.assign(pending, { promise, signal }); this.pending = pending;
    try { return await promise; }
    finally { if (this.pending === pending) this.pending = null; }
  }
  async query(query, request, signal) {
    throwIfAborted(signal);
    if (this.queries.has(query)) {
      const value = this.queries.get(query);
      this.queries.delete(query); this.queries.set(query, value);
      return value;
    }
    const generation = this.generation;
    const vector = await request();
    throwIfAborted(signal);
    if (generation !== this.generation) throw abortError('vector configuration changed');
    const norm = vectorNorm(vector);
    if (!norm) throw new Error('查询向量无效');
    const value = { vector: [...vector], norm };
    this.queries.set(query, value);
    while (this.queries.size > 16) this.queries.delete(this.queries.keys().next().value);
    return value;
  }
  async search(entries, cards, query, { limit, fingerprint, signal, tagLanes=[],categoryLanes=[] } = {}) {
    const generation = this.generation;
    const check = () => { throwIfAborted(signal); if (generation !== this.generation) throw abortError('vector snapshot changed'); };
    check();
    const matches = [];
    let processed = 0;
    for (const card of cards) {
      const entry = entries.get(card.id);
      if (entry?.hash === this.hash(card) && entry.vector.length === query.vector.length) {
        let score=-Infinity;
        const vectors=entry.segments??[entry.vector];
        for(let part=0;part<vectors.length;part++){
          const vector=vectors[part];
          let dot = 0;
          for (let i = 0; i < vector.length; i++) dot += vector[i] * query.vector[i];
          score=Math.max(score,dot / ((entry.segmentNorms?.[part]??(vector===entry.vector?entry.norm:vectorNorm(vector))) * query.norm));
        }
        if (Number.isFinite(score)) matches.push({ id: card.id, score, embeddingSpace: fingerprint, tags:card.tags??[],category:card.category });
      }
      if (++processed % 128 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        check();
      }
    }
    check();
    const ranked=matches.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
    const result=new Map(ranked.slice(0,limit).map(item=>[item.id,item]));
    // Reuse one query embedding and one cosine pass for the global and tag
    // lanes. Filtered candidates can enter even below the global top-k.
    for(const lane of tagLanes.slice(0,4))for(const item of ranked.filter(x=>x.tags.includes(lane.tag)).slice(0,Math.min(lane.limit,20)))result.set(item.id,item);
    for(const lane of categoryLanes.slice(0,12))for(const item of ranked.filter(x=>x.category===lane.category).slice(0,Math.min(lane.limit,20)))result.set(item.id,item);
    return [...result.values()].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).map(({tags,category,...item})=>item);
  }
}
