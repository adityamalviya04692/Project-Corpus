import { describe, expect, it } from 'vitest';
import { chunkDoc } from './chunk';
import type { Doc } from './types';

const doc = (text: string, pages = 1): Doc => ({
  id: 'd', name: 'd.txt', kind: 'text', bytes: text.length, chars: text.length, parseMs: 0,
  pages: Array.from({ length: pages }, (_, i) => ({ page: i + 1, text })),
});

describe('chunkDoc', () => {
  it('keeps short documents as a single chunk', () => {
    expect(chunkDoc(doc('One short paragraph.'))).toHaveLength(1);
  });
  it('respects the size budget and carries overlap', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about lakehouse tables.`).join(' ');
    const chunks = chunkDoc(doc(text), 300, 80);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(300 + 80);
    // The next chunk opens with the previous chunk's closing sentence (the overlap).
    const lastSentence = chunks[0].text.split('\n').pop()!;
    expect(chunks[1].text.startsWith(lastSentence)).toBe(true);
  });
  it('never spans pages, so citations are exact', () => {
    const chunks = chunkDoc(doc('Alpha beta gamma.', 3));
    expect(chunks.map((c) => c.page)).toEqual([1, 2, 3]);
  });
});
