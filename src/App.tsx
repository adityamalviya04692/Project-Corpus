import { useEffect, useMemo, useRef, useState } from 'react';
import Library from './components/Library';
import Markdown from './components/Markdown';
import Pipeline from './components/Pipeline';
import SettingsDialog from './components/Settings';
import { chunkDoc } from './lib/chunk';
import { EMBED_DIMS, EMBED_MODEL, embed } from './lib/embedder';
import { extractive, rankSentences } from './lib/instant';
import { parseFile } from './lib/parse';
import { answerMessages, compareMessages, summaryMessages } from './lib/prompts';
import { DEMO_URL, PROVIDERS, browserModelLoaded, generate, modelFor, type Settings } from './lib/providers';
import { Index } from './lib/search';
import type { ChatMessage, Chunk, Doc, Hit, PipelineStats } from './lib/types';

/* Corpus: a browser-native RAG workspace. Documents are parsed, chunked, embedded and
   indexed locally; questions retrieve cited passages; answers come from the provider the
   visitor picks (no key needed for Instant or In-browser AI). */

type Msg = { id: number; role: 'user' | 'assistant'; text: string; hits?: Hit[]; status?: 'working' | 'streaming' | 'done' | 'error'; meta?: string };

const SAMPLES = ['lakehouse-design-v1.md', 'lakehouse-design-v2.md', 'incident-postmortem-2026-03.md'];
const SETTINGS_KEY = 'corpus-settings';
// With a hosted proxy configured, new visitors get real answers straight away.
const DEFAULT_SETTINGS: Settings = { provider: DEMO_URL ? 'demo' : 'instant', keys: {}, models: {}, baseUrl: '' };

const emptyStats = (size: number, overlap: number): PipelineStats => ({
  parse: { files: 0, pages: 0, chars: 0, ms: 0 },
  chunk: { chunks: 0, avgChars: 0, size, overlap, ms: 0 },
  embed: { model: EMBED_MODEL, dims: EMBED_DIMS, ms: 0, status: 'idle', progress: 0 },
  index: { vectors: 0, bytes: 0 },
});

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let msgId = 0;

export default function App() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [chunking, setChunking] = useState({ size: 900, overlap: 150 });
  const [stats, setStats] = useState<PipelineStats>(() => emptyStats(900, 150));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState<'ask' | 'compare'>('ask');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [compareResult, setCompareResult] = useState<Msg | null>(null);
  const [source, setSource] = useState<{ n: number; hit: Hit } | null>(null);
  const [question, setQuestion] = useState('');
  const [answering, setAnswering] = useState(false);
  const index = useRef(new Index());
  const vectors = useRef(new Map<string, Float32Array>());
  const abort = useRef<AbortController | null>(null);
  const run = useRef(0);
  const docMap = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const provider = PROVIDERS.find((p) => p.id === settings.provider) ?? PROVIDERS[0];
  const embedReady = stats.embed.status === 'ready';

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* private mode */
    }
  }, [settings]);

  /* Ingestion: chunk every document, embed any chunk we have no vector for, index. */
  async function rebuild(list: Doc[], c = chunking) {
    const me = ++run.current;
    const t0 = performance.now();
    const all = list.flatMap((d) => chunkDoc(d, c.size, c.overlap));
    const chunkMs = performance.now() - t0;
    const vecFor = () => all.map((ch) => vectors.current.get(ch.id));
    index.current.build(all, vecFor());
    setChunks(all);
    setStats((s) => ({
      ...s,
      parse: { files: list.length, pages: list.reduce((n, d) => n + d.pages.length, 0), chars: list.reduce((n, d) => n + d.chars, 0), ms: list.reduce((n, d) => n + d.parseMs, 0) },
      chunk: { chunks: all.length, avgChars: Math.round(all.reduce((n, ch) => n + ch.text.length, 0) / Math.max(1, all.length)), size: c.size, overlap: c.overlap, ms: chunkMs },
      index: { vectors: index.current.vectors.filter(Boolean).length, bytes: index.current.bytes },
    }));
    const missing = all.filter((ch) => !vectors.current.has(ch.id));
    if (!missing.length) {
      setStats((s) => ({ ...s, embed: { ...s.embed, status: all.length ? 'ready' : 'idle' } }));
      return;
    }
    const e0 = performance.now();
    setStats((s) => ({ ...s, embed: { ...s.embed, status: 'loading', progress: 0 } }));
    try {
      const out = await embed(
        missing.map((ch) => ch.text),
        (stage, f) => setStats((s) => ({ ...s, embed: { ...s.embed, status: stage === 'load' ? 'loading' : 'embedding', progress: f } })),
      );
      if (me !== run.current) return; // a newer rebuild superseded this one
      missing.forEach((ch, i) => vectors.current.set(ch.id, out[i]));
      index.current.build(all, vecFor());
      setStats((s) => ({
        ...s,
        embed: { ...s.embed, status: 'ready', progress: 1, ms: performance.now() - e0 },
        index: { vectors: all.length, bytes: index.current.bytes },
      }));
    } catch (err) {
      if (me !== run.current) return;
      setStats((s) => ({ ...s, embed: { ...s.embed, status: 'error', note: err instanceof Error ? err.message : String(err) } }));
    }
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setErrors([]);
    const parsed: Doc[] = [];
    const errs: string[] = [];
    for (const f of files) {
      try {
        parsed.push(await parseFile(f));
      } catch (e) {
        errs.push(e instanceof Error ? e.message : String(e));
      }
    }
    setErrors(errs);
    const next = [...docs, ...parsed];
    setDocs(next);
    setBusy(false);
    await rebuild(next);
  }

  async function addSamples() {
    const base = import.meta.env.BASE_URL;
    const files = await Promise.all(
      SAMPLES.map(async (name) => new File([await (await fetch(`${base}samples/${name}`)).text()], name, { type: 'text/markdown' })),
    );
    await addFiles(files);
  }

  function removeDoc(id: string) {
    const next = docs.filter((d) => d.id !== id);
    setDocs(next);
    void rebuild(next);
  }

  function changeChunking(c: { size: number; overlap: number }) {
    setChunking(c);
    vectors.current.clear(); // chunk ids are positional, so every chunk is new
    void rebuild(docs, c);
  }

  /* Retrieval shared by every mode. */
  async function retrieve(query: string, k: number, only?: Set<string>): Promise<Hit[]> {
    const t0 = performance.now();
    let qvec: Float32Array | null = null;
    if (embedReady) {
      try {
        qvec = (await embed([query]))[0];
      } catch {
        qvec = null;
      }
    }
    const hits = index.current.search(query, qvec, k, only);
    setStats((s) => ({
      ...s,
      retrieve: {
        query,
        ms: performance.now() - t0,
        k,
        hits: hits.map((h) => ({ label: `${docMap.get(h.chunk.docId)?.name ?? ''} · #${h.chunk.index + 1}`, score: h.score, vector: h.vector, keyword: h.keyword })),
      },
    }));
    return hits;
  }

  /* Runs one model call (or the extractive fallback) into a message slot. */
  async function respond(slot: Msg, set: (m: Msg) => void, prompt: ChatMessage[], fallback: () => Promise<string> | string) {
    if (settings.provider === 'instant' || !slot.hits?.length) {
      set({ ...slot, text: slot.hits?.length ? await fallback() : 'No matching passages in your documents.', status: 'done', meta: 'Instant · extractive' });
      return;
    }
    if (settings.provider === 'browser' && !browserModelLoaded(modelFor(settings, 'browser'))) {
      set({ ...slot, text: `${await fallback()}\n\n_The in-browser model isn't loaded yet. Open **Settings** to download it._`, status: 'done', meta: 'Instant · extractive' });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    const t0 = performance.now();
    const model = modelFor(settings, settings.provider);
    try {
      const text = await generate(settings, prompt, (t) => set({ ...slot, text: t, status: 'streaming' }), controller.signal);
      set({ ...slot, text: text || '_No answer returned._', status: 'done', meta: `${provider.label} · ${model}` });
      setStats((s) => ({ ...s, generate: { provider: provider.label, model, ms: performance.now() - t0, chars: text.length } }));
    } catch (e) {
      if (controller.signal.aborted) {
        set({ ...slot, status: 'done', meta: 'stopped' });
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      set({ ...slot, text: `**${provider.label} failed:** ${msg}\n\nHere is what your documents say:\n\n${await fallback()}`, status: 'error' });
    } finally {
      abort.current = null;
    }
  }

  const updateMsg = (m: Msg) => setMessages((list) => list.map((x) => (x.id === m.id ? m : x)));

  async function ask(q: string) {
    const query = q.trim();
    if (!query || answering || !chunks.length) return;
    setQuestion('');
    setAnswering(true);
    const history: ChatMessage[] = messages
      .filter((m) => m.status !== 'error' && m.text)
      .slice(-4)
      .map((m) => ({ role: m.role, content: m.text.replace(/\[\d+\]/g, '') }));
    const user: Msg = { id: ++msgId, role: 'user', text: query };
    const slot: Msg = { id: ++msgId, role: 'assistant', text: '', status: 'working' };
    setMessages((list) => [...list, user, slot]);
    const hits = await retrieve(query, 6);
    const ready = { ...slot, hits };
    updateMsg(ready);
    await respond(ready, updateMsg, answerMessages(query, hits, docMap, history), () => extractive(query, hits, embedReady ? embed : undefined));
    setAnswering(false);
  }

  async function insights(doc: Doc) {
    if (answering) return;
    setTab('ask');
    setAnswering(true);
    const hits: Hit[] = index.current.spread(doc.id, 8).map((chunk) => ({ chunk, score: 1, vector: 0, keyword: 0 }));
    const user: Msg = { id: ++msgId, role: 'user', text: `Key insights: ${doc.name}` };
    const slot: Msg = { id: ++msgId, role: 'assistant', text: '', status: 'working', hits };
    setMessages((list) => [...list, user, slot]);
    const fallback = () => hits.map((h, i) => `- ${h.chunk.text.split(/(?<=[.!?])\s+/)[0]} [${i + 1}]`).join('\n');
    await respond(slot, updateMsg, summaryMessages(doc, hits, docMap), fallback);
    setAnswering(false);
  }

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [aspect, setAspect] = useState('');
  useEffect(() => {
    // Default to comparing the first two documents.
    setPicked((p) => (p.size ? new Set([...p].filter((id) => docMap.has(id))) : new Set(docs.slice(0, 2).map((d) => d.id))));
  }, [docs, docMap]);

  async function compare() {
    const chosen = docs.filter((d) => picked.has(d.id));
    if (chosen.length < 2 || answering) return;
    setAnswering(true);
    const query = aspect.trim() || 'main points, decisions, numbers and what changed';
    const slot: Msg = { id: ++msgId, role: 'assistant', text: '', status: 'working' };
    setCompareResult(slot);
    const hits: Hit[] = [];
    for (const d of chosen) hits.push(...(await retrieve(query, 3, new Set([d.id]))));
    const ready = { ...slot, hits };
    setCompareResult(ready);
    const fallback = async () => {
      const head = `| Document | What it says about “${query}” |\n|---|---|\n`;
      const rows = await Promise.all(
        chosen.map(async (d) => {
          const offset = hits.findIndex((h) => h.chunk.docId === d.id);
          const own = hits.filter((h) => h.chunk.docId === d.id);
          const best = offset < 0 ? [] : await rankSentences(query, own, embedReady ? embed : undefined, 2, offset, 3);
          const cell = best.length ? best.map((b) => `${b.s.replace(/\|/g, '/')} [${b.n}]`).join('<br>') : 'not mentioned';
          return `| **${d.name}** | ${cell} |`;
        }),
      );
      return head + rows.join('\n');
    };
    await respond(ready, setCompareResult, compareMessages(query, hits, docMap, chosen), fallback);
    setAnswering(false);
  }

  const openSource = (m: Msg) => (n: number) => {
    const hit = m.hits?.[n - 1];
    if (hit) setSource({ n, hit });
  };

  const chunkCount = (id: string) => chunks.filter((c) => c.docId === id).length;
  const suggestions = docs.some((d) => d.name.startsWith('lakehouse-design'))
    ? ['What changed between the v1 and v2 lakehouse designs?', 'How was the skewed join incident fixed?', 'What is the data freshness SLA now?']
    : ['Summarise what these documents are about', 'What are the key risks or open issues?', 'List every number or deadline mentioned'];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <div>
            <h1>Corpus</h1>
            <p>Chat with your documents — cited answers, comparisons, a visible RAG pipeline.</p>
          </div>
        </div>
        <button className="provider-pill" onClick={() => setShowSettings(true)} aria-label="Change answer provider">
          <i className={`dot ${settings.provider}`} />
          {provider.label}
          {settings.provider === 'browser' && !browserModelLoaded(modelFor(settings, 'browser')) && <em>not loaded</em>}
          {provider.needsKey && !settings.keys[settings.provider] && <em>add key</em>}
          <span aria-hidden="true">⚙</span>
        </button>
      </header>

      <div className="layout">
        <aside>
          <Library
            docs={docs}
            chunkCount={chunkCount}
            busy={busy}
            errors={errors}
            onFiles={addFiles}
            onSamples={addSamples}
            onRemove={removeDoc}
            onSummarize={insights}
            chunking={chunking}
            onChunking={changeChunking}
          />
          <Pipeline stats={stats} />
        </aside>

        <main>
          <nav className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'ask'} onClick={() => setTab('ask')}>Ask</button>
            <button role="tab" aria-selected={tab === 'compare'} onClick={() => setTab('compare')} disabled={docs.length < 2} title={docs.length < 2 ? 'Add at least two documents' : ''}>
              Compare
            </button>
          </nav>

          {tab === 'ask' ? (
            <section className="chat" aria-label="Ask your documents">
              <div className="thread" aria-live="polite">
                {!messages.length && (
                  <div className="empty">
                    {docs.length ? (
                      <>
                        <h2>Ask anything across {docs.length === 1 ? 'your document' : `your ${docs.length} documents`}.</h2>
                        <div className="chips">
                          {suggestions.map((s) => (
                            <button key={s} onClick={() => ask(s)} disabled={answering || !chunks.length}>{s}</button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <h2>Drop in a few documents to start.</h2>
                        <p>Everything is parsed, chunked and embedded in your browser. Ask questions across all of them, compare them, or get insights per file. No sign-up, no key needed.</p>
                        <button className="btn" onClick={addSamples} disabled={busy}>Load sample documents</button>
                      </>
                    )}
                  </div>
                )}
                {messages.map((m) =>
                  m.role === 'user' ? (
                    <div key={m.id} className="msg user">{m.text}</div>
                  ) : (
                    <article key={m.id} className={`msg bot ${m.status}`}>
                      {m.status === 'working' && !m.text ? <span className="typing">Searching your documents…</span> : <Markdown text={m.text} onCite={openSource(m)} />}
                      {m.hits && m.hits.length > 0 && m.status !== 'working' && (
                        <div className="sources">
                          {m.hits.map((h, i) => (
                            <button key={h.chunk.id + i} onClick={() => setSource({ n: i + 1, hit: h })} title={h.chunk.text.slice(0, 200)}>
                              <b>{i + 1}</b> {docMap.get(h.chunk.docId)?.name}
                              {(docMap.get(h.chunk.docId)?.pages.length ?? 1) > 1 ? ` · p.${h.chunk.page}` : ''}
                            </button>
                          ))}
                        </div>
                      )}
                      {m.meta && <small className="meta">{m.meta}</small>}
                    </article>
                  ),
                )}
              </div>
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(question);
                }}
              >
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void ask(question);
                    }
                  }}
                  placeholder={chunks.length ? 'Ask a question about your documents…' : 'Add documents first'}
                  disabled={!chunks.length}
                  rows={2}
                  aria-label="Question"
                />
                {answering ? (
                  <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>Stop</button>
                ) : (
                  <button className="btn" disabled={!question.trim() || !chunks.length}>Ask</button>
                )}
              </form>
            </section>
          ) : (
            <section className="compare" aria-label="Compare documents">
              <p className="muted">Pick two or more documents and what to compare. Corpus retrieves the most relevant passages from each and lines them up.</p>
              <div className="picks">
                {docs.map((d) => (
                  <label key={d.id} className={picked.has(d.id) ? 'on' : ''}>
                    <input
                      type="checkbox"
                      checked={picked.has(d.id)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(d.id);
                        else next.delete(d.id);
                        setPicked(next);
                      }}
                    />
                    {d.name}
                  </label>
                ))}
              </div>
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void compare();
                }}
              >
                <input value={aspect} onChange={(e) => setAspect(e.target.value)} placeholder="Compare on… e.g. architecture, costs, SLAs (optional)" aria-label="Comparison focus" />
                <button className="btn" disabled={picked.size < 2 || answering}>Compare</button>
              </form>
              {compareResult && (
                <article className={`msg bot wide ${compareResult.status}`}>
                  {compareResult.status === 'working' && !compareResult.text ? <span className="typing">Reading each document…</span> : <Markdown text={compareResult.text} onCite={openSource(compareResult)} />}
                  {compareResult.meta && <small className="meta">{compareResult.meta}</small>}
                </article>
              )}
            </section>
          )}
        </main>
      </div>

      {source && (
        <div className="drawer-backdrop" onClick={() => setSource(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Source passage">
            <header>
              <span className="badge">[{source.n}]</span>
              <div>
                <strong>{docMap.get(source.hit.chunk.docId)?.name}</strong>
                <small>
                  chunk #{source.hit.chunk.index + 1}
                  {(docMap.get(source.hit.chunk.docId)?.pages.length ?? 1) > 1 ? ` · page ${source.hit.chunk.page}` : ''} · score {source.hit.score.toFixed(2)}
                </small>
              </div>
              <button className="icon-btn" onClick={() => setSource(null)} aria-label="Close source">✕</button>
            </header>
            <div className="passage">
              <Markdown text={source.hit.chunk.text} />
            </div>
          </aside>
        </div>
      )}

      <SettingsDialog open={showSettings} settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />

      <footer className="foot">
        Runs in your browser — documents never leave your device unless you choose an API provider.
        <a href="https://adityamalviya04692.github.io/Portfolio/" target="_blank" rel="noreferrer">Built by Aditya Malviya ↗</a>
      </footer>
    </div>
  );
}
