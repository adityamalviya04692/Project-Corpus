import type { Doc, Page } from './types';

/* Text extraction for every supported format. Heavy parsers (pdf.js, mammoth) are
   loaded only when a file of that type arrives, so the first page stays light. */

const EXT: Record<string, Doc['kind']> = {
  pdf: 'pdf', docx: 'docx', txt: 'text', md: 'markdown', markdown: 'markdown',
  csv: 'csv', tsv: 'csv', html: 'html', htm: 'html', json: 'text', log: 'text',
};

export const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.html,.htm,.json,.log';

export function kindOf(name: string): Doc['kind'] | null {
  return EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

async function pdfPages(buf: ArrayBuffer): Promise<Page[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: Page[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    let text = '';
    for (const item of content.items) {
      if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
    }
    pages.push({ page: n, text });
  }
  return pages;
}

async function docxText(buf: ArrayBuffer): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  return (await mammoth.extractRawText({ arrayBuffer: buf })).value;
}

function htmlText(html: string): string {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  dom.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
  return dom.body?.innerText || dom.body?.textContent || '';
}

export async function parseFile(file: File): Promise<Doc> {
  const kind = kindOf(file.name);
  if (!kind) throw new Error(`${file.name}: unsupported file type`);
  const t0 = performance.now();
  let pages: Page[];
  if (kind === 'pdf') pages = await pdfPages(await file.arrayBuffer());
  else if (kind === 'docx') pages = [{ page: 1, text: await docxText(await file.arrayBuffer()) }];
  else if (kind === 'html') pages = [{ page: 1, text: htmlText(await file.text()) }];
  else pages = [{ page: 1, text: await file.text() }];
  pages = pages.map((p) => ({ ...p, text: p.text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim() }));
  const chars = pages.reduce((s, p) => s + p.text.length, 0);
  if (!chars) throw new Error(`${file.name}: no readable text (scanned PDFs need OCR)`);
  return {
    id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    kind,
    bytes: file.size,
    pages,
    chars,
    parseMs: performance.now() - t0,
  };
}
