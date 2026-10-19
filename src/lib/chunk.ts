import type { Chunk, Doc } from './types';

/* Recursive-style chunking: paragraphs first, sentences when a paragraph is too long,
   packed up to `size` characters with a sentence-aligned `overlap` carried forward so
   an answer that straddles a boundary is still retrievable. Chunks never span pages,
   which keeps citations exact. */

const SENTENCE = /(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/;

function units(text: string, size: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    // Join wrapped lines, but keep list items and headings on their own lines.
    const p = para.replace(/[ \t]*\n[ \t]*(?!(?:[-*•]|\d+[.)]|#+)\s)/g, ' ').trim();
    if (!p) continue;
    if (p.length <= size) {
      out.push(p);
      continue;
    }
    for (const s of p.split(SENTENCE)) {
      // A single sentence longer than a chunk is hard-wrapped on word boundaries.
      if (s.length <= size) out.push(s);
      else for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
    }
  }
  return out;
}

function tail(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return overlap > 0 ? text : '';
  const cut = text.slice(-overlap);
  const start = cut.search(SENTENCE);
  return (start >= 0 ? cut.slice(start).trim() : cut.slice(cut.indexOf(' ') + 1)).trim();
}

export function chunkDoc(doc: Doc, size = 900, overlap = 150): Chunk[] {
  const chunks: Chunk[] = [];
  for (const { page, text } of doc.pages) {
    let buf = '';
    const flush = () => {
      if (!buf.trim()) return;
      chunks.push({ id: `${doc.id}#${chunks.length}`, docId: doc.id, page, index: chunks.length, text: buf.trim() });
      buf = tail(buf, overlap);
    };
    for (const u of units(text, size)) {
      if (buf && buf.length + u.length + 1 > size) flush();
      buf = buf ? `${buf}\n${u}` : u;
    }
    // Last piece of the page, unless it is only the overlap tail we already emitted.
    const prev = chunks[chunks.length - 1];
    if (buf.trim() && (!prev || prev.page !== page || !prev.text.endsWith(buf.trim()))) flush();
  }
  return chunks;
}
