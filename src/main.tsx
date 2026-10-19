import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
// The workspace (parsers, search, model code) loads only when it is opened.
const App = lazy(() => import('./App'));
import Landing from './Landing';
import './styles.css';

/* Hash routing keeps GitHub Pages happy: "#/" is the landing page, "#/app" the workspace. */
function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onHash = () => {
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  return hash.startsWith('#/app') ? (
    <Suspense fallback={<div className="boot">Opening Corpus…</div>}>
      <App autoSamples={hash.includes('samples')} />
    </Suspense>
  ) : (
    <Landing />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
