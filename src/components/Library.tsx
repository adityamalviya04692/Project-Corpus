import { useRef, useState } from 'react';
import { ACCEPT } from '../lib/parse';
import type { Doc } from '../lib/types';

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export default function Library({
  docs, chunkCount, busy, errors, onFiles, onSamples, onRemove, onSummarize, chunking, onChunking, onClear,
}: {
  docs: Doc[];
  chunkCount: (id: string) => number;
  busy: boolean;
  errors: string[];
  onFiles: (files: File[]) => void;
  onSamples: () => void;
  onRemove: (id: string) => void;
  onSummarize: (doc: Doc) => void;
  chunking: { size: number; overlap: number };
  onChunking: (c: { size: number; overlap: number }) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <section className="library" aria-label="Documents">
      <h3>Documents</h3>
      <div
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onFiles([...e.dataTransfer.files]);
        }}
      >
        <button className="btn" onClick={() => input.current?.click()} disabled={busy}>Add files</button>
        <span>or drop PDF, DOCX, TXT, MD, CSV, HTML</span>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => onFiles([...(e.target.files ?? [])])} />
      </div>
      {!docs.length && (
        <button className="link sample" onClick={onSamples} disabled={busy}>Try with 3 sample documents →</button>
      )}
      {errors.map((e) => (
        <p key={e} className="warn">{e}</p>
      ))}
      <ul className="docs">
        {docs.map((d) => (
          <li key={d.id}>
            <span className={`kind kind-${d.kind}`}>{d.kind === 'markdown' ? 'md' : d.kind}</span>
            <div>
              <strong title={d.name}>{d.name}</strong>
              <small>{size(d.bytes)} · {d.pages.length} {d.pages.length === 1 ? 'page' : 'pages'} · {chunkCount(d.id)} chunks</small>
            </div>
            <span className="doc-actions">
              <button className="icon-btn" onClick={() => onSummarize(d)} disabled={busy} title="Key insights" aria-label={`Key insights for ${d.name}`}>✦</button>
              <button className="icon-btn" onClick={() => onRemove(d.id)} disabled={busy} title="Remove" aria-label={`Remove ${d.name}`}>✕</button>
            </span>
          </li>
        ))}
      </ul>
      {docs.length > 0 && (
        <details className="chunking">
          <summary>Chunking · {chunking.size} / {chunking.overlap}</summary>
          <label>
            Chunk size <b>{chunking.size}</b>
            <input type="range" min={300} max={2000} step={50} value={chunking.size} disabled={busy} onChange={(e) => onChunking({ ...chunking, size: Number(e.target.value) })} />
          </label>
          <label>
            Overlap <b>{chunking.overlap}</b>
            <input type="range" min={0} max={400} step={25} value={chunking.overlap} disabled={busy} onChange={(e) => onChunking({ ...chunking, overlap: Number(e.target.value) })} />
          </label>
          <small className="muted">Changing these re-chunks and re-embeds every document; watch the pipeline update.</small>
        </details>
      )}
      {docs.length > 0 && (
        <p className="saved-note">
          Saved in this browser · <button className="link" onClick={onClear} disabled={busy}>Clear workspace</button>
        </p>
      )}
    </section>
  );
}
