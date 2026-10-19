import { tokenize } from './search';
import type { Hit } from './types';

/* "Instant" mode: no language model at all. Splits the retrieved passages into sentences,
   ranks them by meaning (the same in-browser embedding model, when loaded) and by shared
   keywords, and quotes the best ones with citations. Works in every browser, offline. */

type Embed = (texts: string[]) => Promise<Float32Array[]>;

const clean = (s: string) => s.replace(/^\s*(?:[-*•◦]|\d+[.)])\s+/, '').replace(/^#+\s*/, '').trim();

/** Best-matching sentences from the given hits; `n` is the hit's citation number. */
export async function rankSentences(question: string, hits: Hit[], embedFn?: Embed, k = 5, offset = 0, depth = 4) {
  const q = new Set(tokenize(question));
  const cands: { s: string; n: number; kw: number; rank: number }[] = [];
  hits.slice(0, depth).forEach((h, i) => {
    for (const raw of h.chunk.text.split(/(?<=[.!?])\s+|\n+/)) {
      const s = clean(raw);
      if (s.length < 25 || s.length > 400) continue;
      const toks = tokenize(s);
      cands.push({ s, n: offset + i + 1, kw: toks.filter((t) => q.has(t)).length / Math.sqrt(toks.length + 1), rank: 1 - i * 0.12 });
    }
  });
  if (!cands.length) return [];

  let sem: number[] = cands.map(() => 0);
  if (embedFn) {
    try {
      const [qv, ...vs] = await embedFn([question, ...cands.map((c) => c.s)]);
      sem = vs.map((v) => v.reduce((acc, x, d) => acc + x * qv[d], 0));
    } catch {
      /* keyword-only ranking */
    }
  }
  const scored = cands.map((c, i) => ({ ...c, score: (embedFn ? 0.6 * sem[i] : 0) + 0.3 * c.kw + 0.1 * c.rank }));
  const seen = new Set<string>();
  return scored
    .sort((a, b) => b.score - a.score)
    .filter((c) => !seen.has(c.s) && seen.add(c.s))
    .slice(0, k);
}

export async function extractive(question: string, hits: Hit[], embedFn?: Embed, maxSentences = 5): Promise<string> {
  if (!hits.length) return 'No matching passages in your documents.';
  const best = await rankSentences(question, hits, embedFn, maxSentences);
  if (!best.length) return `The closest passage is [1]:\n\n> ${hits[0].chunk.text.slice(0, 400)}…`;
  return best.map((b) => `- ${b.s} [${b.n}]`).join('\n');
}

/**
 * Context compression for small on-device models: keep only the few sentences of each
 * retrieved passage that best match the question (in their original order). Citation
 * numbers are unchanged because the passage order is unchanged.
 */
export async function compressHits(question: string, hits: Hit[], embedFn?: Embed, perHit = 3): Promise<Hit[]> {
  const split = hits.map((h) => h.chunk.text.split(/(?<=[.!?])\s+|\n+/).map(clean).filter((s) => s.length >= 20));
  const flat = split.flat();
  if (!flat.length) return hits;
  let sims: number[] = flat.map(() => 0);
  if (embedFn) {
    try {
      const [qv, ...vs] = await embedFn([question, ...flat]);
      sims = vs.map((v) => v.reduce((acc, x, d) => acc + x * qv[d], 0));
    } catch {
      /* fall back to keyword overlap below */
    }
  }
  const q = new Set(tokenize(question));
  let k = 0;
  return hits.map((h, i) => {
    const scored = split[i].map((s, j) => {
      const toks = tokenize(s);
      const kw = toks.filter((t) => q.has(t)).length / Math.sqrt(toks.length + 1);
      return { s, j, score: sims[k++] + 0.3 * kw };
    });
    const keep = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, perHit)
      .sort((a, b) => a.j - b.j)
      .map((x) => x.s);
    return { ...h, chunk: { ...h.chunk, text: keep.join(' ') || h.chunk.text } };
  });
}

/**
 * Instant-mode overview without a model: names the document type from its title, then
 * quotes the sentences most central to the document (closest to its average meaning),
 * in reading order, so it reads as "what this document says", not keyword matches.
 */
export async function extractiveOverview(
  chosen: { name: string; kind: string; title: string; hits: { hit: Hit; n: number }[] }[],
  embedFn?: Embed,
): Promise<string> {
  const parts: string[] = [];
  for (const c of chosen) {
    const sents: { s: string; n: number; order: number }[] = [];
    const seen = new Set<string>(); // overlapping chunks repeat sentences
    c.hits.forEach(({ hit, n }, hi) => {
      hit.chunk.text
        .split(/(?<=[.!?])\s+|\n+/)
        .map(clean)
        .filter((s) => s.length >= 40 && s.length <= 320 && s !== c.title && !/^(owner|author|status|severity)\b/i.test(s))
        .forEach((s, si) => {
          if (seen.has(s)) return;
          seen.add(s);
          sents.push({ s, n, order: hi * 1000 + si });
        });
    });
    let picked = sents.slice(0, 3);
    if (embedFn && sents.length > 3) {
      try {
        const vs = await embedFn(sents.map((x) => x.s));
        const centroid = new Float32Array(vs[0].length);
        vs.forEach((v) => v.forEach((x, d) => (centroid[d] += x / vs.length)));
        // Central to the document's meaning, with a nudge towards the scene-setting opening.
        const score = vs.map((v, i) => v.reduce((acc, x, d) => acc + x * centroid[d], 0) + 0.08 * (1 - i / vs.length));
        picked = sents
          .map((x, i) => ({ ...x, score: score[i] }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .sort((a, b) => a.order - b.order);
      } catch {
        /* keep the opening sentences */
      }
    }
    const article = /^[aeiou]/i.test(c.kind) ? 'an' : 'a';
    const intro = `**${c.name}** is ${article} ${c.kind}${c.title ? ` titled “${c.title}”` : ''}.`;
    parts.push(`${intro} ${picked.map((p) => `${p.s} [${p.n}]`).join(' ')}`);
  }
  return parts.join('\n\n');
}
