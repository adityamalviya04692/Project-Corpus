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
  return best.map((b) => `- ${b.s} [${b.n}]`).join('\n') + '\n\n_Instant mode quotes your documents directly. Load the in-browser AI or add a key for written answers._';
}
