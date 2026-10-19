import type { ChatMessage, Doc, Hit } from './types';

/* Prompt builders. Every passage is numbered so the model can cite it as [n]; the UI
   turns those markers into clickable source chips. */

const SYSTEM = `You are Corpus, a careful research assistant. Answer ONLY from the numbered passages provided.
Cite every claim with the passage number in square brackets, like [2] or [1][3].
If the passages do not contain the answer, say so plainly instead of guessing.
Be concise: short paragraphs or bullet points, plain language, keep numbers exact.`;

const label = (h: Hit, docs: Map<string, Doc>) => {
  const d = docs.get(h.chunk.docId);
  const page = d && d.pages.length > 1 ? `, p.${h.chunk.page}` : '';
  return `${d?.name ?? 'document'}${page}`;
};

export const context = (hits: Hit[], docs: Map<string, Doc>) =>
  hits.map((h, i) => `[${i + 1}] (${label(h, docs)})\n${h.chunk.text}`).join('\n\n');

export function answerMessages(question: string, hits: Hit[], docs: Map<string, Doc>, history: ChatMessage[]): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    ...history.slice(-4),
    { role: 'user', content: `Passages:\n\n${context(hits, docs)}\n\nQuestion: ${question}` },
  ];
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
