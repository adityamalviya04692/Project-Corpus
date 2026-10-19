import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/* Renders model output as sanitised Markdown. [n] markers become small superscript
   citations; `tips[n]` (the supporting sentence) shows on hover/focus. `highlight` wraps
   one sentence in <mark>, used by the source drawer. */
export default function Markdown({
  text, onCite, tips, highlight,
}: {
  text: string;
  /** Called with the citation number and its occurrence index (reading order). */
  onCite?: (n: number, occurrence: number) => void;
  /** Hover text per citation occurrence, in reading order. */
  tips?: string[];
  highlight?: string;
}) {
  const html = useMemo(() => {
    let src = text;
    if (highlight) {
      const i = src.indexOf(highlight);
      if (i >= 0) src = `${src.slice(0, i)}<mark>${src.slice(i, i + highlight.length)}</mark>${src.slice(i + highlight.length)}`;
    }
    const raw = marked.parse(src, { async: false, breaks: true }) as string;
    let i = 0;
    const cited = raw.replace(/\s?\[(\d{1,2})\]/g, (_, n) => {
      const tip = tips?.[i];
      return `<button type="button" class="cite" data-n="${n}" data-i="${i++}"${tip ? ` data-tip="${esc(tip)}"` : ''} aria-label="Source ${n}">${n}</button>`;
    });
    return DOMPurify.sanitize(cited, { ADD_ATTR: ['data-n', 'data-i', 'data-tip'] });
  }, [text, tips, highlight]);
  return (
    <div
      className="md"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('.cite');
        if (el?.dataset.n && onCite) onCite(Number(el.dataset.n), Number(el.dataset.i ?? -1));
      }}
    />
  );
}
