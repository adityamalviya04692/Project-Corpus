import { embedDevice } from '../lib/embedder';
import type { PipelineStats } from '../lib/types';

const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);
const kb = (n: number) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/* The RAG pipeline made visible: what each stage did and what it cost. */
export default function Pipeline({ stats }: { stats: PipelineStats }) {
  const { parse, chunk, embed, index, retrieve, generate } = stats;
  const embedState =
    embed.status === 'loading' ? `loading model ${Math.round(embed.progress * 100)}%` : embed.status === 'embedding' ? `embedding ${Math.round(embed.progress * 100)}%` : embed.status === 'error' ? 'unavailable (keyword search only)' : embed.status === 'ready' ? ms(embed.ms) : 'waiting';
  const stages = [
    { n: '01', name: 'Parse', value: `${parse.files} files · ${parse.pages} pages`, sub: `${parse.chars.toLocaleString()} chars · ${ms(parse.ms)}` },
    { n: '02', name: 'Chunk', value: `${chunk.chunks} chunks`, sub: `~${chunk.avgChars} chars · ${chunk.size}/${chunk.overlap} size/overlap` },
    { n: '03', name: 'Embed', value: `${embed.model} · ${embed.dims}d${embedDevice() ? ` · ${embedDevice() === 'webgpu' ? 'GPU' : 'CPU'}` : ''}`, sub: embedState, live: embed.status === 'loading' || embed.status === 'embedding', progress: embed.progress },
    { n: '04', name: 'Index', value: `${index.vectors} vectors`, sub: `${kb(index.bytes)} · hybrid cosine + BM25` },
    { n: '05', name: 'Retrieve', value: retrieve ? `top ${retrieve.k} in ${ms(retrieve.ms)}` : '—', sub: retrieve ? `“${retrieve.query.slice(0, 36)}${retrieve.query.length > 36 ? '…' : ''}”` : 'ask a question' },
    { n: '06', name: 'Generate', value: generate ? generate.provider : '—', sub: generate ? `${generate.model ? `${generate.model.slice(0, 26)} · ` : ''}${ms(generate.ms)}` : '' },
  ];
  return (
    <section className="pipeline" aria-label="Pipeline metrics">
      <h3>Pipeline</h3>
      <ol>
        {stages.map((s) => (
          <li key={s.n} className={s.live ? 'live' : ''}>
            <span className="stage-n">{s.n}</span>
            <div>
              <strong>{s.name}</strong>
              <span>{s.value}</span>
              <small>{s.sub}</small>
              {s.live && <i className="bar" style={{ width: `${Math.round((s.progress ?? 0) * 100)}%` }} />}
            </div>
          </li>
        ))}
      </ol>
      {retrieve && retrieve.hits.length > 0 && (
        <div className="scores" aria-label="Retrieval scores">
          <span>Last retrieval · score = 0.7 vector + 0.3 keyword</span>
          {retrieve.hits.map((h, i) => (
            <div key={i} className="score-row" title={`vector ${h.vector.toFixed(3)} · keyword ${h.keyword.toFixed(2)}`}>
              <em>[{i + 1}]</em>
              <span className="score-label">{h.label}</span>
              <span className="score-bar"><i style={{ width: `${Math.max(4, h.score * 100)}%` }} /></span>
              <b>{h.score.toFixed(2)}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
