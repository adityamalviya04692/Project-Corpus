# Corpus — chat with your documents

Ask questions across PDFs, Word, Markdown, CSV and HTML files, get **cited answers**, get
**insights per document**, and **compare documents side by side**. The whole retrieval
pipeline runs in the browser and is shown live, stage by stage.

**Live:** https://adityamalviya04692.github.io/Project-Corpus/ — landing page, then *Open app*.

## Why it's interesting

- **Visible RAG pipeline.** Parse → chunk → embed → index → retrieve → generate, with
  timings, chunk sizes, vector counts and per-passage retrieval scores. Change chunk size
  or overlap and watch everything re-chunk and re-embed.
- **Hybrid retrieval.** Cosine similarity on `all-MiniLM-L6-v2` embeddings (Transformers.js,
  in a Web Worker) blended with BM25 for exact terms like table names and error codes.
- **Exact citations.** Chunks never span pages, every answer cites `[n]`, and each citation
  opens the source passage.
- **Runs Google's Gemma 4 in the browser.** Gemma 4 E2B (2.8 GB, one-time download) runs on
  WebGPU through WebLLM, with Qwen3 1.7B and Gemma 3 1B as lighter options. Small models get a
  *compressed context* (the best few sentences of each passage, ranked by embeddings) and a
  citation safety net, which makes their answers markedly more accurate.
- **Four ways to answer, no key required:**
  | Mode | Needs | Notes |
  |---|---|---|
  | Gemma in your browser | WebGPU (Chrome/Edge desktop) | Free, private, offline after download. |
  | Google AI Studio | free key | `gemma-4-26b-a4b-it` on Google's free tier, or any Gemini model. |
  | Instant | nothing | Ranks and quotes the best sentences. Works everywhere. |
  | Hosted Gemma 4 | owner's setup | Optional Cloudflare Worker holding the owner's free key (`worker/`). |

  Groq, OpenRouter, Anthropic and any OpenAI-compatible API work with your own key too.
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

React 19 · TypeScript · Vite · Gemma 4 · WebLLM · Transformers.js · pdf.js · mammoth · marked + DOMPurify · Vitest · Cloudflare Workers (optional)

MIT © Aditya Malviya
