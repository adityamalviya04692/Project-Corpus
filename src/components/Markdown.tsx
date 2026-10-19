import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';

/* Renders model output as sanitised Markdown and turns [n] markers into citation chips. */
export default function Markdown({ text, onCite }: { text: string; onCite?: (n: number) => void }) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false, breaks: true }) as string;
    const cited = raw.replace(/\[(\d{1,2})\]/g, '<button type="button" class="cite" data-n="$1">$1</button>');
    return DOMPurify.sanitize(cited, { ADD_ATTR: ['data-n'] });
  }, [text]);
  return (
    <div
      className="md"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const n = (e.target as HTMLElement).closest<HTMLElement>('.cite')?.dataset.n;
        if (n && onCite) onCite(Number(n));
      }}
    />
  );
}
