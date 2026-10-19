import { tokenize } from './search';
import type { ChatMessage, Doc, Hit } from './types';

/* Prompt builders. Every passage is numbered so the model can cite it as [n]; the UI
   turns those markers into clickable source chips. */

const SYSTEM = `You are Corpus, a careful research assistant. Answer ONLY from the numbered passages provided.
Cite every claim with the passage number in square brackets, like [2] or [1][3].
If the passages do not contain the answer, say so plainly instead of guessing.
When documents disagree, treat the newest version or date as current and say what changed.
Be concise: short paragraphs or bullet points, plain language, keep numbers exact.`;

/** First line of a document, used as its title (often carries a version or date). */
const title = (d?: Doc) => d?.pages[0]?.text.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').slice(0, 90) ?? '';

const label = (h: Hit, docs: Map<string, Doc>) => {
  const d = docs.get(h.chunk.docId);
  const page = d && d.pages.length > 1 ? `, p.${h.chunk.page}` : '';
  const t = title(d);
  return `${d?.name ?? 'document'}${page}${t ? ` — “${t}”` : ''}`;
};

export const context = (hits: Hit[], docs: Map<string, Doc>) =>
  hits.map((h, i) => `[${i + 1}] (${label(h, docs)})\n${h.chunk.text}`).join('\n\n');

/** Small on-device models follow instructions placed right next to the question best. */
const COMPACT_RULES = `Answer in at most 120 words, as 2–5 short bullet points.
End every bullet with the number of the passage it comes from, like [2].
Use only the passages. If they don't contain the answer, say "The documents don't say."
If documents disagree, the newest version or date is the current one; mention older values only as "previously".`;

export function answerMessages(question: string, hits: Hit[], docs: Map<string, Doc>, history: ChatMessage[], compact = false): ChatMessage[] {
  if (compact) {
    return [
      { role: 'system', content: 'You answer questions using numbered passages from the user\'s documents, citing them.' },
      { role: 'user', content: `Passages:\n\n${context(hits.slice(0, 5), docs)}\n\nQuestion: ${question}\n\n${COMPACT_RULES}` },
    ];
  }
  return [
    { role: 'system', content: SYSTEM },
    ...history.slice(-4),
    { role: 'user', content: `Passages:\n\n${context(hits, docs)}\n\nQuestion: ${question}` },
  ];
}

/**
 * Safety net for small models that forget to cite: any bullet or sentence without a [n]
 * gets the passage it overlaps most with (if the overlap is meaningful).
 */
export function ensureCitations(text: string, hits: Hit[]): string {
  if (/\[\d+\]/.test(text) || !hits.length) return text.replace(/^\s*Answer:\s*/i, '');
  const passages = hits.map((h) => new Set(tokenize(h.chunk.text)));
  const cite = (line: string) => {
    const toks = tokenize(line);
    if (toks.length < 3) return line;
    let best = -1, score = 0;
    passages.forEach((p, i) => {
      const s = toks.filter((t) => p.has(t)).length / toks.length;
      if (s > score) [best, score] = [i, s];
    });
    return best >= 0 && score >= 0.35 ? `${line.replace(/\s+$/, '')} [${best + 1}]` : line;
  };
  return text
    .replace(/^\s*Answer:\s*/i, '')
    .split('\n')
    .map((line) => (/^\s*(?:[-*•]|\d+\.)\s+\S/.test(line) || line.trim().length > 60 ? cite(line) : line))
    .join('\n');
}

export function compareMessages(aspect: string, hits: Hit[], docs: Map<string, Doc>, chosen: Doc[]): ChatMessage[] {
  const names = chosen.map((d) => d.name).join(' | ');
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Passages:\n\n${context(hits, docs)}\n\nCompare these documents: ${names}.
Focus: ${aspect || 'their main points, differences and anything that changed'}.
Reply with a Markdown table: first column "Aspect", then one column per document (use the file names as headers). 4–7 rows. Put citations inside the cells. Write "not mentioned" where a document is silent.
After the table, add 2–3 bullet points on the most important differences.`,
    },
  ];
}

export function summaryMessages(doc: Doc, hits: Hit[], docs: Map<string, Doc>): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Passages from "${doc.name}":\n\n${context(hits, docs)}\n\nGive insights about this document: a one-sentence summary, then 4–6 bullet points with the key facts, numbers, decisions or risks. Cite passages.`,
    },
  ];
}
