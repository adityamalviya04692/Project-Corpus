import { useEffect, useMemo, useRef, useState } from 'react';
import Library from './components/Library';
import Markdown from './components/Markdown';
import Pipeline from './components/Pipeline';
import EngineDialog from './components/Settings';
import { chunkDoc } from './lib/chunk';
import { EMBED_DIMS, EMBED_MODEL, embed } from './lib/embedder';
import { compressHits, extractive, extractiveOverview, rankSentences } from './lib/instant';
import { docKind, plan, type Intent } from './lib/intent';
import { citationOccurrences, citedNumbers, supportFor } from './lib/support';
import { parseFile } from './lib/parse';
import { evaluate, type EvalRow } from './lib/eval';
import { fileHash, kvGet, kvSet } from './lib/store';
import { answerMessages, compareMessages, ensureCitations, overviewMessages, summaryMessages } from './lib/prompts';
import { BROWSER_MODELS, DEMO_URL, PROVIDERS, browserModelLoaded, generate, loadBrowserModel, modelFor, type ProviderId, type Settings } from './lib/providers';
import { Index } from './lib/search';
import type { ChatMessage, Chunk, Doc, Hit, PipelineStats } from './lib/types';

/* Corpus: a browser-native RAG workspace. Documents are parsed, chunked, embedded and
   indexed locally; questions retrieve cited passages; answers come from the provider the
   visitor picks (no key needed for Instant or In-browser AI). */

type Msg = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  hits?: Hit[];
  status?: 'working' | 'streaming' | 'done' | 'error';
  meta?: string;
  /** Live progress while working: what the pipeline is doing and since when. */
  phase?: string;
  started?: number;
  /** True for Instant-mode answers, which quote documents rather than write. */
  quoted?: boolean;
  /** How the question was understood (shown as a small label). */
  intent?: Intent;
};

const INTENT_LABEL: Record<Intent, string> = { overview: 'Overview', compare: 'Comparison', list: 'List', lookup: 'Answer', data: 'Data' };

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

export default function App({ autoSamples = false }: { autoSamples?: boolean }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [chunking, setChunking] = useState({ size: 900, overlap: 150 });
  const [stats, setStats] = useState<PipelineStats>(() => emptyStats(900, 150));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [inspector, setInspector] = useState(() => window.innerWidth > 1180);
  const [engineLoad, setEngineLoad] = useState<{ p: number; text: string; error?: string } | null>(null);
  const [tab, setTab] = useState<'ask' | 'compare'>('ask');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [compareResult, setCompareResult] = useState<Msg | null>(null);
  const [source, setSource] = useState<{ n: number; hit: Hit; support?: string } | null>(null);
  const [question, setQuestion] = useState('');
  const [answering, setAnswering] = useState(false);
  const index = useRef(new Index());
  const vectors = useRef(new Map<string, Float32Array>());
  const abort = useRef<AbortController | null>(null);
  const run = useRef(0);
  const docMap = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const provider = PROVIDERS.find((p) => p.id === settings.provider) ?? PROVIDERS[0];
  const embedReady = stats.embed.status === 'ready';
  const browserLabel = BROWSER_MODELS.find((m) => m.id === modelFor(settings, 'browser'))?.label ?? 'Gemma';

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

  // Latest documents, for async flows that outlive a render (restore, uploads).
  const docsRef = useRef<Doc[]>([]);
  docsRef.current = docs;

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setErrors([]);
    const parsed: Doc[] = [];
    const errs: string[] = [];
    const seen = new Set(docsRef.current.map((d) => d.hash).filter(Boolean));
    for (const f of files) {
      try {
        if (f.size > 60 * 1024 * 1024) throw new Error(`${f.name}: larger than 60 MB`);
        const hash = await fileHash(f);
        if (seen.has(hash)) {
          errs.push(`${f.name}: already added (same content), skipped`);
          continue;
        }
        seen.add(hash);
        parsed.push({ ...(await parseFile(f)), hash });
      } catch (e) {
        errs.push(e instanceof Error ? e.message : String(e));
      }
    }
    setErrors(errs);
    const next = [...docsRef.current, ...parsed];
    docsRef.current = next;
    setDocs(next);
    setBusy(false);
    await rebuild(next);
  }

  // Restore the last workspace (documents + chunking) from IndexedDB; embeddings come
  // back from the vector cache, so nothing is recomputed. Then save on every change.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    void (async () => {
      const saved = await kvGet<{ docs: Doc[]; chunking: { size: number; overlap: number } }>('workspace');
      if (saved?.docs?.length) {
        setChunking(saved.chunking);
        docsRef.current = saved.docs;
        setDocs(saved.docs);
        await rebuild(saved.docs, saved.chunking);
      }
      setRestored(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (restored) void kvSet('workspace', { docs, chunking });
  }, [docs, chunking, restored]);

  function clearWorkspace() {
    docsRef.current = [];
    setDocs([]);
    setMessages([]);
    setCompareResult(null);
    setEvalRows(null);
    void rebuild([]);
  }

  /* Retrieval evaluation (sample documents only): keyword vs vector vs hybrid. */
  const [evalRows, setEvalRows] = useState<EvalRow[] | null>(null);
  const canEvaluate = embedReady && SAMPLES.every((n) => docs.some((d) => d.name === n));
  async function runEvaluation() {
    setEvalRows(await evaluate(index.current, (id) => docMap.get(id)?.name ?? '', embed));
  }

  // Start downloading the embedding model the moment the workspace opens, so it is
  // ready (or nearly) by the time the first file has been parsed.
  useEffect(() => {
    embed(['warm up']).catch(() => {});
  }, []);

  // "Try with samples" from the landing page loads them straight away.
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (autoSamples && restored && !autoLoaded.current) {
      autoLoaded.current = true;
      if (!SAMPLES.every((n) => docsRef.current.some((d) => d.name === n))) void addSamples();
    }
  }, [autoSamples, restored]); // eslint-disable-line react-hooks/exhaustive-deps

  /* One-time download of the in-browser model, with progress shown in the app bar. */
  async function loadBrowser(id = modelFor(settings, 'browser')) {
    setSettings((s) => ({ ...s, provider: 'browser', models: { ...s.models, browser: id } }));
    setEngineLoad({ p: 0, text: 'Starting…' });
    try {
      await loadBrowserModel(id, (p, text) => setEngineLoad({ p, text }));
      setEngineLoad(null);
    } catch (e) {
      setEngineLoad({ p: 0, text: '', error: e instanceof Error ? e.message : String(e) });
    }
  }

  const openEngine = (provider?: ProviderId) => {
    if (provider) setSettings((s) => ({ ...s, provider }));
    setShowSettings(true);
  };

  async function addSamples() {
    const base = import.meta.env.BASE_URL;
    const files = await Promise.all(
      SAMPLES.map(async (name) => new File([await (await fetch(`${base}samples/${name}`)).text()], name, { type: 'text/markdown' })),
    );
    await addFiles(files);
  }

  function removeDoc(id: string) {
    const next = docsRef.current.filter((d) => d.id !== id);
    docsRef.current = next;
    setDocs(next);
    void rebuild(next);
  }

  function changeChunking(c: { size: number; overlap: number }) {
    setChunking(c);
    vectors.current.clear(); // chunk ids are positional, so every chunk is new
    void rebuild(docs, c);
  }

  /* Retrieval shared by every mode. */
  async function retrieve(query: string, k: number, only?: Set<string>, strategy = 'hybrid + MMR'): Promise<Hit[]> {
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
        strategy,
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
      set({ ...slot, text: slot.hits?.length ? await fallback() : 'No matching passages in your documents.', status: 'done', quoted: true, meta: `Instant · ${secs(slot)}` });
      return;
    }
    if (settings.provider === 'browser' && !browserModelLoaded(modelFor(settings, 'browser'))) {
      set({ ...slot, text: `${await fallback()}\n\n_${engineLoad && !engineLoad.error ? `Gemma is still downloading (${Math.round(engineLoad.p * 100)}%). These are quotes until it's ready.` : 'The in-browser model is not loaded yet — open the model menu to download it.'}_`, status: 'done', quoted: true, meta: `Instant · ${secs(slot)}` });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    const passages = prompt.at(-1)?.content.match(/^\[\d+\]/gm)?.length ?? slot.hits.length;
    set({ ...slot, phase: `Reading ${passages} passages with ${settings.provider === 'browser' ? browserLabel : provider.label}` });
    const t0 = performance.now();
    const model = modelFor(settings, settings.provider);
    try {
      const text = ensureCitations(await generate(settings, prompt, (t) => set({ ...slot, text: t, status: 'streaming' }), controller.signal), slot.hits ?? []);
      set({ ...slot, text: text || '_No answer returned._', status: 'done', meta: `${settings.provider === 'browser' ? browserLabel : provider.label} · ${secs(slot)}` });
      setStats((s) => ({ ...s, generate: { provider: settings.provider === 'browser' ? browserLabel : provider.label, model, ms: performance.now() - t0, chars: text.length } }));
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

  const secs = (m: Msg) => (m.started ? `${((performance.now() - m.started) / 1000).toFixed(1)} s` : '');

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
    const slot: Msg = { id: ++msgId, role: 'assistant', text: '', status: 'working', started: performance.now(), phase: 'Finding relevant passages' };
    setMessages((list) => [...list, user, slot]);
    const compact = settings.provider === 'browser';
    const route = plan(query, docs);
    const scoped = route.docIds.length ? new Set(route.docIds) : undefined;
    const fallbackEmbed = embedReady ? embed : undefined;

    if (route.intent === 'overview') {
      // An even sample across each target document, then a narrative answer.
      const targets = (route.docIds.length ? docs.filter((d) => scoped!.has(d.id)) : docs).slice(0, 4);
      const per = targets.length === 1 ? (compact ? 6 : 8) : compact ? 3 : 4;
      const chosen = targets.map((d) => {
        const title = d.pages[0]?.text.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').slice(0, 90) ?? '';
        return { doc: d, title, kind: docKind(title, d.kind), chunks: index.current.spread(d.id, per) };
      });
      const hits: Hit[] = chosen.flatMap((c) => c.chunks.map((chunk) => ({ chunk, score: 1, vector: 0, keyword: 0 })));
      setStats((st) => ({ ...st, retrieve: { query, strategy: `even sample · ${targets.length} doc${targets.length > 1 ? 's' : ''}`, ms: 0, k: hits.length, hits: hits.map((h) => ({ label: `${docMap.get(h.chunk.docId)?.name ?? ''} · #${h.chunk.index + 1}`, score: 1, vector: 0, keyword: 0 })) } }));
      const ready = { ...slot, hits, intent: route.intent };
      updateMsg(ready);
      let n = 0;
      const fallback = () =>
        extractiveOverview(
          chosen.map((c) => ({ name: c.doc.name, kind: c.kind, title: c.title, hits: c.chunks.map((chunk) => ({ hit: { chunk, score: 1, vector: 0, keyword: 0 }, n: ++n })) })),
          fallbackEmbed,
        );
      const context = compact ? await compressHits(query + ' main purpose, decisions, numbers, conclusions', hits, fallbackEmbed, 2) : hits;
      await respond(ready, updateMsg, overviewMessages(chosen.map((c) => ({ doc: c.doc, kind: c.kind })), context, docMap, query, compact), fallback);
    } else if (route.intent === 'compare') {
      // Evidence from each side, so neither document crowds out the other.
      const sides = (route.docIds.length >= 2 ? docs.filter((d) => scoped!.has(d.id)) : docs).slice(0, 3);
      const hits: Hit[] = [];
      for (const d of sides) hits.push(...(await retrieve(query, compact ? 2 : 3, new Set([d.id]), `per-document · ${sides.length} docs`)));
      const ready = { ...slot, hits, intent: route.intent };
      updateMsg(ready);
      const context = compact ? await compressHits(query, hits, fallbackEmbed, 3) : hits;
      await respond(ready, updateMsg, compareMessages(query, context, docMap, sides), () => extractive(query, hits, fallbackEmbed));
    } else {
      const k = route.intent === 'list' ? 8 : 6;
      const hits = await retrieve(query, k, scoped, scoped ? `scoped to ${route.docIds.length} doc${route.docIds.length > 1 ? 's' : ''} · MMR` : 'hybrid + MMR');
      const ready = { ...slot, hits, intent: route.intent };
      updateMsg(ready);
      // On-device models get a compressed context: the best few sentences of each passage.
      const context = compact ? await compressHits(query, hits.slice(0, 5), fallbackEmbed) : hits;
      await respond(ready, updateMsg, answerMessages(query, context, docMap, history, compact), () => extractive(query, hits, fallbackEmbed));
    }
    setAnswering(false);
  }

  async function insights(doc: Doc) {
    if (answering) return;
    setTab('ask');
    setAnswering(true);
    const hits: Hit[] = index.current.spread(doc.id, 8).map((chunk) => ({ chunk, score: 1, vector: 0, keyword: 0 }));
    const user: Msg = { id: ++msgId, role: 'user', text: `Key insights: ${doc.name}` };
    const slot: Msg = { id: ++msgId, role: 'assistant', text: '', status: 'working', hits, started: performance.now(), phase: 'Sampling the document' };
    setMessages((list) => [...list, user, slot]);
    const fallback = () => hits.map((h, i) => `- ${h.chunk.text.split(/(?<=[.!?])\s+/)[0]} [${i + 1}]`).join('\n');
    const compact = settings.provider === 'browser';
    const context = compact ? await compressHits('key facts, numbers, decisions and risks', hits, embedReady ? embed : undefined, 2) : hits;
    await respond(slot, updateMsg, summaryMessages(doc, context, docMap), fallback);
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
    const slot: Msg = { id: ++msgId, role: 'assistant', text: '', status: 'working', started: performance.now(), phase: 'Finding passages in each document' };
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
    const context = settings.provider === 'browser' ? await compressHits(query, hits, embedReady ? embed : undefined, 3) : hits;
    await respond(ready, setCompareResult, compareMessages(query, context, docMap, chosen), fallback);
    setAnswering(false);
  }

  /** Opens a source; with an occurrence index, the claim on that line picks the highlight. */
  const openSource = (m: Msg) => (n: number, occurrence = -1) => {
    const hit = m.hits?.[n - 1];
    if (!hit) return;
    const occ = citationOccurrences(m.text)[occurrence];
    setSource({ n, hit, support: supportFor(occ && occ.n === n ? occ.line : m.text, n, hit) });
  };

  /** Hover text per citation: the sentence backing that exact line, and where it is from. */
  const tipsFor = (m: Msg) => {
    if (m.status !== 'done' && m.status !== 'error') return undefined;
    return citationOccurrences(m.text).map(({ n, line }) => {
      const hit = m.hits?.[n - 1];
      return hit ? `“${supportFor(line, n, hit).slice(0, 180)}” — ${sourceLabel(hit)}` : '';
    });
  };

  const chunkCount = (id: string) => chunks.filter((c) => c.docId === id).length;
  const browserReady = browserModelLoaded(modelFor(settings, 'browser'));
  const engineName = settings.provider === 'browser' ? browserLabel : provider.label;
  const engineState =
    engineLoad && !engineLoad.error
      ? `${Math.round(engineLoad.p * 100)}%`
      : settings.provider === 'browser' && !browserReady
        ? 'not loaded'
        : provider.needsKey && !settings.keys[settings.provider]
          ? 'add key'
          : '';
  const quotesOnly = settings.provider === 'instant' || (settings.provider === 'browser' && !browserReady);
  const suggestions = docs.some((d) => d.name.startsWith('lakehouse-design'))
    ? ['What changed between the v1 and v2 lakehouse designs?', 'How was the skewed join incident fixed?', 'What is the data freshness SLA now?']
    : ['Summarise what these documents are about', 'What are the key risks or open issues?', 'List every number or deadline mentioned'];


  const sourceLabel = (h: Hit) => {
    const d = docMap.get(h.chunk.docId);
    return `${d?.name ?? ''}${(d?.pages.length ?? 1) > 1 ? ` · p.${h.chunk.page}` : ''}`;
  };

  const engineBanner = quotesOnly && (
    <div className="engine-banner">
      <div>
        <strong>{engineLoad && !engineLoad.error ? `Downloading ${browserLabel}… ${Math.round(engineLoad.p * 100)}%` : 'Answers are quotes right now.'}</strong>
        <span>
          {engineLoad && !engineLoad.error
            ? 'You can keep asking — answers switch to Gemma as soon as it is ready.'
            : 'For written, cited answers run Gemma 4 free in your browser, or use a free Google AI Studio key.'}
        </span>
        {engineLoad && !engineLoad.error && <i className="banner-bar" style={{ width: `${engineLoad.p * 100}%` }} />}
      </div>
      {!(engineLoad && !engineLoad.error) && (
        <div className="banner-actions">
          <button className="btn small" onClick={() => void loadBrowser(BROWSER_MODELS[0].id)}>Run Gemma 4 · 2.8 GB</button>
          <button className="btn small ghost" onClick={() => openEngine('gemini')}>Use a free key</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="shell">
      <header className="appbar">
        <a className="brand-sm" href="#/" aria-label="Corpus home">
          <span className="logo" aria-hidden="true" />
          Corpus
        </a>
        <span className="appbar-stat">
          {docs.length ? `${docs.length} ${docs.length === 1 ? 'document' : 'documents'} · ${chunks.length} chunks` : 'No documents yet'}
        </span>
        <div className="appbar-right">
          <button className="engine-chip" onClick={() => openEngine()} aria-label={`Model: ${engineName}. Change model`}>
            <i className={`dot ${settings.provider}${engineLoad && !engineLoad.error ? ' loading' : ''}`} />
            <span>{engineName}</span>
            {engineState && <em>{engineState}</em>}
            <span className="caret" aria-hidden="true">▾</span>
          </button>
          <button className={`icon-toggle${inspector ? ' on' : ''}`} onClick={() => setInspector((v) => !v)} aria-pressed={inspector} title="Pipeline inspector">
            <span aria-hidden="true">⫶</span> Pipeline
          </button>
        </div>
      </header>

      <div className={`workspace${inspector ? ' with-inspector' : ''}`}>
        <aside className="sidebar">
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
            onClear={clearWorkspace}
          />
        </aside>

        <main className="stage">
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={tab === 'ask'} onClick={() => setTab('ask')}>Ask</button>
            <button role="tab" aria-selected={tab === 'compare'} onClick={() => setTab('compare')} disabled={docs.length < 2} title={docs.length < 2 ? 'Add at least two documents' : ''}>Compare</button>
          </div>

          {tab === 'ask' ? (
            <section className="chat" aria-label="Ask your documents">
              <div className="thread" aria-live="polite">
                {!messages.length &&
                  (docs.length ? (
                    <div className="welcome">
                      <h2>What would you like to know?</h2>
                      <p>Ask across {docs.length === 1 ? 'your document' : `all ${docs.length} documents`}. Every answer cites its sources.</p>
                      <div className="chips">
                        {suggestions.map((s) => (
                          <button key={s} onClick={() => ask(s)} disabled={answering || !chunks.length}>{s}</button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <EmptyDrop busy={busy} onFiles={addFiles} onSamples={addSamples} />
                  ))}
                {messages.map((m) =>
                  m.role === 'user' ? (
                    <div key={m.id} className="msg user">{m.text}</div>
                  ) : (
                    <article key={m.id} className={`msg bot ${m.status}`}>
                      <span className="bot-mark" aria-hidden="true" />
                      <div className="bot-body">
                        {(m.quoted || m.intent) && (
                          <div className="msg-tags">
                            {m.intent && <span className="intent-tag">{INTENT_LABEL[m.intent]}</span>}
                            {m.quoted && <span className="quote-label">Quoted from your documents</span>}
                          </div>
                        )}
                        {m.status === 'working' && !m.text ? <Working phase={m.phase} started={m.started} /> : <Markdown text={m.text} onCite={openSource(m)} tips={tipsFor(m)} />}
                        {m.status !== 'working' && <Sources m={m} onOpen={openSource(m)} label={sourceLabel} docOf={(h) => docMap.get(h.chunk.docId)?.name ?? ''} />}
                        {m.meta && <small className="meta">{m.meta}</small>}
                      </div>
                    </article>
                  ),
                )}
              </div>
              {docs.length > 0 && engineBanner}
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
                  placeholder={chunks.length ? 'Ask a question about your documents…' : 'Add documents to start asking'}
                  disabled={!chunks.length}
                  rows={1}
                  aria-label="Question"
                />
                {answering ? (
                  <button type="button" className="send stop" onClick={() => abort.current?.abort()} aria-label="Stop">■</button>
                ) : (
                  <button className="send" disabled={!question.trim() || !chunks.length} aria-label="Ask">↑</button>
                )}
              </form>
            </section>
          ) : (
            <section className="compare" aria-label="Compare documents">
              <div className="compare-head">
                <h2>Compare documents</h2>
                <p>Choose two or more and what to compare. Corpus retrieves the strongest passages from each and lines them up.</p>
              </div>
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
                className="composer inline"
                onSubmit={(e) => {
                  e.preventDefault();
                  void compare();
                }}
              >
                <input value={aspect} onChange={(e) => setAspect(e.target.value)} placeholder="Compare on… architecture, costs, SLAs (optional)" aria-label="Comparison focus" />
                <button className="btn" disabled={picked.size < 2 || answering}>Compare</button>
              </form>
              {engineBanner}
              {compareResult && (
                <article className={`msg bot wide ${compareResult.status}`}>
                  <span className="bot-mark" aria-hidden="true" />
                  <div className="bot-body">
                    {compareResult.quoted && <span className="quote-label">Quoted from your documents</span>}
                    {compareResult.status === 'working' && !compareResult.text ? <Working phase={compareResult.phase} started={compareResult.started} /> : <Markdown text={compareResult.text} onCite={openSource(compareResult)} tips={tipsFor(compareResult)} />}
                    {compareResult.meta && <small className="meta">{compareResult.meta}</small>}
                  </div>
                </article>
              )}
            </section>
          )}
        </main>

        {inspector && (
          <aside className="inspector">
            <Pipeline stats={stats} evalRows={evalRows} canEvaluate={canEvaluate} onEvaluate={runEvaluation} />
          </aside>
        )}
      </div>

      {source && (
        <div className="drawer-backdrop" onClick={() => setSource(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Source passage">
            <header>
              <span className="cite big">{source.n}</span>
              <div>
                <strong>{docMap.get(source.hit.chunk.docId)?.name}</strong>
                <small>
                  chunk #{source.hit.chunk.index + 1}
                  {(docMap.get(source.hit.chunk.docId)?.pages.length ?? 1) > 1 ? ` · page ${source.hit.chunk.page}` : ''} · relevance {source.hit.score.toFixed(2)}
                </small>
              </div>
              <button className="icon-btn" onClick={() => setSource(null)} aria-label="Close source">✕</button>
            </header>
            <div className="passage">
              <Markdown text={source.hit.chunk.text} highlight={source.support} />
            </div>
          </aside>
        </div>
      )}

      <EngineDialog
        open={showSettings}
        settings={settings}
        onChange={setSettings}
        onClose={() => setShowSettings(false)}
        load={engineLoad}
        onLoadBrowser={loadBrowser}
      />
    </div>
  );
}

/* Live progress for a pending answer: the current pipeline step and elapsed time. */
function Working({ phase, started }: { phase?: string; started?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  const s = started ? (performance.now() - started) / 1000 : 0;
  return (
    <span className="working">
      <i className="spinner" aria-hidden="true" />
      {phase ?? 'Working'}
      <b>{s.toFixed(1)} s</b>
    </span>
  );
}

/* Compact source line: only the documents actually cited, grouped, with their numbers. */
function Sources({ m, onOpen, label, docOf }: { m: Msg; onOpen: (n: number) => void; label: (h: Hit) => string; docOf: (h: Hit) => string }) {
  if (!m.hits?.length) return null;
  const cited = citedNumbers(m.text).filter((n) => m.hits![n - 1]);
  const nums = cited.length ? cited : m.hits.slice(0, 3).map((_, i) => i + 1);
  const groups = new Map<string, number[]>();
  for (const n of nums) {
    const d = docOf(m.hits[n - 1]);
    groups.set(d, [...(groups.get(d) ?? []), n]);
  }
  return (
    <div className="sources-line">
      <span className="sources-k">Sources</span>
      {[...groups].map(([doc, ns]) => (
        <span key={doc} className="src-doc" title={label(m.hits![ns[0] - 1])}>
          <span className="src-doc-name">{doc}</span>
          {ns.map((n) => (
            <button key={n} className="cite" onClick={() => onOpen(n)} aria-label={`Open source ${n}`}>{n}</button>
          ))}
        </span>
      ))}
    </div>
  );
}

/* First-run state: one big, friendly drop target. */
function EmptyDrop({ busy, onFiles, onSamples }: { busy: boolean; onFiles: (f: File[]) => void; onSamples: () => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`empty-drop${over ? ' over' : ''}`}
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
      <span className="drop-icon" aria-hidden="true">⇪</span>
      <h2>Drop your documents here</h2>
      <p>PDF, Word, Markdown, CSV, HTML or text. Everything is processed on your device.</p>
      <div className="hero-cta">
        <label className="btn">
          Choose files
          <input type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.html,.htm,.json,.log" onChange={(e) => onFiles([...(e.target.files ?? [])])} />
        </label>
        <button className="btn ghost" onClick={onSamples} disabled={busy}>Try 3 sample documents</button>
      </div>
    </div>
  );
}
