import { useEffect, useRef } from 'react';
import { BROWSER_MODELS, PROVIDERS, browserModelLoaded, hasWebGPU, modelFor, type ProviderId, type Settings as S } from '../lib/providers';

type Load = { p: number; text: string; error?: string } | null;

/* The model picker. Keys are kept in this browser only (localStorage). */
export default function EngineDialog({
  open, settings, onChange, onClose, load, onLoadBrowser,
}: {
  open: boolean;
  settings: S;
  onChange: (s: S) => void;
  onClose: () => void;
  load: Load;
  onLoadBrowser: (id: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
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
  const loading = load && !load.error;

  return (
    <dialog ref={ref} className="engine-dialog" onClose={onClose} onCancel={onClose} aria-labelledby="engine-title">
      <header>
        <div>
          <h2 id="engine-title">Choose a model</h2>
          <p>Search always runs on your device. Only the model you pick sees the matching passages.</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <div className="engine-list" role="radiogroup" aria-label="Model">
        {PROVIDERS.map((p) => {
          const active = settings.provider === p.id;
          return (
            <div key={p.id} className={`engine-opt${active ? ' active' : ''}${p.id === 'browser' ? ' recommended' : ''}`}>
              <label>
                <input type="radio" name="provider" checked={active} onChange={() => pick(p.id)} />
                <span className="opt-text">
                  <strong>
                    {p.label}
                    {p.id === 'browser' && <em className="pill">Free · private</em>}
                    {p.id === 'gemini' && <em className="pill alt">Free tier</em>}
                  </strong>
                  <small>{p.blurb}</small>
                </span>
              </label>

              {active && p.id === 'browser' && (
                <div className="opt-body">
                  {!gpu && <p className="warn">This browser has no WebGPU. Use Chrome or Edge on a desktop, or pick Google AI Studio / Instant.</p>}
                  <div className="model-grid">
                    {BROWSER_MODELS.map((m) => (
                      <button
                        key={m.id}
                        className={`model-card${browserModel === m.id ? ' on' : ''}`}
                        onClick={() => set({ models: { ...settings.models, browser: m.id } })}
                        disabled={!!loading}
                      >
                        <b>{m.label}</b>
                        <span>{m.size}</span>
                        <small>{m.note}</small>
                      </button>
                    ))}
                  </div>
                  {browserModelLoaded(browserModel) ? (
                    <p className="ok">✓ Loaded and ready. Runs fully offline.</p>
                  ) : loading ? (
                    <div className="loadbar" role="progressbar" aria-valuenow={Math.round(load.p * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <i style={{ width: `${load.p * 100}%` }} />
                      <span>{Math.round(load.p * 100)}% · {load.text.replace(/\[.*?\]\s*/, '').slice(0, 70)}</span>
                    </div>
                  ) : (
                    <button className="btn" disabled={!gpu} onClick={() => onLoadBrowser(browserModel)}>
                      Download &amp; run {BROWSER_MODELS.find((m) => m.id === browserModel)?.label}
                    </button>
                  )}
                  {load?.error && <p className="warn">{load.error}</p>}
                  <small className="muted">Downloaded once from Hugging Face, then cached by your browser. You can close this and keep working while it loads.</small>
                </div>
              )}

              {active && p.needsKey && (
                <div className="opt-body">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={`Paste your ${p.label} API key`}
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
                  <div className="opt-links">
                    {p.keyUrl && <a href={p.keyUrl} target="_blank" rel="noreferrer">Get a free key ↗</a>}
                    {settings.keys[p.id] && <button className="link" onClick={() => set({ keys: { ...settings.keys, [p.id]: '' } })}>Forget key</button>}
                  </div>
                  <small className="muted">Stored only in this browser. Requests go straight from your browser to {p.label}.</small>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </dialog>
  );
}
