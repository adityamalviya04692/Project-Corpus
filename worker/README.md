# Corpus hosted-demo proxy (optional)

Lets visitors use a strong model **without their own key**, using *your* free Gemini key,
which stays secret inside a Cloudflare Worker. Without it, Corpus still works: visitors use
Instant mode, the in-browser model, or their own key.

1. Get a free key at <https://aistudio.google.com/apikey> (use your own Google account).
2. Create a free Cloudflare account, then from this folder:
   ```bash
   npx wrangler login
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler deploy
   ```
   Wrangler prints the Worker URL, e.g. `https://corpus-proxy.<you>.workers.dev`.
3. In the GitHub repo: **Settings → Secrets and variables → Actions → Variables**, add
   `VITE_PROXY_URL` = that URL, then re-run the deploy workflow. "Hosted demo" appears in
   Corpus's settings and becomes the default.

Guards: only your site's origin may call it, requests over 60 KB are rejected, answers
are capped at 1,200 tokens, and each visitor gets 20 requests per hour. Free-tier limits
on Google's side still apply; check them at Google AI Studio.
