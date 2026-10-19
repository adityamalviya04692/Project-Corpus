import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import Logo from './components/Logo';
import { BROWSER_MODELS } from './lib/providers';

const GITHUB = 'https://github.com/adityamalviya04692/Project-Corpus';

const FEATURES = [
  { icon: '◎', title: 'Cited answers', text: 'One question across every file. Each claim carries a citation; hover it to see the exact sentence, click to open the passage.' },
  { icon: '⇄', title: 'Compare documents', text: 'Pick two or more and a focus. Evidence is retrieved per document, so neither side crowds the other out.' },
  { icon: '⌗', title: 'Ask your data', text: 'CSV, Parquet and JSON load into DuckDB in the browser. Ask in plain English, read the generated SQL, edit and re-run it.' },
  { icon: '▤', title: 'Profiling & quality', text: 'Every table is profiled on load: types, nulls, cardinality, IQR outliers, duplicate rows and unique-key candidates.' },
  { icon: '⧉', title: 'Data contracts', text: 'The profile becomes a dbt schema.yml with not_null, unique and accepted_values tests you can drop into a pipeline.' },
  { icon: '◔', title: 'Measured retrieval', text: 'A golden-question set scores keyword, vector and hybrid retrieval (hit@1, hit@3, MRR) live in the pipeline panel.' },
];

const STEPS = [
  { n: '01', name: 'Ingest', tech: 'pdf.js · DuckDB', text: 'Documents become clean text page by page; tables become DuckDB tables with a profile.' },
  { n: '02', name: 'Chunk', tech: 'recursive · overlap', text: 'Paragraph- and sentence-aware chunks that never cross pages, so citations stay exact.' },
  { n: '03', name: 'Embed', tech: 'MiniLM · WebGPU', text: '384-dimension vectors on your GPU, cached in IndexedDB so a refresh costs nothing.' },
  { n: '04', name: 'Retrieve', tech: 'BM25 + cosine + MMR', text: 'Hybrid scoring for meaning and exact terms, then diversity so passages don’t repeat.' },
  { n: '05', name: 'Route', tech: 'intent planner', text: 'Overview, comparison, lookup or a data question: each gets its own retrieval strategy.' },
  { n: '06', name: 'Generate', tech: 'Gemma 4 · SQL', text: 'A grounded, cited answer, or SQL that runs in DuckDB and is explained in plain words.' },
];

const METRICS = [
  { k: '100%', v: 'hit@1, hybrid retrieval', s: 'on the golden question set' },
  { k: '1.00', v: 'mean reciprocal rank', s: 'vector-only scores 0.82' },
  { k: '<50 ms', v: 'typical DuckDB query', s: 'in a Web Worker, on your machine' },
  { k: '0', v: 'servers holding your files', s: 'IndexedDB keeps your workspace' },
];

/* Scroll reveal: sections rise in once as they enter the viewport. */
function Reveal({ children, delay = 0, className, as = 'div' }: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'section' | 'article' | 'li' }) {
  const M = motion[as];
  return (
    <M className={className} initial={{ opacity: 0, y: 26 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ type: 'spring', stiffness: 260, damping: 30, delay }}>
      {children}
    </M>
  );
}

export default function Landing() {
  return (
    <div className="landing">
      <nav className="lnav">
        <a className="brand-sm" href="#/">
          <Logo />
          Corpus
        </a>
        <div className="lnav-links">
          <a href="#how">How it works</a>
          <a href="#engines">Models</a>
          <a href="#privacy">Privacy</a>
          <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
        </div>
        <a className="btn" href="#/app">Open app</a>
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <motion.span className="eyebrow" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}><i /> RAG + DuckDB analytics · Gemma 4 on your device</motion.span>
          <motion.h1 initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 26, delay: 0.12 }}>
            Ask your documents.<br /> <em>Query</em> your data.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            Drop in reports, specs and CSV or Parquet files. Corpus answers across all of them with citations, compares documents side by side, and turns questions about your tables into SQL — all inside your browser.
          </motion.p>
          <div className="hero-cta">
            <a className="btn big" href="#/app?samples">Try it with samples</a>
            <a className="btn big ghost" href="#/app">Use my own files</a>
          </div>
          <ul className="hero-points">
            <li>No sign-up</li>
            <li>No API key needed</li>
            <li>Open source</li>
          </ul>
        </div>
        <motion.div initial={{ opacity: 0, y: 30, rotate: 0 }} animate={{ opacity: 1, y: 0, rotate: 1 }} transition={{ type: 'spring', stiffness: 120, damping: 20, delay: 0.2 }}>
          <DemoWindow />
        </motion.div>
      </header>

      <section className="built-with" aria-label="Built with">
        <span>Built with</span>
        <b>Gemma 4</b>
        <b>WebGPU</b>
        <b>WebLLM</b>
        <b>Transformers.js</b>
        <b>DuckDB-WASM</b>
        <b>ECharts</b>
        <b>React</b>
      </section>

      <section className="features">
        {FEATURES.map((f, i) => (
          <Reveal as="article" key={f.title} delay={(i % 3) * 0.07}>
            <span className="f-icon" aria-hidden="true">{f.icon}</span>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </Reveal>
        ))}
      </section>

      <section className="metrics" aria-label="Measured, not claimed">
        <Reveal className="section-head">
          <span className="kicker">Measured, not claimed</span>
          <h2>Built like a data platform.</h2>
          <p>Retrieval is evaluated against golden questions, every stage reports its timings, and tables get the checks a pipeline would run.</p>
        </Reveal>
        <div className="metric-grid">
          {METRICS.map((m, i) => (
            <Reveal key={m.v} delay={i * 0.06} className="metric">
              <b>{m.k}</b>
              <span>{m.v}</span>
              <small>{m.s}</small>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="how" id="how">
        <Reveal className="section-head">
          <span className="kicker">Under the hood</span>
          <h2>A real pipeline, not a black box.</h2>
          <p>Every stage runs in your browser and reports what it did, in the pipeline panel next to the chat.</p>
        </Reveal>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.n} delay={i * 0.05}>
              <span className="step-n">{s.n}</span>
              <h3>{s.name}</h3>
              <code>{s.tech}</code>
              <p>{s.text}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      <section className="engines" id="engines">
        <div className="section-head">
          <span className="kicker">Pick your model</span>
          <h2>Free answers, three ways.</h2>
        </div>
        <div className="engine-cards">
          <article className="engine featured">
            <span className="tag">Recommended</span>
            <h3>Gemma 4 in your browser</h3>
            <p>Google’s open Gemma 4 E2B runs on your GPU through WebGPU. Free, private and offline once downloaded.</p>
            <ul>
              {BROWSER_MODELS.map((m) => (
                <li key={m.id}><b>{m.label}</b> <span>{m.size}</span></li>
              ))}
            </ul>
            <small>Chrome or Edge on desktop. Downloaded once, then cached.</small>
          </article>
          <article className="engine">
            <h3>Gemma 4 via Google AI Studio</h3>
            <p>Gemma 4 26B runs on Google’s free tier with your own AI Studio key. Fast, strong, works on any device.</p>
            <ul>
              <li><b>gemma-4-26b-a4b-it</b> <span>free tier</span></li>
              <li><b>Any Gemini model</b> <span>your key</span></li>
            </ul>
            <small>Key stays in your browser. Groq, OpenRouter, Anthropic and OpenAI-compatible APIs work too.</small>
          </article>
          <article className="engine">
            <h3>Instant mode</h3>
            <p>No model at all: Corpus ranks the passages and quotes the sentences that answer you. Works everywhere, in milliseconds.</p>
            <ul>
              <li><b>0 MB</b> <span>download</span></li>
              <li><b>Offline</b> <span>always</span></li>
            </ul>
            <small>Great for quick lookups and older devices.</small>
          </article>
        </div>
      </section>

      <section className="privacy" id="privacy">
        <div>
          <span className="kicker">Privacy</span>
          <h2>Your documents stay yours.</h2>
          <p>Files are read in memory and never uploaded. With Gemma in your browser or Instant mode, nothing leaves your device at all. If you choose a cloud model, only the few passages needed for that answer are sent — never your files.</p>
        </div>
        <ul>
          <li><b>On device</b> parsing, chunking, embeddings, search</li>
          <li><b>No accounts</b> no tracking, no server storing your data</li>
          <li><b>Your keys</b> kept in your browser, removable any time</li>
        </ul>
      </section>

      <section className="final-cta">
        <h2>See it answer from <em>your</em> files.</h2>
        <div className="hero-cta">
          <a className="btn big" href="#/app?samples">Try the demo</a>
          <a className="btn big ghost" href={GITHUB} target="_blank" rel="noreferrer">View source</a>
        </div>
      </section>

      <footer className="lfoot">
        <span>Corpus · MIT licensed</span>
        <a href="https://adityamalviya04692.github.io/Portfolio/" target="_blank" rel="noreferrer">Built by Aditya Malviya ↗</a>
      </footer>
    </div>
  );
}

/* Animated product preview: a document question with citations, then a data question
   answered with SQL and a chart. */
function DemoWindow() {
  return (
    <div className="demo" aria-hidden="true">
      <div className="demo-bar">
        <i /><i /><i />
        <span>corpus · 3 documents · 1 table</span>
      </div>
      <div className="demo-body">
        <div className="demo-docs">
          <span className="d-doc"><b>MD</b> design-v1.md</span>
          <span className="d-doc"><b>MD</b> design-v2.md</span>
          <span className="d-doc"><b>CSV</b> pipeline-runs.csv</span>
        </div>
        <div className="d-q">What changed between v1 and v2?</div>
        <div className="d-a">
          <p className="l1">v2 moved from nightly batch to <b>streaming</b> on Event Hubs and Databricks <i>1</i></p>
          <p className="l2">Freshness went from <b>29 hours</b> to a <b>15-minute SLA</b> <i>2</i></p>
        </div>
        <div className="d-q q2">Failure rate by pipeline</div>
        <div className="d-a d-sql">
          <code>SELECT pipeline, round(100 * avg(status = 'failed')…</code>
          <div className="d-bars">
            {[78, 34, 22, 16, 9].map((h, i) => (
              <span key={i} style={{ height: `${h}%`, animationDelay: `${i * 0.08}s` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
