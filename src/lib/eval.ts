import { Index } from './search';

/* Retrieval evaluation on the sample documents: a small golden set of questions, each
   with the document and phrase that answer it. Every retriever configuration is scored
   with hit@1, hit@3 and MRR — the same way you would test a production search system
   before shipping a change. */

export const GOLDEN = [
  { q: 'What is the data freshness SLA for gold tables?', doc: 'lakehouse-design-v2.md', expect: '15 minutes' },
  { q: 'How long did the nightly pipeline take end to end in the original design?', doc: 'lakehouse-design-v1.md', expect: '3 hours and 10 minutes' },
  { q: 'Why did executors run out of memory?', doc: 'incident-postmortem-2026-03.md', expect: 'hot' },
  { q: 'How much does the platform cost per month after the redesign?', doc: 'lakehouse-design-v2.md', expect: '12,600' },
  { q: 'Which tool manages permissions and column lineage?', doc: 'lakehouse-design-v2.md', expect: 'Unity Catalog' },
  { q: 'How many buckets were the hottest keys spread across?', doc: 'incident-postmortem-2026-03.md', expect: '16 buckets' },
  { q: 'Where were SFTP secrets kept before?', doc: 'lakehouse-design-v1.md', expect: 'linked-service' },
  { q: 'Which legacy reports still need migrating, and by when?', doc: 'lakehouse-design-v2.md', expect: 'Q3 2026' },
];

export interface EvalRow {
  name: string;
  hit1: number;
  hit3: number;
  mrr: number;
}

type Embed = (texts: string[]) => Promise<Float32Array[]>;

export async function evaluate(index: Index, docName: (id: string) => string, embedFn: Embed): Promise<EvalRow[]> {
  const qvecs = await embedFn(GOLDEN.map((g) => g.q));
  const configs: { name: string; run: (q: string, v: Float32Array) => ReturnType<Index['search']> }[] = [
    { name: 'Keyword (BM25)', run: (q) => index.search(q, null, 5) },
    { name: 'Vector (cosine)', run: (q, v) => index.search(q, v, 5, undefined, 1) },
    { name: 'Hybrid + MMR', run: (q, v) => index.search(q, v, 5) },
  ];
  return configs.map(({ name, run }) => {
    let hit1 = 0, hit3 = 0, mrr = 0;
    GOLDEN.forEach((g, i) => {
      const hits = run(g.q, qvecs[i]);
      const rank = hits.findIndex((h) => docName(h.chunk.docId) === g.doc && h.chunk.text.includes(g.expect));
      if (rank === 0) hit1++;
      if (rank >= 0 && rank < 3) hit3++;
      if (rank >= 0) mrr += 1 / (rank + 1);
    });
    const n = GOLDEN.length;
    return { name, hit1: hit1 / n, hit3: hit3 / n, mrr: mrr / n };
  });
}
