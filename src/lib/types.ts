/** A page (or page-like section) of extracted text. Non-paginated formats have one page. */
export interface Page {
  page: number;
  text: string;
}

export interface Doc {
  id: string;
  name: string;
  kind: 'pdf' | 'docx' | 'text' | 'markdown' | 'csv' | 'html';
  bytes: number;
  pages: Page[];
  chars: number;
  parseMs: number;
  /** SHA-256 of the file bytes, for de-duplication. */
  hash?: string;
}

export interface Chunk {
  id: string;
  docId: string;
  page: number;
  /** Position of the chunk within its document, 0-based. */
  index: number;
  text: string;
}

export interface Hit {
  chunk: Chunk;
  score: number;
  vector: number;
  keyword: number;
}

/** Metrics shown in the pipeline panel, one block per stage. */
export interface PipelineStats {
  parse: { files: number; pages: number; chars: number; ms: number };
  chunk: { chunks: number; avgChars: number; size: number; overlap: number; ms: number };
  embed: { model: string; dims: number; ms: number; status: 'idle' | 'loading' | 'embedding' | 'ready' | 'error'; progress: number; note?: string };
  index: { vectors: number; bytes: number };
  retrieve?: { query: string; strategy?: string; ms: number; k: number; hits: { label: string; score: number; vector: number; keyword: number }[] };
  generate?: { provider: string; model: string; ms: number; chars: number };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
