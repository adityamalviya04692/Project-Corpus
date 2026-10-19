import { describe, expect, it } from 'vitest';
import { Index, tokenize } from './search';
import type { Chunk } from './types';

const c = (i: number, text: string, docId = 'a'): Chunk => ({ id: `${docId}#${i}`, docId, page: 1, index: i, text });

describe('Index', () => {
  const chunks = [c(0, 'Delta Lake MERGE handles SCD Type 2 updates'), c(1, 'Kafka streams events into bronze tables'), c(2, 'Quarterly budget review notes', 'b')];
  const vec = (x: number[]) => Float32Array.from(x);
  const idx = new Index();
  idx.build(chunks, [vec([1, 0]), vec([0, 1]), vec([0.7, 0.7])]);

  it('ranks exact keyword matches when no query vector is available', () => {
    expect(idx.search('SCD Type 2', null, 1)[0].chunk.id).toBe('a#0');
  });
  it('blends vector similarity in', () => {
    expect(idx.search('streaming', vec([0, 1]), 1)[0].chunk.id).toBe('a#1');
  });
  it('filters by document', () => {
    expect(idx.search('budget', null, 3, new Set(['b'])).map((h) => h.chunk.docId)).toEqual(['b']);
  });
  it('drops stop words', () => {
    expect(tokenize('What is the SCD of it')).toEqual(['scd']);
  });
  it('stems simple suffixes so word forms match', () => {
    expect(tokenize('fixed skewed joins')).toEqual(['fix', 'skew', 'join']);
  });
});

import { ensureCitations } from './prompts';
describe('ensureCitations', () => {
  const hits = [
    { chunk: c(0, 'Delta Lake MERGE handles SCD Type 2 updates for dimension tables'), score: 1, vector: 0, keyword: 0 },
    { chunk: c(1, 'Kafka streams events into bronze tables every few seconds'), score: 1, vector: 0, keyword: 0 },
  ];
  it('adds the best-matching passage to uncited bullets', () => {
    expect(ensureCitations('- Kafka streams events into bronze tables', hits)).toBe('- Kafka streams events into bronze tables [2]');
  });
  it('leaves answers that already cite alone', () => {
    expect(ensureCitations('- Uses MERGE [1]', hits)).toBe('- Uses MERGE [1]');
  });
});
