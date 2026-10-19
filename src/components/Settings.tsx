import { useEffect, useRef, useState } from 'react';
import { BROWSER_MODELS, PROVIDERS, browserModelLoaded, hasWebGPU, loadBrowserModel, modelFor, type ProviderId, type Settings as S } from '../lib/providers';

/* Choose where answers come from. Keys are kept in this browser only (localStorage). */
export default function Settings({ open, settings, onChange, onClose }: { open: boolean; settings: S; onChange: (s: S) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [load, setLoad] = useState<{ p: number; text: string; error?: string } | null>(null);
  const [, force] = useState(0);
  const gpu = hasWebGPU();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const set = (patch: Partial<S>) => onChange({ ...settings, ...patch });
  const pick = (provider: ProviderId) => set({ provider });
  const browserModel = modelFor(settings, 'browser');

  const startLoad = async () => {
    setLoad({ p: 0, text: 'Starting…' });
    try {
      await loadBrowserModel(browserModel, (p, text) => setLoad({ p, text }));
      setLoad(null);
      pick('browser');
      force((n) => n + 1);
    } catch (e) {
      setLoad({ p: 0, text: '', error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <dialog ref={ref} className="settings" onClose={onClose} onCancel={onClose} aria-labelledby="settings-title">
      <header>
        <h2 id="settings-title">Where answers come from</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close settings">✕</button>
      </header>
      <p className="muted">Search always runs in your browser. Only the model you pick below sees the matching passages. Keys stay in this browser.</p>
      <div className="providers" role="radiogroup" aria-label="Answer provider">
        {PROVIDERS.map((p) => {
          const active = settings.provider === p.id;
          return (
            <div key={p.id} className={`provider${active ? ' active' : ''}`}>
              <label>
                <input type="radio" name="provider" checked={active} onChange={() => pick(p.id)} />
                <span>
                  <strong>{p.label}</strong>
                  <small>{p.blurb}</small>
                </span>
              </label>
              {active && p.id === 'browser' && (
                <div className="provider-body">
                  {!gpu && <p className="warn">This browser has no WebGPU. Try Chrome or Edge on desktop, or use a key / Instant mode.</p>}
                  <select value={browserModel} onChange={(e) => set({ models: { ...settings.models, browser: e.target.value } })} aria-label="In-browser model">
                    {BROWSER_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>{m.label} — {m.size}</option>
                    ))}
                  </select>
                  {browserModelLoaded(browserModel) ? (
                    <p className="ok">Model loaded and ready.</p>
                  ) : load && !load.error ? (
                    <div className="loadbar" role="progressbar" aria-valuenow={Math.round(load.p * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <i style={{ width: `${load.p * 100}%` }} />
                      <span>{load.text.slice(0, 80)}</span>
                    </div>
                  ) : (
                    <button className="btn" disabled={!gpu} onClick={startLoad}>Download &amp; load model</button>
                  )}
                  {load?.error && <p className="warn">{load.error}</p>}
                  <small className="muted">Downloaded once, then cached by your browser. Runs fully offline afterwards.</small>
                </div>
              )}
              {active && p.needsKey && (
                <div className="provider-body">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={`${p.label} API key`}
                    value={settings.keys[p.id] ?? ''}
                    onChange={(e) => set({ keys: { ...settings.keys, [p.id]: e.target.value } })}
                    aria-label={`${p.label} API key`}
                  />
                  <input
                    placeholder="Model"
                    value={modelFor(settings, p.id)}
                    onChange={(e) => set({ models: { ...settings.models, [p.id]: e.target.value } })}
                    aria-label={`${p.label} model`}
                  />
                  {p.id === 'openai' && (
                    <input placeholder="Base URL, e.g. https://api.openai.com/v1" value={settings.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} aria-label="Base URL" />
                  )}
                  {p.keyUrl && (
                    <a href={p.keyUrl} target="_blank" rel="noreferrer">Get a {p.label} key ↗</a>
                  )}
                  {settings.keys[p.id] && (
                    <button className="link" onClick={() => set({ keys: { ...settings.keys, [p.id]: '' } })}>Forget this key</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </dialog>
  );
}
