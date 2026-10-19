import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
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
  return hash.startsWith('#/app') ? <App autoSamples={hash.includes('samples')} /> : <Landing />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
