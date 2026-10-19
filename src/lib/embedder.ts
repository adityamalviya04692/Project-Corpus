/* Promise wrapper around the embedding worker, with a per-text cache so a sentence or
   passage is only ever embedded once (follow-up questions and re-ranking reuse it). */

export const EMBED_MODEL = 'all-MiniLM-L6-v2';
export const EMBED_DIMS = 384;

type Progress = (stage: 'load' | 'embed', fraction: number) => void;

let worker: Worker | null = null;
let seq = 0;
let device = '';
const cache = new Map<string, Float32Array>();

/** "webgpu" or "wasm" once the model has loaded. */
export const embedDevice = () => device;

function run(texts: string[], onProgress?: Progress): Promise<Float32Array[]> {
  worker ??= new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  const w = worker;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'device') device = m.device;
      if (m.type === 'load') onProgress?.('load', m.progress / 100);
      if (m.id !== id) return;
      if (m.type === 'progress') onProgress?.('embed', m.done / m.total);
      if (m.type === 'done') {
        w.removeEventListener('message', onMessage);
        resolve(m.vectors);
      }
      if (m.type === 'error') {
        w.removeEventListener('message', onMessage);
        reject(new Error(m.message));
      }
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, texts });
  });
}

export async function embed(texts: string[], onProgress?: Progress): Promise<Float32Array[]> {
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
  if (missing.length) {
    const vecs = await run(missing, onProgress);
    missing.forEach((t, i) => cache.set(t, vecs[i]));
  } else {
    onProgress?.('embed', 1);
  }
  return texts.map((t) => cache.get(t)!);
}
