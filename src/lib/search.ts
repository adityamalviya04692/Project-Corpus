import type { Chunk, Hit } from './types';

/* Hybrid retrieval: cosine similarity on normalised embeddings (meaning) blended with
   BM25 (exact terms like table names, error codes, numbers). Brute force is plenty for
   a few thousand chunks and keeps everything inspectable. */

const STOP = new Set(
  'a an and are as at be but by for from has have how i if in into is it its of on or that the their there these this to was were what when where which who why will with you your does do can about vs versus compare between'.split(' '),
);

// Light suffix stemming so "fixed" matches "fix" and "skewed" matches "skew".
const stem = (t: string) => (t.length > 4 ? t.replace(/(?:ing|ed|es|s)$/, '') : t);

export const tokenize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);

export class Index {
  chunks: Chunk[] = [];
  /** One per chunk; undefined while that chunk is still being embedded. */
  vectors: (Float32Array | undefined)[] = [];
  private tf: Map<string, number>[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  build(chunks: Chunk[], vectors: (Float32Array | undefined)[]) {
    this.chunks = chunks;
    this.vectors = vectors;
    this.df.clear();
    this.tf = chunks.map((c) => {
      const m = new Map<string, number>();
      for (const t of tokenize(c.text)) m.set(t, (m.get(t) ?? 0) + 1);
      for (const t of m.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return m;
    });
    this.avgLen = this.tf.reduce((s, m) => s + [...m.values()].reduce((a, b) => a + b, 0), 0) / Math.max(1, chunks.length);
  }

  get bytes() {
    return this.vectors.reduce((s, v) => s + (v?.byteLength ?? 0), 0);
  }

  private bm25(i: number, terms: string[]) {
    const m = this.tf[i];
    const len = [...m.values()].reduce((a, b) => a + b, 0);
    const N = this.chunks.length;
    let s = 0;
    for (const t of terms) {
      const f = m.get(t);
      if (!f) continue;
      const df = this.df.get(t) ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      s += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (len / (this.avgLen || 1))));
    }
    return s;
  }

  search(query: string, qvec: Float32Array | null, k = 6, docIds?: Set<string>, alpha = 0.7): Hit[] {
    const terms = tokenize(query);
    const rows: Hit[] = [];
    let maxK = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (docIds && !docIds.has(c.docId)) continue;
      let vector = 0;
      const v = this.vectors[i];
      if (qvec && v) for (let d = 0; d < v.length; d++) vector += v[d] * qvec[d];
      const keyword = this.bm25(i, terms);
      maxK = Math.max(maxK, keyword);
      rows.push({ chunk: c, vector, keyword, score: 0 });
    }
    const a = qvec ? alpha : 0; // keyword-only until embeddings are ready
    for (const r of rows) r.score = a * Math.max(0, r.vector) + (1 - a) * (maxK ? r.keyword / maxK : 0);
    rows.sort((x, y) => y.score - x.score);
    return qvec ? this.mmr(rows.slice(0, k * 4), k) : rows.slice(0, k);
  }

  /**
   * Maximal Marginal Relevance: pick passages that are relevant AND not near-duplicates
   * of ones already picked (overlapping chunks, repeated boilerplate), so the model sees
   * more distinct evidence in the same budget.
   */
  private mmr(cands: Hit[], k: number, lambda = 0.75): Hit[] {
    const vec = (h: Hit) => this.vectors[this.chunks.indexOf(h.chunk)];
    const picked: Hit[] = [];
    const pool = [...cands];
    while (picked.length < k && pool.length) {
      let best = 0;
      let bestScore = -Infinity;
      pool.forEach((c, i) => {
        const v = vec(c);
        let maxSim = 0;
        if (v)
          for (const p of picked) {
            const pv = vec(p);
            if (!pv) continue;
            let dot = 0;
            for (let d = 0; d < v.length; d++) dot += v[d] * pv[d];
            maxSim = Math.max(maxSim, dot);
          }
        const s = lambda * c.score - (1 - lambda) * maxSim;
        if (s > bestScore) [best, bestScore] = [i, s];
      });
      picked.push(pool.splice(best, 1)[0]);
    }
    return picked;
  }

  /** Evenly spaced chunks from one document, for summaries. */
  spread(docId: string, n: number): Chunk[] {
    const own = this.chunks.filter((c) => c.docId === docId);
    if (own.length <= n) return own;
    return Array.from({ length: n }, (_, i) => own[Math.round((i * (own.length - 1)) / (n - 1))]);
  }
}
