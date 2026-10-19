import { BROWSER_MODELS } from './lib/providers';

const GITHUB = 'https://github.com/adityamalviya04692/Project-Corpus';

const FEATURES = [
  { icon: '◎', title: 'Ask across every file', text: 'One question, all your documents. Every claim is cited and each citation opens the exact passage and page.' },
  { icon: '⇄', title: 'Compare side by side', text: 'Pick two or more documents and a focus. Corpus lines them up in a table: what changed, what is missing, who says what.' },
  { icon: '✦', title: 'Instant insights', text: 'A one-click brief per document: summary, key numbers, decisions and risks, all traceable to the source.' },
  { icon: '⌂', title: 'Private by default', text: 'Parsing, chunking, embeddings and search run on your device. Run Gemma 4 locally and nothing ever leaves the browser.' },
];

const STEPS = [
  { n: '01', name: 'Parse', tech: 'pdf.js · mammoth', text: 'PDF, Word, Markdown, CSV and HTML become clean text, page by page.' },
  { n: '02', name: 'Chunk', tech: 'recursive · overlap', text: 'Paragraph- and sentence-aware chunks that never cross pages, so citations stay exact.' },
  { n: '03', name: 'Embed', tech: 'MiniLM · Web Worker', text: '384-dimension vectors computed on your device, off the main thread.' },
  { n: '04', name: 'Index', tech: 'cosine + BM25', text: 'Hybrid retrieval: meaning from vectors, exact terms like table names from keywords.' },
  { n: '05', name: 'Retrieve', tech: 'top-k · scores', text: 'The best passages for each question, with their scores shown live.' },
  { n: '06', name: 'Generate', tech: 'Gemma 4', text: 'A grounded answer that cites its sources — or says when the documents don’t know.' },
];

export default function Landing() {
  return (
    <div className="landing">
      <nav className="lnav">
        <a className="brand-sm" href="#/">
          <span className="logo" aria-hidden="true" />
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
          <span className="eyebrow"><i /> Now with Google’s Gemma 4 — free, on your device</span>
          <h1>
            Ask your documents <em>anything.</em>
          </h1>
          <p>
            Drop in PDFs, contracts, specs or reports. Corpus finds the answer across all of them, cites every line, and compares documents side by side — running entirely in your browser.
          </p>
          <div className="hero-cta">
            <a className="btn big" href="#/app?samples">Try it with sample docs</a>
            <a className="btn big ghost" href="#/app">Use my own files</a>
          </div>
          <ul className="hero-points">
            <li>No sign-up</li>
            <li>No API key needed</li>
            <li>Open source</li>
          </ul>
        </div>
        <DemoWindow />
      </header>

      <section className="built-with" aria-label="Built with">
        <span>Built with</span>
        <b>Gemma 4</b>
        <b>WebGPU</b>
        <b>WebLLM</b>
        <b>Transformers.js</b>
        <b>pdf.js</b>
        <b>React</b>
      </section>

      <section className="features">
        {FEATURES.map((f) => (
          <article key={f.title}>
            <span className="f-icon" aria-hidden="true">{f.icon}</span>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </article>
        ))}
      </section>

      <section className="how" id="how">
        <div className="section-head">
          <span className="kicker">Under the hood</span>
          <h2>A real retrieval pipeline, not a black box.</h2>
          <p>Every stage runs in your browser and reports what it did — the same way a data platform should.</p>
        </div>
        <ol className="steps">
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="step-n">{s.n}</span>
              <h3>{s.name}</h3>
              <code>{s.tech}</code>
              <p>{s.text}</p>
            </li>
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
        <h2>See it answer from your own files.</h2>
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

/* Animated product preview: a question, the pipeline lighting up, a cited answer. */
function DemoWindow() {
  return (
    <div className="demo" aria-hidden="true">
      <div className="demo-bar">
        <i /><i /><i />
        <span>corpus · 3 documents</span>
      </div>
      <div className="demo-body">
        <div className="demo-docs">
          <span className="d-doc"><b>MD</b> design-v1.md</span>
          <span className="d-doc"><b>MD</b> design-v2.md</span>
          <span className="d-doc"><b>PDF</b> postmortem.pdf</span>
        </div>
        <div className="d-q">What changed between v1 and v2?</div>
        <div className="d-pipe">
          <span>parse</span><span>chunk</span><span>embed</span><span>retrieve</span><span>Gemma 4</span>
        </div>
        <div className="d-a">
          <p className="l1">v2 moved from nightly batch to <b>streaming</b> with Event Hubs and Databricks <i>1</i></p>
          <p className="l2">Freshness went from <b>29 hours</b> to a <b>15-minute SLA</b> <i>2</i></p>
          <p className="l3">Monthly cost fell about <b>40%</b>, to USD 12,600 <i>3</i></p>
        </div>
        <div className="d-src">
          <span><i>1</i> design-v2.md</span>
          <span><i>2</i> design-v1.md</span>
          <span><i>3</i> design-v2.md</span>
        </div>
      </div>
    </div>
  );
}
