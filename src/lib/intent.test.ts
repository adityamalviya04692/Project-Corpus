import { describe, expect, it } from 'vitest';
import { docKind, mentionedDocs, plan } from './intent';
import type { Doc } from './types';

const doc = (id: string, name: string): Doc => ({ id, name, kind: 'markdown', bytes: 1, chars: 1, parseMs: 0, pages: [{ page: 1, text: 'x' }] });
const docs = [doc('a', 'lakehouse-design-v1.md'), doc('b', 'lakehouse-design-v2.md'), doc('c', 'incident-postmortem-2026-03.md')];

describe('plan', () => {
  it('routes "what is this about" questions to an overview', () => {
    expect(plan('What is this document about?', docs).intent).toBe('overview');
    expect(plan('Summarise the postmortem', docs).intent).toBe('overview');
    expect(plan('what are these files about', docs).intent).toBe('overview');
    expect(plan('What is the postmortem about?', docs)).toEqual({ intent: 'overview', docIds: ['c'] });
    expect(plan("what's v2 about", docs).intent).toBe('overview');
  });
  it('detects comparisons and lookups', () => {
    expect(plan('What changed between v1 and v2?', docs).intent).toBe('compare');
    expect(plan('What is the freshness SLA?', docs).intent).toBe('lookup');
  });
  it('scopes to files the question names', () => {
    expect(mentionedDocs('summarise the postmortem', docs)).toEqual(['c']);
    expect(mentionedDocs('what does v2 say about costs', docs)).toEqual(['b']);
    expect(mentionedDocs('what is the SLA', docs)).toEqual([]);
  });
});

describe('docKind', () => {
  it('names document types from titles', () => {
    expect(docKind('Post-mortem: engine-history job failures', 'markdown')).toBe('incident post-mortem');
    expect(docKind('Data Platform — Design v2', 'markdown')).toBe('design document');
  });
});
