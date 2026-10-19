/// <reference lib="webworker" />
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

/* Embeddings run off the main thread. The model (~23 MB, quantised) downloads once from
   the Hugging Face CDN and is cached by the browser. */

export const MODEL = 'Xenova/all-MiniLM-L6-v2';
env.allowLocalModels = false;

let extractor: Promise<FeatureExtractionPipeline> | null = null;
const load = () =>
  (extractor ??= pipeline('feature-extraction', MODEL, {
    dtype: 'q8',
    progress_callback: (p: { status: string; progress?: number }) => {
      if (p.status === 'progress') self.postMessage({ type: 'load', progress: p.progress ?? 0 });
    },
  }) as Promise<FeatureExtractionPipeline>);

self.onmessage = async (e: MessageEvent<{ id: number; texts: string[] }>) => {
  const { id, texts } = e.data;
  try {
    const model = await load();
    const out: Float32Array[] = [];
    const batch = 16;
    for (let i = 0; i < texts.length; i += batch) {
      const t = await model(texts.slice(i, i + batch), { pooling: 'mean', normalize: true });
      const dims = t.dims[1];
      const data = t.data as Float32Array;
      for (let r = 0; r < t.dims[0]; r++) out.push(data.slice(r * dims, (r + 1) * dims));
      self.postMessage({ type: 'progress', id, done: Math.min(texts.length, i + batch), total: texts.length });
    }
    self.postMessage({ type: 'done', id, vectors: out }, { transfer: out.map((v) => v.buffer) });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
