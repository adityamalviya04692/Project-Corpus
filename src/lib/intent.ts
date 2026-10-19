import type { Doc } from './types';

/* Query understanding. Different questions need different retrieval strategies:
   "what is this about?" needs a sample of the whole document, not the 6 chunks that
   happen to share words with the question; "compare v1 and v2" needs passages from
   each side; a named file should scope the search to that file. */

export type Intent = 'overview' | 'compare' | 'list' | 'lookup' | 'data';

export interface Plan {
  intent: Intent;
  /** Documents the question names; empty means "all of them". */
  docIds: string[];
}

const OVERVIEW =
  /\b(what('?s| is| are)\s+(this|the|these|each|that)\s+(\w+\s+)?(doc|docs|document|documents|file|files|pdf|report|paper|text)s?\b.*\babout|what('?s| is| are)\s+(it|they|this|these)\s+about|summar|overview|tl;?dr|gist|main (points|ideas?|takeaways?)|key takeaways|explain (this|the|these|each) (doc|document|file|report)|describe (this|the|these) (doc|document|file|report)|give me (a|an) (brief|summary|overview))/i;
const COMPARE = /\b(compare|comparison|differen|differ\b|vs\.?|versus|changed between|what changed|contrast|similarit)/i;
const LIST = /\b(list|enumerate|all (the|of the)|every\b|which .* (mentioned|listed))/i;

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const COMMON = new Set(['the', 'doc', 'docs', 'file', 'final', 'draft', 'copy', 'new', 'old', 'data', 'report', 'notes', 'pdf', 'md', 'txt', 'csv', 'docx']);

/** Documents a question refers to by name (file stem, a distinctive word, or a version tag). */
export function mentionedDocs(question: string, docs: Doc[]): string[] {
  const q = question.toLowerCase();
  const qw = new Set(words(q));
  const tokens = docs.map((d) => words(d.name.replace(/\.[^.]+$/, '')).filter((t) => !COMMON.has(t)));
  const freq = new Map<string, number>();
  tokens.forEach((ts) => new Set(ts).forEach((t) => freq.set(t, (freq.get(t) ?? 0) + 1)));
  return docs
    .filter((d, i) => {
      const stem = d.name.replace(/\.[^.]+$/, '').toLowerCase();
      if (q.includes(stem) || q.includes(d.name.toLowerCase())) return true;
      // A word only this file has (e.g. "postmortem") or a version tag (v1, v2) only it has.
      return tokens[i].some((t) => freq.get(t) === 1 && qw.has(t) && (t.length >= 5 || /^v\d+$/.test(t) || /^\d{4}$/.test(t)));
    })
    .map((d) => d.id);
}

export function plan(question: string, docs: Doc[], hasTables = false, dataHint = false): Plan {
  const docIds = mentionedDocs(question, docs);
  if (hasTables && dataHint) return { intent: 'data', docIds };
  // "What is the postmortem about?", "what's v2 about" — any "what is X about" question.
  const aboutX = /\bwhat('?s| is| are| does)\b[^?]{0,60}\babout\b\s*\??\s*$/i.test(question.trim());
  if (OVERVIEW.test(question) || aboutX) return { intent: 'overview', docIds };
  if (COMPARE.test(question) && (docIds.length >= 2 || docs.length >= 2)) return { intent: 'compare', docIds };
  if (LIST.test(question)) return { intent: 'list', docIds };
  return { intent: 'lookup', docIds };
}

/** A friendly label for what kind of document this looks like, from its title. */
export function docKind(title: string, kind: Doc['kind']): string {
  const t = title.toLowerCase();
  if (kind === 'csv') return 'dataset';
  const map: [RegExp, string][] = [
    [/post-?mortem|incident|outage|rca\b/, 'incident post-mortem'],
    [/design|architecture|rfc|proposal/, 'design document'],
    [/contract|agreement|terms|nda\b/, 'contract'],
    [/policy|guideline|handbook|standard/, 'policy document'],
    [/spec|requirement|prd\b/, 'specification'],
    [/report|analysis|review|assessment/, 'report'],
    [/minutes|meeting|notes/, 'set of notes'],
    [/resume|cv\b|curriculum/, 'résumé'],
    [/invoice|receipt|statement/, 'financial statement'],
    [/paper|abstract|study/, 'research paper'],
  ];
  return map.find(([re]) => re.test(t))?.[1] ?? 'document';
}
