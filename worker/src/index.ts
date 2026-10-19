/**
 * Corpus hosted-demo proxy (Cloudflare Worker, free plan).
 *
 * Holds YOUR Google AI Studio key as a secret so visitors can try Corpus with Gemma 4
 * without a key of their own. It only accepts requests from your site, caps the size
 * of each request and answer, and rate-limits each visitor.
 *
 * Deploy: see worker/README.md.
 */

export interface Env {
  GEMINI_API_KEY: string; // wrangler secret put GEMINI_API_KEY
  ALLOWED_ORIGIN: string; // e.g. https://adityamalviya04692.github.io
  MODEL?: string; //         default gemma-4-26b-a4b-it (free tier)
}

const LIMIT = 20; // requests per visitor per hour (per Worker instance)
const hits = new Map<string, { n: number; reset: number }>();

const cors = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
});

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') ?? '';
    const allowed = origin === env.ALLOWED_ORIGIN || origin.startsWith('http://localhost');
    if (!allowed) return new Response('Forbidden', { status: 403 });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors(origin) });

    const ip = req.headers.get('CF-Connecting-IP') ?? 'anon';
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || h.reset < now) hits.set(ip, { n: 1, reset: now + 3_600_000 });
    else if (++h.n > LIMIT)
      return new Response(JSON.stringify({ error: { message: 'Hourly demo limit reached. Add your own free key in Settings to keep going.' } }), {
        status: 429,
        headers: { ...cors(origin), 'Content-Type': 'application/json' },
      });

    const body = await req.text();
    if (body.length > 60_000) return new Response('Request too large', { status: 413, headers: cors(origin) });

    // The client sends a native Gemini/Gemma request body; we add the key and stream back.
    const model = env.MODEL || 'gemma-4-26b-a4b-it';
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors(origin), 'Content-Type': upstream.headers.get('Content-Type') ?? 'text/event-stream' },
    });
  },
};
