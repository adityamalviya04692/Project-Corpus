import { tokenize } from './search';
import type { Hit } from './types';

/* Finds the sentence in a cited passage that actually backs the claim citing it, so the
   UI can show proof (a hover preview and a highlight) instead of a passage's first line. */

const SENT = /(?<=[.!?])\s+|\n+/;
const tidy = (s: string) => s.replace(/^\s*(?:[-*•]|\d+[.)]|#+)\s*/, '').trim();

/** Numbers actually cited in an answer, in order of first appearance. */
export const citedNumbers = (text: string) => [...new Set([...text.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])))];

export function supportFor(answer: string, n: number, hit: Hit): string {
  const claims = answer
    .split('\n')
    .filter((l) => l.includes(`[${n}]`))
    .join(' ')
    .replace(/\[\d+\]/g, '');
  const want = new Set(tokenize(claims));
  const sentences = hit.chunk.text.split(SENT).map(tidy).filter((s) => s.length >= 20);
  if (!sentences.length) return tidy(hit.chunk.text).slice(0, 200);
  let best = sentences[0];
  let score = -1;
  for (const s of sentences) {
    const toks = tokenize(s);
    const v = toks.filter((t) => want.has(t)).length / Math.sqrt(toks.length + 1);
    if (v > score) [best, score] = [s, v];
  }
  return best;
}

/** Every citation occurrence in reading order, each with the line that makes the claim. */
export function citationOccurrences(text: string): { n: number; line: string }[] {
  const out: { n: number; line: string }[] = [];
  for (const line of text.split('\n')) for (const m of line.matchAll(/\[(\d{1,2})\]/g)) out.push({ n: Number(m[1]), line });
  return out;
}
