import type { ChatMessage } from './types';

/* Where answers come from. Nothing here ever leaves the browser except the request to
   the provider the visitor picked; their key is stored only in this browser. */

export type ProviderId = 'instant' | 'browser' | 'demo' | 'gemini' | 'groq' | 'openrouter' | 'anthropic' | 'openai';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  blurb: string;
  needsKey: boolean;
  defaultModel?: string;
  keyUrl?: string;
}

/** Optional hosted demo: a Cloudflare Worker holding the site owner's own free-tier key. */
export const DEMO_URL: string = import.meta.env.VITE_PROXY_URL ?? '';

/* In-browser models (WebLLM, WebGPU). Sizes are the one-time download. */
export const BROWSER_MODELS = [
  { id: 'gemma-4-E2B-it-q4f16_1-MLC', label: 'Gemma 4 E2B', size: '2.8 GB', note: 'Best answers · needs ~3.5 GB GPU memory' },
  { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 1.7B', size: '1.0 GB', note: 'Balanced' },
  { id: 'gemma3-1b-it-q4f16_1-MLC', label: 'Gemma 3 1B', size: '0.6 GB', note: 'Fastest download' },
];

export const PROVIDERS: ProviderInfo[] = [
  { id: 'instant', label: 'Instant', blurb: 'No AI model: quotes the best-matching sentences. Works everywhere, offline.', needsKey: false },
  { id: 'browser', label: 'Gemma in your browser', blurb: 'Google’s open Gemma 4 runs on your GPU. Free, private, offline after a one-time download.', needsKey: false, defaultModel: BROWSER_MODELS[0].id },
  ...(DEMO_URL ? [{ id: 'demo' as const, label: 'Hosted Gemma 4', blurb: 'Gemma 4 26B on Google’s free tier, shared by this site. Rate-limited.', needsKey: false, defaultModel: 'gemma-4-26b-a4b-it' }] : []),
  { id: 'gemini', label: 'Google AI Studio', blurb: 'Gemma 4 26B (free) or any Gemini model, with your own free AI Studio key.', needsKey: true, defaultModel: 'gemma-4-26b-a4b-it', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'groq', label: 'Groq', blurb: 'Free tier, very fast open models.', needsKey: true, defaultModel: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  { id: 'openrouter', label: 'OpenRouter', blurb: 'Many models, including free ones (":free").', needsKey: true, defaultModel: 'meta-llama/llama-3.3-70b-instruct:free', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'anthropic', label: 'Anthropic Claude', blurb: 'Paid API key.', needsKey: true, defaultModel: 'claude-haiku-5-5', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', label: 'OpenAI-compatible', blurb: 'Any endpoint speaking the OpenAI chat API (OpenAI, Together, local LM Studio…).', needsKey: true, defaultModel: 'gpt-4o-mini' },
];

export interface Settings {
  provider: ProviderId;
  keys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
  baseUrl: string;
}

export const modelFor = (s: Settings, id: ProviderId) => s.models[id] || PROVIDERS.find((p) => p.id === id)?.defaultModel || '';

type OnToken = (text: string) => void;

/* --- streaming helpers --------------------------------------------------------- */

async function* sse(res: Response): AsyncGenerator<string> {
  if (!res.ok || !res.body) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

async function openaiChat(url: string, headers: Record<string, string>, model: string, messages: ChatMessage[], onToken: OnToken, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.2, max_tokens: 1200 }),
    signal,
  });
  let text = '';
  for await (const data of sse(res)) {
    if (data === '[DONE]') break;
    const delta = JSON.parse(data).choices?.[0]?.delta?.content;
    if (delta) onToken((text += delta));
  }
  return text;
}

async function gemini(key: string, model: string, messages: ChatMessage[], onToken: OnToken, signal?: AbortSignal, proxy?: string) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const url = proxy || `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: proxy ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.2, maxOutputTokens: 1200 } }),
    signal,
  });
  let text = '';
  for await (const data of sse(res)) {
    const parts = JSON.parse(data).candidates?.[0]?.content?.parts ?? [];
    // Gemma 4 can think before answering; only the answer parts are shown.
    for (const p of parts) if (p.text && !p.thought) onToken((text += p.text));
  }
  return text;
}

async function anthropic(key: string, model: string, messages: ChatMessage[], onToken: OnToken, signal?: AbortSignal) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, system, max_tokens: 1200, temperature: 0.2, stream: true, messages: messages.filter((m) => m.role !== 'system') }),
    signal,
  });
  let text = '';
  for await (const data of sse(res)) {
    const ev = JSON.parse(data);
    if (ev.type === 'content_block_delta' && ev.delta?.text) onToken((text += ev.delta.text));
    if (ev.type === 'error') throw new Error(ev.error?.message ?? 'Anthropic error');
  }
  return text;
}

/* --- in-browser model (WebLLM, WebGPU) ----------------------------------------- */

type Engine = import('@mlc-ai/web-llm').MLCEngineInterface;
let engine: { id: string; ready: Promise<Engine>; loaded: boolean } | null = null;

export const hasWebGPU = () => typeof navigator !== 'undefined' && 'gpu' in navigator;

export function loadBrowserModel(id: string, onProgress: (fraction: number, text: string) => void): Promise<Engine> {
  if (engine?.id === id) return engine.ready;
  const ready = import('@mlc-ai/web-llm').then(({ CreateMLCEngine }) =>
    CreateMLCEngine(id, { initProgressCallback: (r) => onProgress(r.progress, r.text) }),
  );
  const entry = { id, ready, loaded: false };
  engine = entry;
  ready.then(
    () => (entry.loaded = true),
    () => engine === entry && (engine = null),
  );
  return ready;
}

/** True only once the model has finished downloading and compiling. */
export const browserModelLoaded = (id: string) => engine?.id === id && engine.loaded;
export const browserModelLoading = (id: string) => engine?.id === id && !engine.loaded;

async function browser(id: string, messages: ChatMessage[], onToken: OnToken, signal?: AbortSignal) {
  if (!engine || engine.id !== id) throw new Error('Load the in-browser model first.');
  const e = await engine.ready;
  const stream = await e.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.2,
    max_tokens: 420,
    // Qwen3 thinks by default, so switch it off; RAG needs facts, not long reasoning.
    // (WebLLM implements this with Qwen's empty <think> block, which confuses Gemma 4;
    // Gemma 4 only thinks when its system prompt asks, so it needs nothing.)
    ...(/qwen3/i.test(id) ? { extra_body: { enable_thinking: false } } : {}),
  });
  let raw = '';
  for await (const chunk of stream) {
    if (signal?.aborted) {
      e.interruptGenerate();
      break;
    }
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) onToken(stripThinking((raw += delta)));
  }
  return stripThinking(raw);
}

/** Drops any reasoning block a small model emits despite thinking being off. */
const stripThinking = (t: string) => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');

/* --- dispatch ------------------------------------------------------------------- */

export async function generate(s: Settings, messages: ChatMessage[], onToken: OnToken, signal?: AbortSignal): Promise<string> {
  const id = s.provider;
  const model = modelFor(s, id);
  const key = s.keys[id]?.trim() ?? '';
  const info = PROVIDERS.find((p) => p.id === id);
  if (info?.needsKey && !key) throw new Error(`Add your ${info.label} API key in Settings.`);
  switch (id) {
    case 'browser':
      return browser(model, messages, onToken, signal);
    case 'demo':
      return gemini('', model, messages, onToken, signal, DEMO_URL);
    case 'gemini':
      return gemini(key, model, messages, onToken, signal);
    case 'groq':
      return openaiChat('https://api.groq.com/openai/v1/chat/completions', { Authorization: `Bearer ${key}` }, model, messages, onToken, signal);
    case 'openrouter':
      return openaiChat(
        'https://openrouter.ai/api/v1/chat/completions',
        { Authorization: `Bearer ${key}`, 'HTTP-Referer': location.origin, 'X-Title': 'Corpus' },
        model,
        messages,
        onToken,
        signal,
      );
    case 'anthropic':
      return anthropic(key, model, messages, onToken, signal);
    case 'openai':
      return openaiChat(`${(s.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, { Authorization: `Bearer ${key}` }, model, messages, onToken, signal);
    default:
      throw new Error('Instant mode does not call a model.');
  }
}
