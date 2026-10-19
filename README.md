# Corpus — chat with your documents

Ask questions across PDFs, Word, Markdown, CSV and HTML files, get **cited answers**, get
**insights per document**, and **compare documents side by side**. The whole retrieval
pipeline runs in the browser and is shown live, stage by stage.

**Live:** https://adityamalviya04692.github.io/Project-Corpus/

## Why it's interesting

- **Visible RAG pipeline.** Parse → chunk → embed → index → retrieve → generate, with
  timings, chunk sizes, vector counts and per-passage retrieval scores. Change chunk size
  or overlap and watch everything re-chunk and re-embed.
- **Hybrid retrieval.** Cosine similarity on `all-MiniLM-L6-v2` embeddings (Transformers.js,
  in a Web Worker) blended with BM25 for exact terms like table names and error codes.
- **Exact citations.** Chunks never span pages, every answer cites `[n]`, and each citation
  opens the source passage.
- **Runs without an API key.** Four ways to answer:
  | Mode | Needs | Notes |
  |---|---|---|
  | Instant | nothing | Ranks and quotes the best sentences. Works offline, everywhere. |
  | In-browser AI | WebGPU (Chrome/Edge desktop) | Qwen 2.5 / Llama 3.2 via WebLLM, downloaded once (~1 GB). |
  | Your own key | a key | Gemini and Groq (free tiers), OpenRouter (free models), Anthropic, any OpenAI-compatible API. Stored only in your browser. |
  | Hosted demo | owner's setup | Optional Cloudflare Worker holding the owner's free Gemini key (`worker/`). |
- **Private by default.** Documents never leave the device unless you pick a remote model,
  and then only the retrieved passages are sent.

## Run locally

```bash
npm install
npm run dev
```

`npm test` runs the chunking and retrieval tests; `npm run build` type-checks and builds.

## Deploy

Push to `main`: the GitHub Actions workflow tests, builds and publishes to GitHub Pages
(enable Pages with source "GitHub Actions" once). For the optional hosted demo, see
[`worker/README.md`](worker/README.md).

## Stack

React 19 · TypeScript · Vite · Transformers.js · WebLLM · pdf.js · mammoth · marked + DOMPurify · Vitest · Cloudflare Workers (optional)

MIT © Aditya Malviya
